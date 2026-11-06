import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRequest, CodingAgent } from "../types.js";
import { errorMessage } from "../../runtime/errors.js";
import { isUncPath } from "../../website/command.js";
import { extractHypothesis } from "./parse.js";

const exec = promisify(execFile);

export interface CursorExecutable {
  command: string;
  prefixArgs: string[];
  version: string;
  help: string;
}

function windowsShellNeeded(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function tryVersion(
  command: string,
  prefixArgs: string[],
): Promise<CursorExecutable | undefined> {
  try {
    const { stdout, stderr } = await exec(command, [...prefixArgs, "--version"], {
      timeout: 15_000,
      windowsHide: true,
      shell: windowsShellNeeded(command),
    });
    const version = `${stdout}${stderr}`.trim().split(/\r?\n/)[0]?.trim();
    if (!version) return undefined;
    let help = "";
    try {
      const helpResult = await exec(command, [...prefixArgs, "--help"], {
        timeout: 15_000,
        windowsHide: true,
        shell: windowsShellNeeded(command),
      });
      help = `${helpResult.stdout}${helpResult.stderr}`;
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      help = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    return { command, prefixArgs, version, help };
  } catch {
    return undefined;
  }
}

/** Стандартные пути установки CLI, даже если их нет в PATH. */
export async function defaultCursorInstallCandidates(): Promise<
  Array<{ command: string; prefixArgs: string[] }>
> {
  const candidates: Array<{ command: string; prefixArgs: string[] }> = [];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      for (const name of ["agent.cmd", "cursor-agent.cmd"] as const) {
        const full = join(local, "cursor-agent", name);
        if (await pathExists(full)) candidates.push({ command: full, prefixArgs: [] });
      }
    }
  } else {
    const home = process.env.HOME;
    if (home) {
      for (const relative of [
        ".local/bin/agent",
        ".local/bin/cursor-agent",
        ".cursor/bin/agent",
      ] as const) {
        const full = join(home, relative);
        if (await pathExists(full)) candidates.push({ command: full, prefixArgs: [] });
      }
    }
  }
  return candidates;
}

export async function resolveCursorExecutable(): Promise<CursorExecutable> {
  const candidates: Array<{ command: string; prefixArgs: string[] }> = [
    { command: "agent", prefixArgs: [] },
    { command: "cursor-agent", prefixArgs: [] },
    { command: "cursor", prefixArgs: ["agent"] },
    ...(await defaultCursorInstallCandidates()),
  ];
  for (const candidate of candidates) {
    const resolved = await tryVersion(candidate.command, candidate.prefixArgs);
    if (resolved) return resolved;
  }
  throw new Error(
    "Cursor Agent CLI not found. Install it (https://cursor.com/docs/cli/installation) and ensure `agent` is on PATH (or under %LOCALAPPDATA%\\cursor-agent on Windows).",
  );
}

function supportsFlag(help: string, flag: string): boolean {
  return help.includes(flag);
}

export class CursorAgent implements CodingAgent {
  private executable?: CursorExecutable;

  async version(): Promise<string> {
    this.executable = await resolveCursorExecutable();
    return `cursor-cli ${this.executable.version}`;
  }

  async assertReady(): Promise<string> {
    const executable = this.executable ?? (await resolveCursorExecutable());
    this.executable = executable;
    const versionLabel = `cursor-cli ${executable.version}`;

    if (process.env.CURSOR_API_KEY?.trim())
      return `${versionLabel}; auth via CURSOR_API_KEY`;

    if (!supportsFlag(executable.help, "status") && !/\bstatus\b/.test(executable.help))
      return `${versionLabel}; auth status command unavailable (skipped)`;

    try {
      const { stdout, stderr } = await exec(
        executable.command,
        [...executable.prefixArgs, "status", "--format", "json"],
        {
          timeout: 30_000,
          windowsHide: true,
          shell: windowsShellNeeded(executable.command),
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      const raw = `${stdout}${stderr}`.trim();
      const jsonStart = raw.indexOf("{");
      const parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw) as {
        isAuthenticated?: boolean;
        status?: string;
        userInfo?: { email?: string };
      };
      if (parsed.isAuthenticated !== true && parsed.status !== "authenticated") {
        throw new Error(
          `Cursor Agent is not authenticated (status=${String(parsed.status ?? "unknown")}). Run: agent login`,
        );
      }
      const email = parsed.userInfo?.email ? ` as ${parsed.userInfo.email}` : "";
      return `${versionLabel}; authenticated${email}`;
    } catch (error) {
      const message = errorMessage(error);
      if (/not authenticated|Authentication required|agent login/i.test(message))
        throw new Error(
          `Cursor Agent is not authenticated. Run: agent login\n(${message})`,
        );
      if (error instanceof SyntaxError || /JSON/i.test(message))
        throw new Error(
          `Cursor Agent auth status could not be parsed. Run: agent login\n(${message})`,
        );
      throw new Error(
        `Cursor Agent is not ready for --agent. Install CLI, run \`agent login\`, or set CURSOR_API_KEY.\n(${message})`,
      );
    }
  }

  async run(request: AgentRequest): Promise<unknown> {
    const { cwd, outputDirectory, settings, prompt, signal } = request;
    signal.throwIfAborted();
    if (request.tools.length)
      throw new Error(
        "Cursor Agent MVP runs verification externally; agent tools are not supported",
      );

    const executable = this.executable ?? (await resolveCursorExecutable());
    this.executable = executable;
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "prompt.txt"), prompt);

    const args = [...executable.prefixArgs];
    if (supportsFlag(executable.help, "--print") || supportsFlag(executable.help, "-p"))
      args.push("--print");
    if (supportsFlag(executable.help, "--force") || supportsFlag(executable.help, "-f"))
      args.push("--force");
    if (supportsFlag(executable.help, "--trust")) args.push("--trust");
    if (supportsFlag(executable.help, "--workspace")) {
      args.push("--workspace", cwd);
    }
    if (settings.model && settings.model !== "auto" && supportsFlag(executable.help, "--model")) {
      args.push("--model", settings.model);
    }
    if (supportsFlag(executable.help, "--output-format")) {
      args.push("--output-format", "text");
    }
    args.push(prompt);

    await writeFile(
      join(outputDirectory, "command.json"),
      JSON.stringify(
        { executable: executable.command, args: args.map((part) => (part === prompt ? "<prompt>" : part)), cwd },
        null,
        2,
      ),
    );

    const started = Date.now();
    // CMD.EXE не умеет UNC cwd (\\wsl.localhost\...). Проект передаём через
    // --workspace; процесс стартуем из локальной папки артефактов.
    const spawnCwd =
      process.platform === "win32" && isUncPath(cwd) ? outputDirectory : cwd;
    const child = spawn(executable.command, args, {
      cwd: spawnCwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: windowsShellNeeded(executable.command),
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const abort = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();

    let exitCode: number | null = null;
    try {
      exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code));
      });
    } finally {
      signal.removeEventListener("abort", abort);
    }

    await writeFile(join(outputDirectory, "stdout.txt"), stdout);
    await writeFile(join(outputDirectory, "stderr.txt"), stderr);
    await writeFile(
      join(outputDirectory, "result.json"),
      `${JSON.stringify(
        {
          exitCode,
          durationMs: Date.now() - started,
          aborted: signal.aborted,
        },
        null,
        2,
      )}\n`,
    );

    signal.throwIfAborted();
    if (exitCode !== 0) {
      throw new Error(
        `Cursor Agent exited with code ${exitCode}: ${stderr.trim() || stdout.trim() || "no output"}`,
      );
    }

    let response: unknown;
    try {
      response = JSON.parse(stdout.trim()) as unknown;
    } catch {
      const hypothesis = extractHypothesis(stdout || stderr);
      if (!hypothesis)
        throw new Error(
          `Cursor Agent returned no parseable hypothesis: ${errorMessage(new Error(stdout || stderr || "empty"))}`,
        );
      response = { hypothesis, raw: stdout };
    }

    await writeFile(
      join(outputDirectory, "response.json"),
      `${JSON.stringify(response, null, 2)}\n`,
    );
    return response;
  }
}
