import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { WebsitePipelineOptions } from "../website/pipeline.js";
import { executeWebsitePipeline } from "../website/pipeline.js";
import type { PipelineProgress } from "../website/progress.js";
import type { WebsiteReport } from "../website/report.js";
import {
  listStoredConfigs,
  openStoredConfig,
  saveStoredConfig,
} from "./configs.js";
import { plainError } from "./reportView.js";
import { buildGuiRun, type GuiFormBody } from "./form.js";
import { assertGitRepository, pickFolder } from "./repository.js";

export type PipelineExecutor = (
  options: WebsitePipelineOptions,
) => Promise<{ directory: string; report: WebsiteReport }>;

export interface RunView {
  status: "running" | "completed" | "failed" | "interrupted";
  mode: "measure" | "validate" | "optimize";
  directory?: string;
  progress?: PipelineProgress;
  error?: string;
}

interface CurrentRun {
  id: string;
  mode: "measure" | "validate" | "optimize";
  startedAt: string;
  status: RunView["status"];
  directory?: string;
  progress?: PipelineProgress;
  stopReason?: string;
  error?: string;
  controller: AbortController;
}

export interface GuiServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function configRequest(value: unknown): { name: string; form?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ожидается объект: запрос");
  const body = value as { name?: unknown; form?: unknown };
  if (typeof body.name !== "string" || !body.name.trim())
    throw new Error("Укажите имя конфига");
  return { name: body.name, form: body.form };
}

function guiError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
  });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Слишком большое тело запроса"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error("Тело запроса не является JSON"));
      }
    });
    request.on("error", reject);
  });
}

async function latestRunDirectory(root: string): Promise<string | undefined> {
  const base = join(root, "runs", "website");
  let names: string[];
  try {
    const entries = await readdir(base, { withFileTypes: true });
    names = entries
      .filter((entry) => entry.isDirectory() && entry.name !== "validate")
      .map((entry) => entry.name)
      .sort();
  } catch {
    return undefined;
  }
  for (let index = names.length - 1; index >= 0; index -= 1) {
    const directory = join(base, names[index] ?? "");
    try {
      await stat(join(directory, "report.json"));
      return directory;
    } catch {
      // каталог без отчёта пропускаем
    }
  }
  return undefined;
}

function modeOf(report: WebsiteReport): RunView["mode"] {
  if (report.stopReason?.startsWith("Validation OK")) return "validate";
  if (
    report.attempts.length > 0 ||
    (report.git && report.git.optimizationBranch !== report.git.originalBranch)
  )
    return "optimize";
  if (!report.baseline && !report.git) return "validate";
  return "measure";
}

async function rememberedRun(root: string): Promise<RunView | null> {
  const directory = await latestRunDirectory(root);
  const report = await readReport(directory);
  if (!directory || !report) return null;
  const status = report.status === "running" ? "interrupted" : report.status;
  return {
    status,
    mode: modeOf(report),
    directory,
    error: status === "failed" ? plainError(report.stopReason) : undefined,
  };
}

async function readReport(
  directory: string | undefined,
): Promise<WebsiteReport | undefined> {
  if (!directory) return undefined;
  try {
    const raw = await readFile(join(directory, "report.json"), "utf8");
    return JSON.parse(raw) as WebsiteReport;
  } catch {
    return undefined;
  }
}

async function serveStatic(
  root: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const relativePath =
    pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const file = resolve(root, relativePath);
  const fromRoot = relative(resolve(root), file);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    sendJson(response, 403, { error: "Путь вне статики" });
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
      "content-length": body.length,
    });
    response.end(body);
  } catch {
    sendJson(response, 404, {
      error: "Страница не собрана. Запустите npm run gui.",
    });
  }
}

export async function startGuiServer(options: {
  root: string;
  port?: number;
  execute?: PipelineExecutor;
  staticRoot?: string;
  pickDirectory?: () => Promise<string | undefined>;
}): Promise<GuiServer> {
  const execute = options.execute ?? executeWebsitePipeline;
  const pickDirectory = options.pickDirectory ?? pickFolder;
  const staticRoot =
    options.staticRoot ?? join(options.root, "src", "gui", "web", "dist");
  let current: CurrentRun | undefined;

  async function snapshot(): Promise<RunView | null> {
    if (!current) return rememberedRun(options.root);
    return {
      status: current.status,
      mode: current.mode,
      directory: current.directory,
      progress: current.progress,
      error: current.error,
    };
  }

  async function reportDirectory(): Promise<string | undefined> {
    if (current) return current.directory;
    return latestRunDirectory(options.root);
  }

  function finish(id: string, patch: Partial<CurrentRun>): void {
    if (current?.id !== id) return;
    current = { ...current, ...patch };
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, 500, { error: guiError(error) });
    });
  });

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    if (!path.startsWith("/api")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Метод не поддерживается" });
        return;
      }
      await serveStatic(staticRoot, path, response);
      return;
    }

    try {
      if (request.method === "GET" && path === "/api/configs") {
        sendJson(response, 200, {
          configs: await listStoredConfigs(options.root),
        });
        return;
      }
      if (request.method === "POST" && path === "/api/configs") {
        const body = configRequest(await readBody(request));
        const name = await saveStoredConfig(
          options.root,
          body.name,
          body.form as GuiFormBody,
        );
        sendJson(response, 200, { name });
        return;
      }
      if (request.method === "POST" && path === "/api/configs/open") {
        const body = configRequest(await readBody(request));
        const form = await openStoredConfig(options.root, body.name);
        sendJson(response, 200, { form });
        return;
      }
      if (request.method === "POST" && path === "/api/repository") {
        const directory = await pickDirectory();
        if (!directory) {
          sendJson(response, 200, { path: null });
          return;
        }
        await assertGitRepository(directory);
        sendJson(response, 200, { path: directory });
        return;
      }
      if (request.method === "POST" && path === "/api/runs") {
        if (current?.status === "running") {
          sendJson(response, 409, { error: "Пайплайн уже выполняется" });
          return;
        }
        const plan = buildGuiRun(await readBody(request));
        const controller = new AbortController();
        const id = randomUUID();
        current = {
          id,
          mode: plan.mode,
          startedAt: new Date().toISOString(),
          status: "running",
          controller,
        };
        let pending: ReturnType<PipelineExecutor>;
        try {
          pending = execute({
            root: options.root,
            config: plan.config,
            measureOnly: plan.measureOnly,
            validateOnly: plan.validateOnly,
            agentProvider: plan.agentProvider,
            signal: controller.signal,
            onRunDirectory: (directory) => finish(id, { directory }),
            onProgress: (progress) => finish(id, { progress }),
          });
        } catch (error) {
          finish(id, { status: "failed", error: guiError(error) });
          sendJson(response, 500, { error: guiError(error) });
          return;
        }
        void Promise.resolve(pending)
          .then((result) => {
            finish(id, {
              status:
                result.report.status === "running"
                  ? "completed"
                  : result.report.status,
              directory: result.directory,
              stopReason: result.report.stopReason,
            });
          })
          .catch((error: unknown) => {
            finish(id, {
              status: controller.signal.aborted ? "interrupted" : "failed",
              error: guiError(error),
            });
          });
        sendJson(response, 202, { ok: true });
        return;
      }
      if (request.method === "POST" && path === "/api/runs/current/abort") {
        if (current?.status !== "running") {
          sendJson(response, 409, { error: "Нет выполняющегося пайплайна" });
          return;
        }
        current.controller.abort(new Error("Остановлено из GUI"));
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && path === "/api/runs/current") {
        sendJson(response, 200, { run: await snapshot() });
        return;
      }
      if (request.method === "GET" && path === "/api/runs/current/report") {
        sendJson(response, 200, {
          report: (await readReport(await reportDirectory())) ?? null,
        });
        return;
      }
      sendJson(response, 404, { error: "Неизвестный маршрут" });
    } catch (error) {
      sendJson(response, 400, { error: guiError(error) });
    }
  }

  await new Promise<void>((listenResolve, listenReject) => {
    server.once("error", listenReject);
    server.listen(options.port ?? 0, "127.0.0.1", () => listenResolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Не удалось определить порт GUI");
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((closeResolve, closeReject) => {
        current?.controller.abort(new Error("Сервер GUI останавливается"));
        server.close((error) => (error ? closeReject(error) : closeResolve()));
      }),
  };
}
