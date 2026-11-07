import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export type { CollectorController, CollectorSnapshot } from "./reports.js";

const entryPoint = fileURLToPath(
  new URL("./browser/collector-entry.ts", import.meta.url),
);

let bundlePromise: Promise<string> | undefined;

async function createBundle(): Promise<string> {
  let result;
  try {
    result = await build({
      absWorkingDir: fileURLToPath(new URL("../../..", import.meta.url)),
      entryPoints: [entryPoint],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2023",
      write: false,
      sourcemap: false,
      legalComments: "none",
      logLevel: "silent",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to bundle the CWV collector: ${message}`, {
      cause: error,
    });
  }

  const text = result.outputFiles[0]?.text;
  if (!text?.includes("__cwvCollector")) {
    throw new Error("Failed to bundle the CWV collector: bundle is empty");
  }
  return text;
}

/** Браузерный IIFE с web-vitals/attribution. Собирается локально, без CDN. */
export function loadCollectorInitScript(): Promise<string> {
  bundlePromise ??= createBundle().catch((error: unknown) => {
    bundlePromise = undefined;
    throw error;
  });
  return bundlePromise;
}
