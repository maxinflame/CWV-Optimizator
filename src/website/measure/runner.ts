import { chromium, type Browser, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  WebsiteConfig,
  PageScenarioConfig,
  ScenarioKind,
} from "../config.js";
import { loadCollectorInitScript } from "./collector.js";
import type { CollectorController, CollectorSnapshot } from "./reports.js";
import { runScenarioActions } from "./scenarios.js";
import { measurementFromSnapshot } from "./snapshot.js";
import type { BrowserMeasurement, ScenarioAggregate } from "./types.js";
import { summarize } from "../../metrics.js";

function parseScenarioKey(key: string): { pageId: string; kind: ScenarioKind } {
  const index = key.indexOf(":");
  if (index <= 0) throw new Error(`Invalid scenario key: ${key}`);
  return {
    pageId: key.slice(0, index),
    kind: key.slice(index + 1) as ScenarioKind,
  };
}

interface PageCollectorHost {
  __cwvCollector?: CollectorController;
}

export class WebsiteBenchmarkRunner {
  private browser?: Browser;
  private collectorScript?: Promise<string>;

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

  private collectorSource(): Promise<string> {
    this.collectorScript ??= loadCollectorInitScript();
    return this.collectorScript;
  }

  /**
   * Сначала дожидается колбэков web-vitals на видимой странице.
   * Затем пытается перевести другую вкладку того же окна на передний план:
   * только доверенный visibilitychange финализирует CLS и INP внутри библиотеки.
   * Синтетическое событие не создаётся.
   */
  private async finalizeAndSnapshot(
    page: Page,
    expectInp: boolean,
  ): Promise<CollectorSnapshot> {
    await page
      .waitForLoadState("load", { timeout: 30_000 })
      .catch(() => undefined);
    await page.evaluate(async (expectInteraction) => {
      const collector = (window as unknown as PageCollectorHost).__cwvCollector;
      if (!collector) throw new Error("CWV collector was not injected");
      await collector.flush({
        expectInp: expectInteraction,
        timeoutMs: expectInteraction ? 1_500 : 1_000,
      });
    }, expectInp);

    const background = await page
      .context()
      .newPage()
      .catch(() => undefined);
    try {
      if (background) await background.bringToFront().catch(() => undefined);
      return await page.evaluate(async () => {
        const collector = (window as unknown as PageCollectorHost)
          .__cwvCollector;
        if (!collector) throw new Error("CWV collector was not injected");
        await collector.markFinalized();
        const snapshot = collector.snapshot();
        if (snapshot.fatalErrors.length) {
          throw new Error(
            `CWV collector failed to initialize: ${snapshot.fatalErrors.join("; ")}`,
          );
        }
        return snapshot;
      });
    } finally {
      await background?.close().catch(() => undefined);
    }
  }

  async measureOnce(scenarioKey: string): Promise<BrowserMeasurement> {
    const { pageId, kind } = parseScenarioKey(scenarioKey);
    const pageConfig = this.pageConfig(pageId);
    if (!pageConfig.scenarios.includes(kind))
      throw new Error(`Scenario ${kind} is not configured for page ${pageId}`);

    if (!this.browser) throw new Error("Browser is not open");
    const collectorScript = await this.collectorSource();
    const context = await this.browser.newContext({
      viewport: this.config.browser.viewport,
      deviceScaleFactor: this.config.browser.deviceScaleFactor,
      isMobile: this.config.browser.profile === "mobile",
      hasTouch: this.config.browser.profile === "mobile",
      serviceWorkers: "block",
    });
    await context.addInitScript(collectorScript);
    const page = await context.newPage();
    const startedAt = new Date().toISOString();
    const url = new URL(pageConfig.path, `${this.baseUrl}/`).href;
    try {
      await this.applyThrottling(page);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const observationMs = this.config.browser.observationMs ?? 3_000;
      await runScenarioActions(page, pageConfig, kind, observationMs);
      const snapshot = await this.finalizeAndSnapshot(
        page,
        kind === "interaction",
      );
      return measurementFromSnapshot(snapshot, {
        scenario: scenarioKey,
        pageId,
        scenarioKind: kind,
        url,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      await context.close();
    }
  }

  async measureBatch(
    scenarioKey: string,
    repeats: number,
    label: string,
    onSample?: (index: number, total: number) => void,
  ): Promise<ScenarioAggregate> {
    await mkdir(this.artifactDirectory, { recursive: true });
    const samples: BrowserMeasurement[] = [];
    for (let index = 0; index < repeats; index++) {
      onSample?.(index + 1, repeats);
      const sample = await this.measureOnce(scenarioKey);
      samples.push(sample);
      await writeFile(
        join(
          this.artifactDirectory,
          `${label}-${scenarioKey.replace(":", "_")}-${index + 1}.json`,
        ),
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
      .filter(
        (value) => value.availability === "available" && value.value !== null,
      )
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
