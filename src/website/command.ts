import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Resolve a runnable npm executable on Windows/macOS/Linux. */
export function npmCommand(): string {
  if (process.platform === "win32") return "npm.cmd";
  return "npm";
}

export function rewriteNpmCommand(command: string): string {
  if (process.platform !== "win32") return command;
  return command.replace(/^\s*npm(\s|$)/, "npm.cmd$1");
}

/** UNC paths like \\wsl.localhost\... — CMD.EXE не принимает их как текущую папку. */
export function isUncPath(path: string): boolean {
  return /^\s*[\\/]{2}[^\\/]/.test(path);
}

export interface WslUncTarget {
  distro: string;
  linuxPath: string;
}

/**
 * Разбирает \\wsl.localhost\<distro>\... и \\wsl$\<distro>\...
 * в distro + POSIX-путь внутри WSL.
 */
export function parseWslUncPath(path: string): WslUncTarget | undefined {
  const normalized = path.replace(/\//g, "\\").replace(/^\\+/, "\\\\");
  const match = normalized.match(
    /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)$/i,
  );
  if (!match) return undefined;
  const distro = match[1]!;
  const rest = match[2] ?? "";
  const linuxPath = `/${rest.replace(/\\/g, "/")}`.replace(/\/+/g, "/");
  return { distro, linuxPath };
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Скрипт для bash внутри WSL: cd, linux-only PATH (без /mnt/c npm.cmd), команда.
 * Передаём через base64, чтобы Windows/Git Bash не раскрывали $() и пробелы.
 */
export function buildWslBashScript(linuxPath: string, command: string): string {
  return [
    `cd ${shellSingleQuote(linuxPath)} || exit 1`,
    `PATH="$(printf '%s' "$PATH" | tr ':' '\\n' | grep -v -E '^/mnt/[a-zA-Z]' | paste -sd: -)"`,
    `export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"`,
    `if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi`,
    `hash -r`,
    command,
  ].join("\n");
}

export function wslDirectSpawn(
  distro: string,
  linuxPath: string,
  command: string,
): { file: string; args: string[] } {
  const script = buildWslBashScript(linuxPath, command);
  const encoded = Buffer.from(script, "utf8").toString("base64");
  // bash читает скрипт из base64 — без раскрытия переменных внешней оболочкой.
  return {
    file: "wsl.exe",
    args: [
      "-d",
      distro,
      "--",
      "bash",
      "-lc",
      `echo ${encoded} | base64 -d | bash -s`,
    ],
  };
}

/**
 * На Windows:
 * - WSL UNC → команда внутри distro через wsl.exe (нужны linux node_modules);
 * - прочий UNC → pushd/popd (CMD не умеет UNC cwd);
 * - иначе обычный cwd.
 */
export function wrapCommandForCwd(
  command: string,
  cwd: string,
): {
  command: string;
  cwd?: string;
  direct?: { file: string; args: string[] };
} {
  if (process.platform !== "win32") return { command, cwd };

  const wsl = parseWslUncPath(cwd);
  if (wsl) {
    const direct = wslDirectSpawn(wsl.distro, wsl.linuxPath, command);
    return {
      command: `${direct.file} ${direct.args.join(" ")}`,
      direct,
    };
  }

  if (isUncPath(cwd)) {
    const escaped = cwd.replace(/"/g, '""');
    return {
      command: `pushd "${escaped}" && ${command} && popd`,
    };
  }

  return { command, cwd };
}

export async function execNpm(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === "win32") {
    const wsl = parseWslUncPath(cwd);
    if (wsl) {
      const direct = wslDirectSpawn(
        wsl.distro,
        wsl.linuxPath,
        `npm ${args.map(shellSingleQuote).join(" ")}`,
      );
      return execFileAsync(direct.file, direct.args, {
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });
    }
    const rewritten = `${npmCommand()} ${args.join(" ")}`;
    const wrapped = wrapCommandForCwd(rewritten, cwd);
    return execFileAsync(wrapped.command, {
      cwd: wrapped.cwd,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      shell: true,
    });
  }
  return execFileAsync(npmCommand(), args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export interface SpawnCommandOptions {
  /** Unix: отдельная группа процессов, чтобы остановить сервер вместе с потомками. */
  detached?: boolean;
}

export function spawnCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: SpawnCommandOptions = {},
): ReturnType<typeof spawn> {
  if (process.platform === "win32") {
    // Для WSL UNC оставляем исходную команду (npm, не npm.cmd) — внутри Linux.
    // detached на Windows открывает отдельное окно и не нужен: дерево гасит taskkill.
    const forWrap = parseWslUncPath(cwd) ? command : rewriteNpmCommand(command);
    const wrapped = wrapCommandForCwd(forWrap, cwd);
    if (wrapped.direct) {
      return spawn(wrapped.direct.file, wrapped.direct.args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    }
    return spawn(wrapped.command, {
      cwd: wrapped.cwd,
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  }

  const rewritten = rewriteNpmCommand(command);
  const match = rewritten.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const parts = match.map((part) =>
    part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part,
  );
  const file = parts[0];
  if (!file) throw new Error(`Empty command: ${command}`);
  return spawn(file, parts.slice(1), {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: options.detached === true,
  });
}

function processAlreadyGone(error: unknown): boolean {
  const stderr =
    error && typeof error === "object" && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  return /not found|no such process|не найден/i.test(`${message}\n${stderr}`);
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
  }
}

/**
 * Завершает процесс и его потомков.
 * На Windows `child.kill()` убивает только оболочку (`cmd` / `npm`), а `node`,
 * слушающий порт, остаётся. `taskkill /T` гасит всё дерево.
 */
export async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
      });
    } catch (error) {
      if (processAlreadyGone(error)) return;
      throw error;
    }
    return;
  }
  signalGroup(pid, signal);
}
