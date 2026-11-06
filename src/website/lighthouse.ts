import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebsiteConfig } from "./config.js";

export async function runLighthouseAudit(options: {
  config: WebsiteConfig;
  url: string;
  artifactDirectory: string;
  label: string;
}): Promise<Record<string, unknown> | null> {
  if (options.config.lighthouse && options.config.lighthouse.enabled === false)
    return null;
  await mkdir(options.artifactDirectory, { recursive: true });
  try {
    const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
      import("lighthouse"),
      import("chrome-launcher"),
    ]);
    const chrome = await chromeLauncher.launch({
      chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
    });
    try {
      const result = await lighthouse(options.url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        formFactor: options.config.lighthouse?.formFactor ?? "mobile",
        screenEmulation: {
          mobile: (options.config.lighthouse?.formFactor ?? "mobile") === "mobile",
          width: options.config.browser.viewport.width,
          height: options.config.browser.viewport.height,
          deviceScaleFactor: options.config.browser.deviceScaleFactor,
          disabled: false,
        },
        onlyCategories: ["performance"],
      });
      const report = (result?.lhr as Record<string, unknown> | undefined) ?? null;
      await writeFile(
        join(options.artifactDirectory, `${options.label}-lighthouse.json`),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      return report;
    } finally {
      await chrome.kill();
    }
  } catch (error) {
    await writeFile(
      join(options.artifactDirectory, `${options.label}-lighthouse-error.txt`),
      String(error),
    );
    return null;
  }
}
