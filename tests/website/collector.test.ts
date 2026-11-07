import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { selectBottleneck } from "../../src/website/acceptance.js";
import { validateWebsiteConfig } from "../../src/website/config.js";
import { loadCollectorInitScript } from "../../src/website/measure/collector.js";
import { aggregateSamples } from "../../src/website/measure/runner.js";
import {
  INP_UNAVAILABLE_REASON,
  buildSnapshot,
  clsSources,
  createReportStore,
  resourceTimingAvailable,
  selectLcpParts,
  type SnapshotExtras,
  type VitalReport,
} from "../../src/website/measure/reports.js";
import { measurementFromSnapshot } from "../../src/website/measure/snapshot.js";

function extras(partial: Partial<SnapshotExtras> = {}): SnapshotExtras {
  return {
    visibility: "visible",
    finalized: true,
    hiddenTrusted: false,
    loadedInBackground: false,
    installedReadyState: "loading",
    installedAtMs: 4,
    fatalErrors: [],
    diagnosticErrors: [],
    longAnimationFrames: 2,
    resourceTransferBytes: 1_000,
    jsTransferBytes: 400,
    cssTransferBytes: 200,
    navigationResponseStart: 12,
    ...partial,
  };
}

function report(partial: VitalReport): VitalReport {
  return partial;
}

const meta = {
  scenario: "home:interaction",
  pageId: "home",
  scenarioKind: "interaction",
  url: "http://127.0.0.1/",
  startedAt: "2026-11-06T00:00:00.000Z",
  finishedAt: "2026-11-06T00:00:01.000Z",
};

function config() {
  return validateWebsiteConfig({
    workspace: {
      path: resolve("/tmp/site"),
      mode: "direct",
      versionControl: "git",
      requireCleanGit: true,
    },
    agent: { provider: "cursor", model: "auto" },
    website: {
      buildCommand: "npm run build",
      startCommand: "npm run start",
      healthCheckPath: "/",
      port: 3000,
    },
    browser: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      profile: "mobile",
    },
    pages: [
      {
        id: "home",
        path: "/",
        scenarios: ["cold-load", "interaction"],
      },
    ],
    measurements: {
      baselineRepeats: 1,
      quickRepeats: 1,
      confirmationBatches: [{ role: "candidate", repeats: 1 }],
    },
    budgets: { maxDurationMinutes: 10, maxIterations: 1 },
    objectives: {
      thresholds: { lcpMs: 2500, inpMs: 200, cls: 0.1, fcpMs: 1800 },
      safetyMarginPercent: 0,
      minImprovementPercent: 5,
      maxRegressionPercent: 5,
      protectedMetrics: ["lcpMs", "inpMs", "cls", "fcpMs"],
    },
    verification: {},
  });
}

describe("web-vitals report mapping", () => {
  it("maps all five metrics and keeps attribution on the reported value", () => {
    const store = createReportStore();
    const lcpParts = selectLcpParts({
      hasPaintEntry: true,
      hasNavigationTiming: true,
      timeToFirstByte: 80,
      resourceLoadDelay: 20,
      resourceLoadDuration: 140,
      elementRenderDelay: 60,
      url: "https://shop.example/hero.svg",
      resourceTimingAvailable: true,
    });
    store.record(
      report({
        name: "LCP",
        id: "lcp-1",
        value: 300,
        navigationId: 1,
        navigationURL: "http://127.0.0.1/",
        navigationType: "navigate",
        rating: "good",
        attribution: {
          element: "#hero",
          url: "https://shop.example/hero.svg",
          ...lcpParts,
          size: 1200,
          renderTime: 300,
          loadTime: 240,
        },
      }),
    );
    store.record(
      report({
        name: "FCP",
        id: "fcp-1",
        value: 110,
        navigationId: 1,
        navigationURL: "http://127.0.0.1/",
        attribution: {
          timeToFirstByte: 80,
          firstByteToFCP: 30,
          loadState: "loading",
        },
      }),
    );
    store.record(
      report({
        name: "CLS",
        id: "cls-1",
        value: 0.12,
        navigationId: 1,
        attribution: {
          largestShiftValue: 0.12,
          largestShiftTarget: "#late-note",
          largestShiftTime: 1200,
          loadState: "complete",
          sources: ["DIV#late-note"],
        },
      }),
    );
    store.record(
      report({
        name: "INP",
        id: "inp-1",
        value: 180,
        navigationId: 1,
        attribution: {
          eventTarget: "#buy",
          eventType: "pointer",
          inputDelay: 16,
          processingDuration: 140,
          presentationDelay: 24,
          loadState: "complete",
          interactionTime: 500,
          nextPaintTime: 680,
          longestScriptSubpart: "processing-duration",
          longestScriptSource: "app.js",
        },
      }),
    );
    store.record(
      report({
        name: "TTFB",
        id: "ttfb-1",
        value: 80,
        navigationId: 1,
        navigationURL: "http://127.0.0.1/",
        attribution: {
          waitingDuration: 5,
          cacheDuration: 1,
          dnsDuration: 2,
          connectionDuration: 8,
          requestDuration: 64,
        },
      }),
    );

    const snapshot = buildSnapshot(store, extras());
    const measurement = measurementFromSnapshot(snapshot, meta);

    expect(measurement.lcpMs).toEqual({
      value: 300,
      availability: "available",
    });
    expect(measurement.fcpMs).toEqual({
      value: 110,
      availability: "available",
    });
    expect(measurement.cls).toEqual({ value: 0.12, availability: "available" });
    expect(measurement.inpMs).toEqual({
      value: 180,
      availability: "available",
    });
    expect(measurement.ttfbMs).toEqual({
      value: 80,
      availability: "available",
    });
    expect(measurement.lcpAttribution).toMatchObject({
      element: "#hero",
      url: "https://shop.example/hero.svg",
      ttfb: 80,
      resourceLoadDelay: 20,
      resourceLoadDuration: 140,
      elementRenderDelay: 60,
      size: 1200,
    });
    expect(measurement.inpAttribution).toMatchObject({
      eventTarget: "#buy",
      eventType: "pointer",
      inputDelay: 16,
      processingDuration: 140,
      presentationDelay: 24,
    });
    expect(measurement.clsAttribution).toMatchObject({
      largestShiftValue: 0.12,
      sources: ["DIV#late-note"],
      largestShiftTarget: "#late-note",
    });
    expect(measurement.ttfbMs.value).toBe(80);
    expect(snapshot.ttfbDetails?.requestDuration).toBe(64);
    expect(snapshot.navigationResponseStart).toBe(12);
    expect(measurement.diagnostics?.longAnimationFrames).toBe(2);
    expect(measurement.diagnostics?.jsTransferBytes).toBe(400);
  });

  it("replaces repeated callbacks for the same metric id instead of adding them", () => {
    const store = createReportStore();
    store.record(
      report({
        name: "LCP",
        id: "same",
        value: 100,
        navigationId: 1,
        attribution: { url: "https://shop.example/old.png", ttfb: 10 },
      }),
    );
    store.record(
      report({
        name: "LCP",
        id: "same",
        value: 250,
        navigationId: 1,
        attribution: { url: "https://shop.example/hero.svg", ttfb: 40 },
      }),
    );
    store.record(
      report({
        name: "CLS",
        id: "cls-a",
        value: 0.04,
        navigationId: 1,
        attribution: { sources: ["DIV#old"] },
      }),
    );
    store.record(
      report({
        name: "CLS",
        id: "cls-b",
        value: 0.01,
        navigationId: 2,
        attribution: { sources: ["DIV#new"] },
      }),
    );

    const snapshot = buildSnapshot(store, extras());
    expect(snapshot.lcp?.value).toBe(250);
    expect(snapshot.lcp?.url).toBe("https://shop.example/hero.svg");
    expect(snapshot.lcp?.ttfb).toBe(40);
    expect(snapshot.cls?.value).toBe(0.01);
    expect(snapshot.cls?.sources).toEqual(["DIV#new"]);
  });

  it("keeps a later smaller value instead of summing or keeping the previous one", () => {
    const store = createReportStore();
    store.record(
      report({
        name: "INP",
        id: "inp",
        value: 80,
        navigationId: 1,
        attribution: { eventType: "pointer", inputDelay: 80 },
      }),
    );
    store.record(
      report({
        name: "INP",
        id: "inp",
        value: 30,
        navigationId: 1,
        attribution: { eventType: "keyboard", inputDelay: 30 },
      }),
    );
    expect(buildSnapshot(store, extras()).inp?.value).toBe(30);
    expect(buildSnapshot(store, extras()).inp?.eventType).toBe("keyboard");
  });

  it("leaves missing metrics unavailable and keeps a real zero CLS", () => {
    const store = createReportStore();
    store.record(
      report({
        name: "CLS",
        id: "cls-zero",
        value: 0,
        navigationId: 1,
        attribution: { largestShiftValue: null, sources: [] },
      }),
    );
    store.record(
      report({
        name: "TTFB",
        id: "ttfb-zero",
        value: 0,
        navigationId: 1,
        navigationURL: "http://127.0.0.1/",
        attribution: { requestDuration: 0 },
      }),
    );

    const snapshot = buildSnapshot(store, extras());
    const measurement = measurementFromSnapshot(snapshot, {
      ...meta,
      scenario: "home:cold-load",
      scenarioKind: "cold-load",
    });

    expect(measurement.cls).toEqual({ value: 0, availability: "available" });
    expect(measurement.ttfbMs).toEqual({ value: 0, availability: "available" });
    expect(measurement.lcpMs).toEqual({
      value: null,
      availability: "unavailable",
    });
    expect(measurement.fcpMs).toEqual({
      value: null,
      availability: "unavailable",
    });
    expect(measurement.inpMs).toEqual({
      value: null,
      availability: "unavailable",
    });
    expect(measurement.lcpAttribution).toBeUndefined();
    expect(measurement.inpAttribution).toBeUndefined();
    expect(measurement.diagnostics?.inpUnavailableReason).toBe(
      INP_UNAVAILABLE_REASON,
    );
    expect(snapshot.inp).toBeNull();
  });

  it("does not invent LCP resource timings for text or opaque responses", () => {
    expect(
      selectLcpParts({
        hasPaintEntry: true,
        hasNavigationTiming: true,
        timeToFirstByte: 40,
        resourceLoadDelay: 0,
        resourceLoadDuration: 0,
        elementRenderDelay: 220,
        resourceTimingAvailable: false,
      }),
    ).toEqual({
      ttfb: 40,
      resourceLoadDelay: null,
      resourceLoadDuration: null,
      elementRenderDelay: 220,
    });

    expect(
      selectLcpParts({
        hasPaintEntry: true,
        hasNavigationTiming: true,
        timeToFirstByte: 50,
        resourceLoadDelay: 0,
        resourceLoadDuration: 0,
        elementRenderDelay: 900,
        url: "https://cdn.example/hero.jpg",
        resourceTimingAvailable: false,
      }),
    ).toEqual({
      ttfb: 50,
      resourceLoadDelay: null,
      resourceLoadDuration: null,
      elementRenderDelay: null,
    });

    expect(
      selectLcpParts({
        hasPaintEntry: false,
        hasNavigationTiming: false,
        timeToFirstByte: 0,
        resourceLoadDelay: 0,
        resourceLoadDuration: 0,
        elementRenderDelay: 0,
        resourceTimingAvailable: false,
      }),
    ).toEqual({
      ttfb: null,
      resourceLoadDelay: null,
      resourceLoadDuration: null,
      elementRenderDelay: null,
    });

    expect(resourceTimingAvailable(undefined)).toBe(false);
    expect(
      resourceTimingAvailable({
        responseEnd: 0,
        requestStart: 0,
        startTime: 12,
      }),
    ).toBe(false);
    expect(
      resourceTimingAvailable({
        responseEnd: 40,
        requestStart: 0,
        startTime: 8,
      }),
    ).toBe(true);

    const parts = selectLcpParts({
      hasPaintEntry: true,
      hasNavigationTiming: true,
      timeToFirstByte: 10,
      resourceLoadDelay: 0,
      resourceLoadDuration: 0,
      elementRenderDelay: 15,
      url: "https://shop.example/icon.svg",
      resourceTimingAvailable: true,
    });
    expect(parts.resourceLoadDuration).toBe(0);
    expect(parts.resourceLoadDelay).toBe(0);
  });

  it("does not invent a layout-shift source when the node is gone", () => {
    expect(clsSources([], undefined)).toEqual([]);
    expect(clsSources(["", "  "], undefined)).toEqual([]);
    expect(clsSources([], "  #late-note  ")).toEqual(["#late-note"]);
    expect(clsSources(["DIV#late-note"], "#other")).toEqual(["DIV#late-note"]);
  });

  it("serializes a snapshot and stays compatible with aggregation", () => {
    const store = createReportStore();
    store.record(
      report({
        name: "LCP",
        id: "lcp",
        value: 4000,
        navigationId: 1,
        navigationURL: "http://127.0.0.1/",
        attribution: {
          element: "#hero",
          url: null,
          ttfb: 20,
          resourceLoadDelay: null,
          resourceLoadDuration: null,
          elementRenderDelay: 3980,
        },
      }),
    );
    store.record(
      report({
        name: "FCP",
        id: "fcp",
        value: 1000,
        navigationId: 1,
        attribution: {},
      }),
    );
    store.record(
      report({
        name: "CLS",
        id: "cls",
        value: 0,
        navigationId: 1,
        attribution: { largestShiftValue: null, sources: [] },
      }),
    );
    store.record(
      report({
        name: "TTFB",
        id: "ttfb",
        value: 20,
        navigationId: 1,
        attribution: {},
      }),
    );

    const snapshot = buildSnapshot(store, extras());
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);

    const measurement = measurementFromSnapshot(snapshot, {
      ...meta,
      scenario: "home:interaction",
    });
    expect(JSON.parse(JSON.stringify(measurement)).lcpMs).toEqual(
      measurement.lcpMs,
    );

    const aggregate = aggregateSamples("home:interaction", [measurement]);
    expect(aggregate.medians.lcpMs).toBe(4000);
    expect(aggregate.medians.cls).toBe(0);
    expect(aggregate.medians.inpMs).toBeNull();
    expect(selectBottleneck([aggregate], config())?.metric).toBe("lcpMs");
  });
});

describe("collector bundle", () => {
  it("bundles web-vitals into a local init script", async () => {
    const script = await loadCollectorInitScript();
    expect(script).toContain("__cwvCollector");
    expect(script).toContain("reportAllChanges");
    expect(script).toContain("durationThreshold");
    expect(script).not.toContain("unpkg.com");
    expect(script).not.toContain("cdn.jsdelivr.net");
    expect(script.includes("function")).toBe(true);
  });
});
