import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

function lockRoot(): string {
  return join(homedir(), ".cwv-optimizator", "locks");
}

function lockPathFor(projectPath: string): string {
  const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 16);
  return join(lockRoot(), `${hash}.lock`);
}

export async function withProjectLock<T>(
  projectPath: string,
  runDirectory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const path = lockPathFor(projectPath);
  await mkdir(lockRoot(), { recursive: true });
  try {
    await writeFile(
      path,
      JSON.stringify(
        {
          pid: process.pid,
          projectPath,
          runDirectory,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      let existing = "";
      try {
        existing = await readFile(path, "utf8");
      } catch {
        existing = "(unreadable)";
      }
      throw new Error(
        `Another optimization run holds the lock for ${projectPath}. Lock file: ${path}\n${existing}`,
      );
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await rm(path, { force: true });
  }
}
