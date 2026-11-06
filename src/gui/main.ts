import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { executeWebsitePipeline } from "../website/pipeline.js";
import { startGuiServer } from "./server.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const port = Number(process.env.CWV_GUI_PORT ?? 4178);

function openBrowser(url: string): void {
  if (process.env.CWV_GUI_OPEN === "0") return;
  const command =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

async function waitForUrl(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Dev-сервер ещё поднимается.
    }
    await delay(200);
  }
  throw new Error(`Vite не открылся: ${url}`);
}

function startVite(apiPort: number): ChildProcess {
  const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
  return spawn(
    process.execPath,
    [
      viteBin,
      "--config",
      "src/gui/web/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, CWV_GUI_PORT: String(apiPort) },
    },
  );
}

if (!Number.isInteger(port) || port < 1) {
  console.error("CWV_GUI_PORT должен быть целым портом");
  process.exitCode = 1;
} else {
  const gui = await startGuiServer({
    root,
    port,
    execute: executeWebsitePipeline,
  });
  const vite = startVite(gui.port);
  const page = "http://127.0.0.1:5173/";
  let stopping = false;
  const shutdown = async (code: number) => {
    if (stopping) return;
    stopping = true;
    vite.kill("SIGTERM");
    await gui.close();
    process.exit(code);
  };
  vite.on("exit", (code) => {
    if (!stopping) void shutdown(code ?? 1);
  });
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  try {
    await waitForUrl(page);
    console.log(`GUI: ${page}`);
    console.log(`API: ${gui.url}`);
    openBrowser(page);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await shutdown(1);
  }
}
