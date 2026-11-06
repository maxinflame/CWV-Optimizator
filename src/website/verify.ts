import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { chromium } from "playwright";
import type { WebsiteConfig } from "./config.js";
import type { ProductionServer } from "./server.js";
import { spawnCommand } from "./command.js";

async function run(command: string, cwd: string, signal: AbortSignal): Promise<void> {
  const child = spawnCommand(command, cwd, process.env);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const abort = () => child.kill("SIGTERM");
  signal.addEventListener("abort", abort, { once: true });
  try {
    const code = await new Promise<number | null>((resolvePromise, reject) => {
      child.on("error", reject);
      child.on("close", (value) => resolvePromise(value));
    });
    if (signal.aborted) throw new Error("Interrupted");
    if (code !== 0) throw new Error(`Command failed (${code}): ${command}\n${stderr}`);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function runProjectTests(
  config: WebsiteConfig,
  projectPath: string,
  signal: AbortSignal,
): Promise<void> {
  if (!config.website.testCommand) return;
  const cwd = config.website.cwd ? join(projectPath, config.website.cwd) : projectPath;
  await run(config.website.testCommand, cwd, signal);
}

export async function smokeTest(
  config: WebsiteConfig,
  server: ProductionServer,
  artifactDirectory: string,
): Promise<void> {
  await mkdir(artifactDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: config.browser.viewport,
      deviceScaleFactor: config.browser.deviceScaleFactor,
    });
    const page = await context.newPage();
    for (const pageConfig of config.pages) {
      const url = new URL(pageConfig.path, `${server.baseUrl}/`).href;
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (!response || response.status() >= 500)
        throw new Error(`Smoke test failed for ${url}: HTTP ${response?.status()}`);
      for (const selector of pageConfig.criticalSelectors ?? []) {
        const visible = await page.isVisible(selector);
        if (!visible)
          throw new Error(`Critical selector not visible on ${pageConfig.id}: ${selector}`);
      }
      if (config.verification.visualRegression) {
        const shot = await page.screenshot({ fullPage: true });
        await writeFile(join(artifactDirectory, `${pageConfig.id}.png`), shot);
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

export async function fingerprintProtectedPaths(
  projectPath: string,
  extraPaths: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const relativePath of extraPaths) {
    const full = resolve(projectPath, relativePath);
    try {
      const content = await readFile(full);
      result[relativePath] = createHash("sha256").update(content).digest("hex");
    } catch {
      // optional
    }
  }
  return result;
}

export function assertFingerprintsUnchanged(
  before: Record<string, string>,
  after: Record<string, string>,
  label: string,
): void {
  for (const [key, hash] of Object.entries(before)) {
    if (after[key] !== hash)
      throw new Error(`${label} changed during optimization: ${key}`);
  }
}

export async function listHtmlAssets(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.(html|css|js|mjs|cjs|tsx?|jsx?)$/i.test(entry.name))
        files.push(relative(root, full));
    }
  }
  await walk(root);
  return files;
}
