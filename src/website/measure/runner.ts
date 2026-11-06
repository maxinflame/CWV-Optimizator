import { chromium, type Browser, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebsiteConfig, PageScenarioConfig, ScenarioKind } from "../config.js";
import { collectorInitScript, type CollectorSnapshot } from "./collector.js";
import { runScenarioActions } from "./scenarios.js";
import type { BrowserMeasurement, ScenarioAggregate } from "./types.js";
import { summarize } from "../../metrics.js";

function available(value: number | null | undefined): BrowserMeasurement["lcpMs"] {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0)
    return { value: null, availability: "unavailable" };
  return { value, availability: "available" };
}

function parseScenarioKey(key: string): { pageId: string; kind: ScenarioKind } {
  const index = key.indexOf(":");
  if (index <= 0) throw new Error(`Invalid scenario key: ${key}`);
  return {
    pageId: key.slice(0, index),
    kind: key.slice(index + 1) as ScenarioKind,
  };
}

export class WebsiteBenchmarkRunner {
  private browser?: Browser;

  constructor(
    readonly config: WebsiteConfig,
    readonly baseUrl: string,
    readonly artifactDirectory: string,
  ) {}

  async open(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  private pageConfig(pageId: string): PageScenarioConfig {
    const page = this.config.pages.find((item) => item.id === pageId);
    if (!page) throw new Error(`Unknown page: ${pageId}`);
    return page;
  }

  private async applyThrottling(page: Page): Promise<void> {
    const client = await page.context().newCDPSession(page);
    const cpu = this.config.browser.cpuSlowdownMultiplier ?? 4;
    if (cpu > 1) {
      await client.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    }
    const preset = this.config.browser.networkPreset ?? "Slow4G";
    if (preset !== "NoThrottling") {
      const profiles = {
        Slow4G: {
          offline: false,
          downloadThroughput: ((1.6 * 1024 * 1024) / 8) * 0.9,
          uploadThroughput: ((750 * 1024) / 8) * 0.9,
          latency: 150 * 3.75,
        },
        Fast4G: {
          offline: false,
          downloadThroughput: ((9 * 1024 * 1024) / 8) * 0.9,
          uploadThroughput: ((1.5 * 1024 * 1024) / 8) * 0.9,
          latency: 20 * 3.75,
        },
      } as const;
      await client.send("Network.emulateNetworkConditions", profiles[preset]);
    }
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  }

  async measureOnce(scenarioKey: string): Promise<BrowserMeasurement> {
    const { pageId, kind } = parseScenarioKey(scenarioKey);
    const pageConfig = this.pageConfig(pageId);
    if (!pageConfig.scenarios.includes(kind))
      throw new Error(`Scenario ${kind} is not configured for page ${pageId}`);

    if (!this.browser) throw new Error("Browser is not open");
    const context = await this.browser.newContext({
      viewport: this.config.browser.viewport,
      deviceScaleFactor: this.config.browser.deviceScaleFactor,
      isMobile: this.config.browser.profile === "mobile",
      hasTouch: this.config.browser.profile === "mobile",
      serviceWorkers: "block",
    });
    await context.addInitScript(collectorInitScript);
    const page = await context.newPage();
    const startedAt = new Date().toISOString();
    const url = new URL(pageConfig.path, `${this.baseUrl}/`).href;
    try {
      await this.applyThrottling(page);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const observationMs = this.config.browser.observationMs ?? 3_000;
      await runScenarioActions(page, pageConfig, kind, observationMs);

      // Give late LCP/CLS a moment, then snapshot before unload.
      await page.waitForTimeout(500);
      const snapshot = (await page.evaluate(() => {
        const collector = (
          window as unknown as { __cwvCollector?: { snapshot: () => unknown } }
        ).__cwvCollector;
        if (!collector) throw new Error("CWV collector was not injected");
        return collector.snapshot();
      })) as CollectorSnapshot;

      const finishedAt = new Date().toISOString();
      const inp = snapshot.inp;
      let inputDelay: number | null = null;
      let processingDuration: number | null = null;
      let presentationDelay: number | null = null;
      if (inp && inp.processingStart != null && inp.startTime != null) {
        inputDelay = Math.max(0, inp.processingStart - inp.startTime);
        processingDuration = Math.max(
          0,
          (inp.processingEnd ?? inp.processingStart) - inp.processingStart,
        );
        presentationDelay = Math.max(
          0,
          inp.value - inputDelay - processingDuration,
        );
      }

      return {
        scenario: scenarioKey,
        pageId,
        scenarioKind: kind,
        url,
        startedAt,
        finishedAt,
        lcpMs: available(snapshot.lcp?.value ?? null),
        fcpMs: available(snapshot.fcp),
        cls: available(snapshot.cls?.value ?? null),
        inpMs:
          kind === "interaction"
            ? available(inp?.value ?? null)
            : available(inp?.value ?? null),
        ttfbMs: available(snapshot.ttfb),
        lcpAttribution: snapshot.lcp
          ? {
              element: snapshot.lcp.element,
              url: snapshot.lcp.url,
              ttfb: snapshot.lcp.ttfb ?? snapshot.ttfb,
              resourceLoadDelay: snapshot.lcp.resourceLoadDelay,
              resourceLoadDuration: snapshot.lcp.resourceLoadDuration,
              elementRenderDelay: snapshot.lcp.elementRenderDelay,
            }
          : undefined,
        clsAttribution: {
          largestShiftValue: snapshot.cls.largestShiftValue,
          sources: snapshot.cls.sources,
        },
        inpAttribution: inp
          ? {
              eventTarget: inp.eventTarget,
              eventType: inp.eventType,
              inputDelay,
              processingDuration,
              presentationDelay,
            }
          : undefined,
        diagnostics: {
          longAnimationFrames: snapshot.longAnimationFrames,
          resourceTransferBytes: snapshot.resourceTransferBytes,
          jsTransferBytes: snapshot.jsTransferBytes,
          cssTransferBytes: snapshot.cssTransferBytes,
        },
        raw: snapshot,
      };
    } finally {
      await context.close();
    }
  }

  async measureBatch(
    scenarioKey: string,
    repeats: number,
    label: string,
  ): Promise<ScenarioAggregate> {
    await mkdir(this.artifactDirectory, { recursive: true });
    const samples: BrowserMeasurement[] = [];
    for (let index = 0; index < repeats; index++) {
      const sample = await this.measureOnce(scenarioKey);
      samples.push(sample);
      await writeFile(
        join(this.artifactDirectory, `${label}-${scenarioKey.replace(":", "_")}-${index + 1}.json`),
        `${JSON.stringify(sample, null, 2)}\n`,
      );
    }
    return aggregateSamples(scenarioKey, samples);
  }
}

export function aggregateSamples(
  scenario: string,
  samples: BrowserMeasurement[],
): ScenarioAggregate {
  const keys = ["lcpMs", "fcpMs", "cls", "inpMs", "ttfbMs"] as const;
  const medians: ScenarioAggregate["medians"] = {};
  const variability: ScenarioAggregate["variability"] = {};
  for (const key of keys) {
    const values = samples
      .map((sample) => sample[key])
      .filter((value) => value.availability === "available" && value.value !== null)
      .map((value) => value.value as number);
    if (!values.length) {
      medians[key] = null;
      variability[key] = null;
      continue;
    }
    const stats = summarize(values);
    medians[key] = stats.median;
    variability[key] = stats.spread;
  }
  return { scenario, samples, medians, variability };
}
