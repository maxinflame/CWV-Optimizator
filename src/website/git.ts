import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

const exec = promisify(execFile);

export interface GitState {
  projectPath: string;
  originalBranch: string;
  originalCommit: string;
  optimizationBranch: string;
  baselineCommit: string;
  acceptedCommit: string;
  candidateCommit?: string;
}

export class GitWorkspace {
  readonly logPath: string;

  constructor(
    readonly projectPath: string,
    readonly runDirectory: string,
  ) {
    this.logPath = join(runDirectory, "git-operations.jsonl");
  }

  private async git(
    args: string[],
    options: { allowFailure?: boolean } = {},
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const started = new Date().toISOString();
    try {
      const { stdout, stderr } = await exec("git", ["-C", this.projectPath, ...args], {
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      await this.log({ started, args, code: 0, stdout, stderr });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      const code = typeof err.code === "number" ? err.code : 1;
      await this.log({
        started,
        args,
        code,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? String(error),
      });
      if (options.allowFailure)
        return {
          stdout: err.stdout ?? "",
          stderr: err.stderr ?? String(error),
          code,
        };
      throw new Error(
        `Git failed (${args.join(" ")}): ${err.stderr ?? err.stdout ?? String(error)}`,
      );
    }
  }

  private async log(entry: Record<string, unknown>): Promise<void> {
    await mkdir(this.runDirectory, { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(entry)}\n`);
  }

  async assertRepository(): Promise<void> {
    const { code, stdout } = await this.git(["rev-parse", "--is-inside-work-tree"], {
      allowFailure: true,
    });
    if (code !== 0 || stdout.trim() !== "true")
      throw new Error(`Not a Git repository: ${this.projectPath}`);
    const top = await this.git(["rev-parse", "--show-toplevel"]);
    const topPath = await realpath(top.stdout.trim());
    const project = await realpath(resolve(this.projectPath));
    if (topPath.toLowerCase() !== project.toLowerCase())
      throw new Error(
        `Website path must be the Git repository root (got ${top.stdout.trim()})`,
      );
  }

  async assertClean(): Promise<void> {
    const status = await this.git(["status", "--porcelain"]);
    if (status.stdout.trim())
      throw new Error(
        "Website Git working tree is not clean. Commit or stash unrelated changes before running the pipeline.",
      );
  }

  async currentBranch(): Promise<string> {
    const { stdout } = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = stdout.trim();
    if (!branch || branch === "HEAD")
      throw new Error("Detached HEAD is not supported; check out a branch first");
    return branch;
  }

  async currentCommit(): Promise<string> {
    const { stdout } = await this.git(["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  async startOptimization(branchPrefix = "cwv-optimize"): Promise<GitState> {
    await this.assertRepository();
    await this.assertClean();
    const originalBranch = await this.currentBranch();
    const originalCommit = await this.currentCommit();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const optimizationBranch = `${branchPrefix}/${stamp}`;
    await this.git(["checkout", "-b", optimizationBranch]);
    const baselineCommit = await this.currentCommit();
    const state: GitState = {
      projectPath: this.projectPath,
      originalBranch,
      originalCommit,
      optimizationBranch,
      baselineCommit,
      acceptedCommit: baselineCommit,
    };
    await this.saveState(state);
    return state;
  }

  async saveState(state: GitState): Promise<void> {
    await mkdir(this.runDirectory, { recursive: true });
    await writeFile(
      join(this.runDirectory, "git-state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
    );
  }

  async loadState(): Promise<GitState> {
    return JSON.parse(
      await readFile(join(this.runDirectory, "git-state.json"), "utf8"),
    ) as GitState;
  }

  async checkoutCommit(commit: string): Promise<void> {
    await this.git(["checkout", "--force", commit]);
    await this.git(["clean", "-fd"]);
  }

  async restoreAccepted(state: GitState): Promise<void> {
    await this.git(["checkout", "--force", state.optimizationBranch]);
    await this.git(["reset", "--hard", state.acceptedCommit]);
    await this.git(["clean", "-fd"]);
    state.candidateCommit = undefined;
    await this.saveState(state);
  }

  async commitCandidate(message: string, state: GitState): Promise<string> {
    await this.git(["add", "-A"]);
    const status = await this.git(["status", "--porcelain"]);
    if (!status.stdout.trim())
      throw new Error("Cursor Agent produced no file changes");
    await this.git(["commit", "-m", message, "--no-verify"]);
    const commit = await this.currentCommit();
    state.candidateCommit = commit;
    await this.saveState(state);
    return commit;
  }

  async acceptCandidate(state: GitState): Promise<void> {
    if (!state.candidateCommit)
      throw new Error("No candidate commit to accept");
    await this.git(["checkout", "--force", state.optimizationBranch]);
    await this.git(["reset", "--hard", state.candidateCommit]);
    state.acceptedCommit = state.candidateCommit;
    state.candidateCommit = undefined;
    await this.saveState(state);
  }

  async discardCandidate(state: GitState): Promise<void> {
    await this.restoreAccepted(state);
  }

  async changedFiles(from: string, to = "HEAD"): Promise<string[]> {
    const { stdout } = await this.git(["diff", "--name-only", from, to]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async ensureOnOptimizationBranch(state: GitState): Promise<void> {
    const branch = await this.currentBranch().catch(() => "HEAD");
    if (branch !== state.optimizationBranch) {
      await this.git(["checkout", "--force", state.optimizationBranch], {
        allowFailure: true,
      });
    }
    const head = await this.currentCommit();
    if (head !== state.acceptedCommit && head !== state.candidateCommit) {
      await this.git(["reset", "--hard", state.acceptedCommit]);
      await this.git(["clean", "-fd"]);
    }
  }
}
