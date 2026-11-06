import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  startGuiServer,
  type GuiServer,
  type PipelineExecutor,
} from "../../src/gui/server.js";
import type { WebsitePipelineOptions } from "../../src/website/pipeline.js";
import type { PipelineProgress } from "../../src/website/progress.js";
import {
  createWebsiteReport,
  saveWebsiteReport,
} from "../../src/website/report.js";
import { sampleForm } from "./sample.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const servers: GuiServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function open(options: {
  root: string;
  execute?: PipelineExecutor;
  staticRoot?: string;
  pickDirectory?: () => Promise<string | undefined>;
}): Promise<GuiServer> {
  const server = await startGuiServer({
    ...options,
    port: 0,
    execute:
      options.execute ??
      (async () => {
        throw new Error("Пайплайн в тесте не запускается");
      }),
  });
  servers.push(server);
  return server;
}

it("принимает выбранный Git-репозиторий и отказ от выбора", async () => {
  const repo = await mkdtemp(join(tmpdir(), "cwv-repo-"));
  await mkdir(join(repo, ".git"));
  const plain = await mkdtemp(join(tmpdir(), "cwv-plain-"));
  try {
    const chosen = await open({
      root: repoRoot,
      pickDirectory: async () => repo,
    });
    const ok = await fetch(`${chosen.url}/api/repository`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ path: repo });

    const cancelled = await open({
      root: repoRoot,
      pickDirectory: async () => undefined,
    });
    const empty = await fetch(`${cancelled.url}/api/repository`, {
      method: "POST",
    });
    expect(await empty.json()).toEqual({ path: null });

    const rejected = await open({
      root: repoRoot,
      pickDirectory: async () => plain,
    });
    const bad = await fetch(`${rejected.url}/api/repository`, {
      method: "POST",
    });
    expect(bad.status).toBe(400);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(plain, { recursive: true, force: true });
  }
});

it("отклоняет невалидный запуск и не создаёт прогон", async () => {
  const root = await mkdtemp(join(tmpdir(), "cwv-gui-empty-"));
  try {
    const server = await open({ root });
    const response = await fetch(`${server.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ form: { mode: "measure" } }),
    });
    expect(response.status).toBe(400);
    const current = await fetch(`${server.url}/api/runs/current`);
    const body = (await current.json()) as { run: null };
    expect(body.run).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("не принимает второй запуск, пока первый не остановлен", async () => {
  let calls = 0;
  const execute: PipelineExecutor = (options: WebsitePipelineOptions) => {
    calls += 1;
    options.onRunDirectory?.(join(repoRoot, "runs", "website", "mock"));
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        {
          once: true,
        },
      );
    });
  };
  const server = await open({ root: repoRoot, execute });
  const first = await fetch(`${server.url}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ form: sampleForm({ mode: "measure" }) }),
  });
  expect(first.status).toBe(202);
  const second = await fetch(`${server.url}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ form: sampleForm({ mode: "measure" }) }),
  });
  expect(second.status).toBe(409);
  expect(calls).toBe(1);

  const abort = await fetch(`${server.url}/api/runs/current/abort`, {
    method: "POST",
  });
  expect(abort.status).toBe(200);
});

it("отдаёт текущий шаг и отчёт прогона", async () => {
  const root = await mkdtemp(join(tmpdir(), "cwv-gui-report-"));
  const directory = join(root, "run");
  try {
    const execute: PipelineExecutor = async (options) => {
      const report = createWebsiteReport(options.config, new Date());
      report.status = "completed";
      report.stopReason = "Validation OK:\nAgent: cursor-cli";
      await saveWebsiteReport(directory, report);
      options.onRunDirectory?.(directory);
      options.onProgress?.({ phase: "health" });
      return { directory, report };
    };
    const server = await open({ root, execute });
    const started = await fetch(`${server.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ form: sampleForm({ mode: "validate" }) }),
    });
    expect(started.status).toBe(202);
    let body: {
      run: { status: string; progress?: PipelineProgress; mode: string };
    } = { run: { status: "", mode: "" } };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await fetch(`${server.url}/api/runs/current`);
      body = (await current.json()) as typeof body;
      if (body.run.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(body.run.status).toBe("completed");
    expect(body.run.mode).toBe("validate");
    expect(body.run.progress).toEqual({ phase: "health" });
    const report = await fetch(`${server.url}/api/runs/current/report`);
    const saved = (await report.json()) as {
      report: { stopReason?: string } | null;
    };
    expect(saved.report?.stopReason).toContain("Validation OK:");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("сохраняет конфиг через HTTP и открывает его", async () => {
  const root = await mkdtemp(join(tmpdir(), "cwv-gui-config-"));
  try {
    const server = await open({ root });
    const saved = await fetch(`${server.url}/api/configs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "лаба",
        form: sampleForm({ mode: "validate" }),
      }),
    });
    expect(saved.status).toBe(200);
    const listed = (await (
      await fetch(`${server.url}/api/configs`)
    ).json()) as { configs: string[] };
    expect(listed.configs).toEqual(["лаба"]);
    const opened = await fetch(`${server.url}/api/configs/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "лаба" }),
    });
    const body = (await opened.json()) as {
      form: { mode: string };
    };
    expect(body.form.mode).toBe("validate");
    const rejected = await fetch(`${server.url}/api/configs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "..", form: sampleForm() }),
    });
    expect(rejected.status).toBe(400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("отдаёт собранную страницу", async () => {
  const root = await mkdtemp(join(tmpdir(), "cwv-gui-"));
  const staticRoot = join(root, "static");
  await mkdir(staticRoot);
  await writeFile(join(staticRoot, "index.html"), "<p>gui</p>", "utf8");
  try {
    const server = await open({ root, staticRoot });
    const page = await fetch(`${server.url}/`);
    expect(await page.text()).toContain("gui");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("помечает остановленный прогон", async () => {
  const execute: PipelineExecutor = (options) =>
    new Promise((resolve, reject) => {
      const report = createWebsiteReport(options.config, new Date());
      options.signal.addEventListener("abort", () => {
        report.status = "interrupted";
        reject(new Error("aborted"));
      });
    });
  const server = await open({ root: repoRoot, execute });
  await fetch(`${server.url}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ form: sampleForm({ mode: "validate" }) }),
  });
  await fetch(`${server.url}/api/runs/current/abort`, { method: "POST" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const current = await fetch(`${server.url}/api/runs/current`);
  const body = (await current.json()) as { run: { status: string } };
  expect(body.run.status).toBe("interrupted");
});
