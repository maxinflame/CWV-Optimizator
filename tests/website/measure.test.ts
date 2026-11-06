import { afterAll, beforeAll, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadWebsiteConfig } from "../../src/website/config.js";
import { ProductionServer } from "../../src/website/server.js";
import { WebsiteBenchmarkRunner } from "../../src/website/measure/runner.js";
import { execNpm } from "../../src/website/command.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = join(root, "fixtures", "slow-site");

let server: ProductionServer | undefined;
let runner: WebsiteBenchmarkRunner | undefined;
let artifacts: string | undefined;
const signal = new AbortController().signal;

beforeAll(async () => {
  await execNpm(["run", "build"], fixture);
  artifacts = await mkdtemp(join(tmpdir(), "cwv-measure-"));
  const config = await loadWebsiteConfig(join(root, "website.config.example.ts"));
  config.workspace.path = fixture;
  config.measurements.baselineRepeats = 1;
  config.browser.cpuSlowdownMultiplier = 1;
  config.browser.networkPreset = "NoThrottling";
  config.browser.observationMs = 1500;
  config.lighthouse = { enabled: false };
  server = new ProductionServer(config, fixture, join(artifacts, "logs"));
  await server.start(signal);
  runner = new WebsiteBenchmarkRunner(config, server.baseUrl, artifacts);
  await runner.open();
}, 120_000);

afterAll(async () => {
  await runner?.close();
  await server?.stop();
  if (artifacts) await rm(artifacts, { recursive: true, force: true });
});

it("collects LCP, FCP, CLS and TTFB from a real browser", async () => {
  const result = await runner!.measureOnce("homepage:cold-load");
  expect(result.lcpMs.availability).toBe("available");
  expect(result.lcpMs.value).toBeGreaterThan(0);
  expect(result.fcpMs.availability).toBe("available");
  expect(result.fcpMs.value).toBeGreaterThan(0);
  expect(result.cls.availability).toBe("available");
  expect(result.cls.value).toBeGreaterThanOrEqual(0);
  expect(result.ttfbMs.availability).toBe("available");
  expect(result.ttfbMs.value).toBeGreaterThanOrEqual(0);
}, 60_000);

it("collects INP from an interaction scenario or reports unavailable", async () => {
  const result = await runner!.measureOnce("homepage:interaction");
  expect(["available", "unavailable"]).toContain(result.inpMs.availability);
  if (result.inpMs.availability === "available") {
    expect(result.inpMs.value).toBeGreaterThan(0);
    expect(result.inpAttribution?.eventType).toBeTruthy();
  } else {
    expect(result.inpMs.value).toBeNull();
  }
}, 60_000);
