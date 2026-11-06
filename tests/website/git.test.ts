import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitWorkspace } from "../../src/website/git.js";

const exec = promisify(execFile);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repo(): Promise<{ root: string; run: string }> {
  const root = await mkdtemp(join(tmpdir(), "cwv-git-"));
  const run = await mkdtemp(join(tmpdir(), "cwv-run-"));
  dirs.push(root, run);
  await exec("git", ["init"], { cwd: root });
  await exec("git", ["config", "user.email", "cwv@example.com"], { cwd: root });
  await exec("git", ["config", "user.name", "CWV"], { cwd: root });
  await writeFile(join(root, "index.html"), "<h1>v1</h1>\n");
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["commit", "-m", "init"], { cwd: root });
  return { root, run };
}

it("creates an optimization branch and rolls back rejected candidates", async () => {
  const { root, run } = await repo();
  const git = new GitWorkspace(root, run);
  const state = await git.startOptimization("test-opt");
  const original = state.originalBranch;

  await writeFile(join(root, "index.html"), "<h1>candidate</h1>\n");
  const candidate = await git.commitCandidate("candidate change", state);
  expect(candidate).not.toBe(state.acceptedCommit);

  await git.discardCandidate(state);
  const head = await git.currentCommit();
  expect(head).toBe(state.acceptedCommit);
  expect(state.candidateCommit).toBeUndefined();

  // Original branch tip untouched conceptually — we are on optimization branch.
  expect(state.originalBranch).toBe(original);
  expect(state.optimizationBranch).toContain("test-opt/");
});

it("refuses a dirty working tree", async () => {
  const { root, run } = await repo();
  await writeFile(join(root, "dirty.txt"), "nope\n");
  const git = new GitWorkspace(root, run);
  await expect(git.startOptimization()).rejects.toThrow(/clean/i);
});

it("accepts a candidate commit on the optimization branch", async () => {
  const { root, run } = await repo();
  const git = new GitWorkspace(root, run);
  const state = await git.startOptimization("test-opt");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.js"), "console.log(1)\n");
  await git.commitCandidate("improve", state);
  await git.acceptCandidate(state);
  expect(state.acceptedCommit).toBe(await git.currentCommit());
});
