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
import { errorMessage } from "../runtime/errors.js";
import { spawnCommand } from "./command.js";

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
    return new URL(this.config.website.healthCheckPath, `${this.baseUrl}/`).href;
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
        if (response.ok || response.status < 500) return;
      } catch {
        // retry
      }
      await delay(250);
    }
    throw new Error(`Timed out waiting for production server at ${health}`);
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
      throw new Error("Cannot start when website.baseUrl is set (external server)");
    if (this.child) throw new Error("Server already running");
    const command = this.config.website.startCommand;
    if (!command) throw new Error("website.startCommand is required for managed server");
    const port = this.config.website.port;
    if (port === undefined) throw new Error("website.port is required for managed server");

    await mkdir(this.logDirectory, { recursive: true });
    const output = createWriteStream(join(this.logDirectory, "server.log"), {
      flags: "a",
    });
    const child = spawnCommand(command, this.cwd, this.commandEnv());
    if (process.platform !== "win32" && child.pid) {
      try {
        // Detach process group for clean SIGTERM to descendants on Unix.
        process.kill(child.pid, 0);
      } catch {
        // ignore
      }
    }
    this.child = child;
    child.stdout?.pipe(output, { end: false });
    child.stderr?.pipe(output, { end: false });
    child.on("exit", () => {
      if (!this.stopping) output.write("\n[server exited unexpectedly]\n");
      output.end();
    });

    try {
      await this.waitUntilHealthy(signal);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.managed) return;
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    this.stopping = true;
    try {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      } else {
        child.kill("SIGTERM");
      }
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        delay(3_000),
      ]);
      if (child.exitCode === null) {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else child.kill("SIGKILL");
      }
    } catch (error) {
      throw new Error(`Failed to stop server: ${errorMessage(error)}`);
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
