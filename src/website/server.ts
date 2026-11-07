import { type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveWebsiteBaseUrl,
  usesExternalServer,
  type WebsiteConfig,
} from "./config.js";
import { killProcessTree, spawnCommand } from "./command.js";

async function runCommand(
  command: string,
  cwd: string,
  logPath: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(join(logPath, ".."), { recursive: true });
  const output = createWriteStream(logPath, { flags: "a" });
  output.write(`\n$ ${command}\n`);
  const child = spawnCommand(command, cwd, env);
  child.stdout?.pipe(output, { end: false });
  child.stderr?.pipe(output, { end: false });

  const abort = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (value) => resolve(value));
    });
    if (signal.aborted) throw new Error("Interrupted");
    if (code !== 0) {
      const detail = stderr.trim() || `(see ${logPath})`;
      throw new Error(
        `Command failed (${code}): ${command}\n${detail.slice(-2_000)}`,
      );
    }
  } finally {
    signal.removeEventListener("abort", abort);
    output.end();
  }
}

export class ProductionServer {
  private child?: ChildProcess;
  private stopping = false;
  /** Сервер оптимизатора ответил на health-check и держит порт. */
  private ownedPort = false;

  constructor(
    readonly config: WebsiteConfig,
    readonly projectPath: string,
    readonly logDirectory: string,
  ) {}

  get managed(): boolean {
    return !usesExternalServer(this.config);
  }

  get baseUrl(): string {
    return resolveWebsiteBaseUrl(this.config);
  }

  get cwd(): string {
    return this.config.website.cwd
      ? join(this.projectPath, this.config.website.cwd)
      : this.projectPath;
  }

  private healthUrl(): string {
    return new URL(this.config.website.healthCheckPath, `${this.baseUrl}/`)
      .href;
  }

  private commandEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
    };
    if (this.config.website.port !== undefined)
      env.PORT = String(this.config.website.port);
    return env;
  }

  async waitUntilHealthy(signal: AbortSignal): Promise<void> {
    const timeout = this.config.website.startTimeoutMs ?? 60_000;
    const deadline = Date.now() + timeout;
    const health = this.healthUrl();
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (this.managed && this.child && this.child.exitCode !== null)
        throw new Error(
          `Production server exited before becoming ready (code ${this.child.exitCode})`,
        );
      try {
        const response = await fetch(health, { signal });
        if (response.ok || response.status < 500) {
          // Ответ мог дать прежний процесс, если новый уже упал с EADDRINUSE.
          if (this.managed && !(await this.childRemains(200))) {
            throw new Error(
              `Production server exited before becoming ready (code ${this.child?.exitCode ?? "unknown"})`,
            );
          }
          return;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Production server exited")
        )
          throw error;
        // retry
      }
      await delay(250);
    }
    throw new Error(`Timed out waiting for production server at ${health}`);
  }

  /** Ждёт, что поднятый процесс не завершится сразу после ответа health-check. */
  private async childRemains(ms: number): Promise<boolean> {
    const child = this.child;
    if (!child || child.exitCode !== null) return false;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(child.exitCode === null);
      }, ms);
      const onExit = () => {
        clearTimeout(timer);
        resolve(false);
      };
      child.once("exit", onExit);
    });
  }

  private async waitUntilPortFree(): Promise<void> {
    const health = this.healthUrl();
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await portIsFree(health)) return;
      await delay(100);
    }
    throw new Error(`Production server is still listening at ${health}`);
  }

  async build(signal: AbortSignal): Promise<void> {
    const command = this.config.website.buildCommand;
    if (!command) {
      if (this.managed)
        throw new Error("website.buildCommand is required for managed server");
      return;
    }
    if (this.managed && this.config.website.port === undefined)
      throw new Error("website.port is required for managed server");
    await runCommand(
      command,
      this.cwd,
      join(this.logDirectory, "build.log"),
      this.commandEnv(),
      signal,
    );
  }

  async start(signal: AbortSignal): Promise<void> {
    if (!this.managed)
      throw new Error(
        "Cannot start when website.baseUrl is set (external server)",
      );
    if (this.child) throw new Error("Server already running");
    const command = this.config.website.startCommand;
    if (!command)
      throw new Error("website.startCommand is required for managed server");
    const port = this.config.website.port;
    if (port === undefined)
      throw new Error("website.port is required for managed server");

    await mkdir(this.logDirectory, { recursive: true });
    const output = createWriteStream(join(this.logDirectory, "server.log"), {
      flags: "a",
    });
    const child = spawnCommand(command, this.cwd, this.commandEnv(), {
      detached: process.platform !== "win32",
    });
    this.child = child;
    this.ownedPort = false;
    child.stdout?.pipe(output, { end: false });
    child.stderr?.pipe(output, { end: false });
    child.on("exit", () => {
      if (!this.stopping) output.write("\n[server exited unexpectedly]\n");
      output.end();
    });

    try {
      await this.waitUntilHealthy(signal);
      this.ownedPort = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.managed) return;
    const child = this.child;
    const ownedPort = this.ownedPort;
    this.child = undefined;
    this.ownedPort = false;
    if (!child && !ownedPort) return;
    this.stopping = true;
    try {
      if (
        child?.pid &&
        (process.platform === "win32" || !childHasExited(child))
      ) {
        await killProcessTree(child.pid, "SIGTERM");
        if (process.platform !== "win32" && !childHasExited(child)) {
          await Promise.race([childExit(child), delay(3_000)]);
          if (!childHasExited(child))
            await killProcessTree(child.pid, "SIGKILL");
        }
      }
      if (child && !childHasExited(child)) {
        await Promise.race([childExit(child), delay(3_000)]);
      }
      if (ownedPort) await this.waitUntilPortFree();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to stop server: ${detail}`, { cause: error });
    } finally {
      this.stopping = false;
    }
  }

  /**
   * Managed: stop → build → start.
   * External (Docker/OSPanel): optional buildCommand, затем health-check без остановки стека.
   */
  async rebuildAndStart(signal: AbortSignal): Promise<void> {
    if (!this.managed) {
      await this.build(signal);
      await this.waitUntilHealthy(signal);
      return;
    }
    await this.stop();
    await this.build(signal);
    await this.start(signal);
  }

  async ensureReady(signal: AbortSignal): Promise<void> {
    await this.rebuildAndStart(signal);
  }
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function childExit(child: ChildProcess): Promise<void> {
  if (childHasExited(child)) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

function nestedCodes(
  error: unknown,
  found = new Set<string>(),
  depth = 0,
): Set<string> {
  if (!error || typeof error !== "object" || depth > 5) return found;
  const record = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof record.code === "string") found.add(record.code);
  if (record.cause) nestedCodes(record.cause, found, depth + 1);
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) nestedCodes(item, found, depth + 1);
  }
  return found;
}

/** Соединение отклонено: слушателя на порту больше нет. */
async function portIsFree(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(400) });
    return false;
  } catch (error) {
    const codes = nestedCodes(error);
    return codes.has("ECONNREFUSED") || codes.has("ECONNRESET");
  }
}
