import { afterAll, beforeAll, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadWebsiteConfig } from "../../src/website/config.js";
import { ProductionServer } from "../../src/website/server.js";
import type { CollectorSnapshot } from "../../src/website/measure/reports.js";
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
  const config = await loadWebsiteConfig(
    join(root, "website.config.example.ts"),
  );
  config.workspace.path = fixture;
  config.measurements.baselineRepeats = 1;
  config.browser.cpuSlowdownMultiplier = 1;
  config.browser.networkPreset = "NoThrottling";
  config.browser.observationMs = 1500;
  config.lighthouse = { enabled: false };
  config.pages.push(
    {
      id: "stable",
      path: "/stable.html",
      scenarios: ["cold-load"],
      criticalSelectors: ["#stable-title"],
    },
    {
      id: "text",
      path: "/text.html",
      scenarios: ["cold-load"],
      criticalSelectors: ["#text-lcp"],
    },
    {
      id: "image",
      path: "/image.html",
      scenarios: ["cold-load"],
      criticalSelectors: ["#photo"],
    },
  );
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

function snapshotOf(raw: unknown): CollectorSnapshot {
  return raw as CollectorSnapshot;
}

it("collects LCP, FCP and TTFB in Chromium and finalizes before close", async () => {
  const result = await runner!.measureOnce("homepage:cold-load");
  const raw = snapshotOf(result.raw);
  expect(result.lcpMs.availability).toBe("available");
  expect(result.fcpMs.availability).toBe("available");
  expect(result.lcpMs.value).toBeGreaterThan(0);
  expect(result.fcpMs.value).toBeGreaterThanOrEqual(0);
  expect(result.lcpMs.value).toBeGreaterThanOrEqual(result.fcpMs.value ?? 0);
  expect(result.ttfbMs.availability).toBe("available");
  expect(result.ttfbMs.value).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(result.lcpMs.value)).toBe(true);
  expect(Number.isFinite(result.fcpMs.value)).toBe(true);
  expect(result.lcpAttribution?.element).toBeTruthy();
  expect(result.lcpAttribution?.ttfb).toEqual(expect.any(Number));
  expect(result.lcpAttribution?.elementRenderDelay).toEqual(expect.any(Number));
  expect(result.inpMs).toEqual({ value: null, availability: "unavailable" });
  expect(result.diagnostics?.inpUnavailableReason).toBeTruthy();
  expect(result.diagnostics?.longAnimationFrames).toEqual(expect.any(Number));
  expect(result.diagnostics?.resourceTransferBytes).toBeGreaterThanOrEqual(0);
  expect(result.diagnostics?.jsTransferBytes).toBeGreaterThanOrEqual(0);
  expect(result.diagnostics?.cssTransferBytes).toBeGreaterThanOrEqual(0);
  expect(raw.finalized).toBe(true);
  expect(raw.installedReadyState).toBe("loading");
  expect(raw.installedAtMs).toBeGreaterThanOrEqual(0);
  expect(raw.installedAtMs).toBeLessThan(1_000);
  expect(raw.loadedInBackground).toBe(false);
  expect(raw.fatalErrors).toEqual([]);
  expect(raw.ids.lcp).toEqual(expect.any(String));
  expect(raw.ids.fcp).toEqual(expect.any(String));
  expect(raw.ids.ttfb).toEqual(expect.any(String));
  expect(raw.navigationURL && new URL(raw.navigationURL).pathname).toBe("/");
  if (raw.hiddenTrusted) expect(raw.visibility).toBe("hidden");

  const again = await runner!.measureOnce("homepage:cold-load");
  expect(snapshotOf(again.raw).ids.lcp).not.toBe(raw.ids.lcp);
}, 60_000);

it("reports the delayed homepage shift and a stable page with zero CLS", async () => {
  const shifted = await runner!.measureOnce("homepage:cold-load");
  expect(shifted.cls.availability).toBe("available");
  expect(shifted.cls.value).toBeGreaterThan(0);
  expect(shifted.clsAttribution?.sources?.length).toBeGreaterThan(0);

  // Scroll anchoring can hide the same insert while the page is scrolled.
  const scrolled = await runner!.measureOnce("homepage:scroll");
  expect(scrolled.cls.availability).toBe("available");
  expect(scrolled.cls.value).toBeGreaterThanOrEqual(0);

  const stable = await runner!.measureOnce("stable:cold-load");
  expect(stable.cls).toEqual({ value: 0, availability: "available" });
  expect(stable.lcpMs.availability).toBe("available");
  expect(stable.fcpMs.availability).toBe("available");
}, 60_000);

it("attributes text LCP without inventing a resource", async () => {
  const result = await runner!.measureOnce("text:cold-load");
  expect(result.lcpMs.availability).toBe("available");
  expect(result.lcpMs.value).toBeGreaterThan(0);
  expect(result.lcpAttribution?.element?.toLowerCase()).toContain("text-lcp");
  expect(result.lcpAttribution?.url).toBeNull();
  expect(result.lcpAttribution?.resourceLoadDelay).toBeNull();
  expect(result.lcpAttribution?.resourceLoadDuration).toBeNull();
}, 60_000);

it("attributes image LCP with resource timings when Chromium exposes them", async () => {
  const result = await runner!.measureOnce("image:cold-load");
  expect(result.lcpMs.availability).toBe("available");
  expect(result.lcpMs.value).toBeGreaterThan(0);
  expect(result.fcpMs.availability).toBe("available");
  expect(result.lcpMs.value).toBeGreaterThanOrEqual(result.fcpMs.value ?? 0);
  expect(result.lcpAttribution?.element?.toLowerCase()).toContain("photo");
  expect(result.lcpAttribution?.url).toContain("hero.png");
  expect(result.lcpAttribution?.ttfb).toEqual(expect.any(Number));
  expect(result.lcpAttribution?.resourceLoadDelay).toEqual(expect.any(Number));
  expect(result.lcpAttribution?.resourceLoadDuration).toEqual(
    expect.any(Number),
  );
  expect(result.lcpAttribution?.elementRenderDelay).toEqual(expect.any(Number));
}, 60_000);

it("reports INP for a slow click and does not invent one without interaction", async () => {
  const quiet = await runner!.measureOnce("text:cold-load");
  expect(quiet.inpMs).toEqual({ value: null, availability: "unavailable" });

  const result = await runner!.measureOnce("homepage:interaction");
  expect(result.inpMs.availability).toBe("available");
  expect(result.inpMs.value).toBeGreaterThan(40);
  expect(result.inpAttribution?.eventType).toMatch(/pointer|keyboard/);
  expect(result.inpAttribution?.eventTarget).toBeTruthy();
  expect(result.inpAttribution?.inputDelay).toEqual(expect.any(Number));
  expect(result.inpAttribution?.processingDuration).toEqual(expect.any(Number));
  expect(result.inpAttribution?.presentationDelay).toEqual(expect.any(Number));
  const parts =
    (result.inpAttribution?.inputDelay ?? 0) +
    (result.inpAttribution?.processingDuration ?? 0) +
    (result.inpAttribution?.presentationDelay ?? 0);
  expect(Math.abs(parts - (result.inpMs.value ?? 0))).toBeLessThan(1);
  expect(result.diagnostics?.inpUnavailableReason).toBeUndefined();
}, 60_000);
