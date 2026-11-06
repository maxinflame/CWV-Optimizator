import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Открывает системный выбор каталога. Пустой результат — пользователь закрыл окно. */
export async function pickFolder(): Promise<string | undefined> {
  try {
    const { stdout } =
      process.platform === "win32"
        ? await execFileAsync(
            "powershell.exe",
            [
              "-NoProfile",
              "-STA",
              "-Command",
              [
                "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
                "Add-Type -AssemblyName System.Windows.Forms",
                "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
                "$dialog.Description = 'Репозиторий для проверки'",
                "$dialog.ShowNewFolderButton = $false",
                "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
                "  [Console]::Out.Write($dialog.SelectedPath)",
                "}",
              ].join("\n"),
            ],
            { windowsHide: false, encoding: "utf8" },
          )
        : process.platform === "darwin"
          ? await execFileAsync(
              "osascript",
              [
                "-e",
                'POSIX path of (choose folder with prompt "Репозиторий для проверки")',
              ],
              { encoding: "utf8" },
            )
          : await execFileAsync(
              "zenity",
              [
                "--file-selection",
                "--directory",
                "--title=Репозиторий для проверки",
              ],
              { encoding: "utf8" },
            );
    const path = stdout.trim().replace(/\/$/, "");
    return path || undefined;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === 1) return undefined;
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function assertGitRepository(path: string): Promise<void> {
  try {
    await access(join(path, ".git"));
  } catch {
    throw new Error("Выбранный каталог не является Git-репозиторием");
  }
}
