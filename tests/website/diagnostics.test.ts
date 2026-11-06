import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  validateWebsiteConfig,
  type WebsiteConfig,
} from "../../src/website/config.js";
import type { Bottleneck } from "../../src/website/acceptance.js";
import type {
  BrowserMeasurement,
  ScenarioAggregate,
} from "../../src/website/measure/types.js";
import type { WebsiteAttemptSummary } from "../../src/website/prompt.js";
import {
  buildOptimizationContext,
  selectRelevantHistory,
  type ClsDiagnostics,
  type FcpDiagnostics,
  type InpDiagnostics,
  type LcpDiagnostics,
} from "../../src/website/diagnostics.js";

function config(): WebsiteConfig {
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
        path: "/home-target",
        scenarios: ["cold-load", "interaction"],
        interaction: [{ action: "click", selector: "#do-not-leak-scenario" }],
      },
      { id: "other", path: "/other-secret", scenarios: ["cold-load"] },
    ],
    measurements: {
      baselineRepeats: 1,
      quickRepeats: 1,
      confirmationBatches: [{ role: "candidate", repeats: 1 }],
    },
    budgets: { maxDurationMinutes: 10, maxIterations: 2 },
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

function sample(partial: Partial<BrowserMeasurement> = {}): BrowserMeasurement {
  return {
    scenario: "home:cold-load",
    pageId: "home",
    scenarioKind: "cold-load",
    url: "http://127.0.0.1/home-target",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    lcpMs: { value: null, availability: "unavailable" },
    fcpMs: { value: null, availability: "unavailable" },
    cls: { value: null, availability: "unavailable" },
    inpMs: { value: null, availability: "unavailable" },
    ttfbMs: { value: null, availability: "unavailable" },
    raw: {
      trace: "TRACE_BLOB_SENTINEL",
      points: new Array(40).fill("raw-sample"),
    },
    ...partial,
  };
}

function aggregate(
  scenario: string,
  samples: BrowserMeasurement[],
  medians: ScenarioAggregate["medians"] = {},
): ScenarioAggregate {
  return {
    scenario,
    samples,
    medians,
    variability: { lcpMs: 97531 },
  };
}

function bottleneck(
  partial: Partial<Bottleneck> & Pick<Bottleneck, "metric">,
): Bottleneck {
  return {
    scenario: "home:cold-load",
    median: 3200,
    threshold: 2500,
    excessRatio: 3200 / 2500,
    ...partial,
  };
}

function attempt(
  partial: Partial<WebsiteAttemptSummary> & Pick<WebsiteAttemptSummary, "id">,
): WebsiteAttemptSummary {
  return { status: "rejected", ...partial };
}

describe("LCP diagnostics", () => {
  it("aggregates subparts for the stable element and names the largest delay", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({
        metric: "lcpMs",
        median: 3200,
        threshold: 2200,
      }),
      aggregates: [
        aggregate("home:cold-load", [
          sample({
            lcpAttribution: {
              element: "img.hero",
              url: "/images/hero.webp",
              ttfb: 400,
              resourceLoadDelay: 1000,
              resourceLoadDuration: 300,
              elementRenderDelay: 200,
            },
          }),
          sample({
            lcpAttribution: {
              element: "img.hero",
              url: "/images/hero.webp",
              ttfb: 500,
              resourceLoadDelay: 1400,
              resourceLoadDuration: 400,
              elementRenderDelay: 200,
            },
          }),
          sample({
            lcpAttribution: {
              element: "img.hero",
              url: "/images/other.png",
              ttfb: 450,
              resourceLoadDelay: 1200,
              resourceLoadDuration: 350,
              elementRenderDelay: 200,
            },
          }),
        ]),
      ],
      history: [],
    });
    const diagnostics = context.diagnostics as LcpDiagnostics;
    expect(context.objective).toMatchObject({
      metric: "lcpMs",
      scenario: "home:cold-load",
      pagePath: "/home-target",
      current: 3200,
      target: 2200,
    });
    expect(diagnostics.element).toBe("img.hero");
    expect(diagnostics.url).toBe("/images/hero.webp");
    expect(diagnostics.urlUnstable).toBe(true);
    expect(diagnostics.attributionUnstable).toBe(false);
    expect(diagnostics.ttfb).toBe(450);
    expect(diagnostics.resourceLoadDelay).toBe(1200);
    expect(diagnostics.resourceLoadDuration).toBe(350);
    expect(diagnostics.elementRenderDelay).toBe(200);
    expect(context.potentialBottlenecks).toEqual(["resourceLoadDelay"]);
    expect(JSON.stringify(context)).not.toContain("TRACE_BLOB_SENTINEL");
    expect(JSON.stringify(context)).not.toContain("97531");
  });

  it("does not mix timings when the LCP element is split across runs", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "lcpMs" }),
      aggregates: [
        aggregate("home:cold-load", [
          sample({
            lcpAttribution: {
              element: "img.a",
              resourceLoadDelay: 100,
              ttfb: 10,
            },
          }),
          sample({
            lcpAttribution: {
              element: "img.b",
              resourceLoadDelay: 900,
              ttfb: 800,
            },
          }),
          sample({
            lcpAttribution: {
              element: "img.a",
              resourceLoadDelay: 300,
              ttfb: 20,
            },
          }),
          sample({
            lcpAttribution: {
              element: "img.b",
              resourceLoadDelay: 700,
              ttfb: 600,
            },
          }),
        ]),
      ],
      history: [],
    });
    const diagnostics = context.diagnostics as LcpDiagnostics;
    expect(diagnostics.attributionUnstable).toBe(true);
    expect(diagnostics.element).toBeNull();
    expect(diagnostics.resourceLoadDelay).toBeNull();
    expect(diagnostics.ttfb).toBeNull();
    expect(diagnostics.observedElements).toEqual(["img.a", "img.b"]);
    expect(context.potentialBottlenecks).toEqual([]);
    expect(context.notes.join(" ")).toContain("unstable");
  });

  it("keeps timings for the dominant element when another element appears", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "lcpMs" }),
      aggregates: [
        aggregate("home:cold-load", [
          sample({
            lcpAttribution: {
              element: "img.hero",
              url: "/hero.webp",
              resourceLoadDelay: 1000,
              elementRenderDelay: 100,
            },
          }),
          sample({
            lcpAttribution: {
              element: "img.hero",
              url: "/hero.webp",
              resourceLoadDelay: 1200,
              elementRenderDelay: 100,
            },
          }),
          sample({
            lcpAttribution: {
              element: "img.hero",
              url: "/hero.webp",
              resourceLoadDelay: 1400,
              elementRenderDelay: 100,
            },
          }),
          sample({
            lcpAttribution: {
              element: "h1.title",
              url: "/other.png",
              resourceLoadDelay: 10,
              elementRenderDelay: 5000,
            },
          }),
        ]),
      ],
      history: [],
    });
    const diagnostics = context.diagnostics as LcpDiagnostics;
    expect(diagnostics.element).toBe("img.hero");
    expect(diagnostics.url).toBe("/hero.webp");
    expect(diagnostics.attributionUnstable).toBe(true);
    expect(diagnostics.resourceLoadDelay).toBe(1200);
    expect(diagnostics.elementRenderDelay).toBe(100);
    expect(diagnostics.observedElements).toEqual(["img.hero", "h1.title"]);
    expect(context.potentialBottlenecks).toEqual(["resourceLoadDelay"]);
  });

  it("preserves explicit nulls and does not invent a navigation TTFB", () => {
    const missing = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "lcpMs" }),
      aggregates: [aggregate("home:cold-load", [sample()])],
      history: [],
    });
    const unavailable = missing.diagnostics as LcpDiagnostics;
    expect(unavailable).toMatchObject({
      element: null,
      url: null,
      attributionUnstable: false,
      ttfb: null,
      resourceLoadDelay: null,
      resourceLoadDuration: null,
      elementRenderDelay: null,
    });
    expect(missing.potentialBottlenecks).toEqual([]);

    const explicitNull = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "lcpMs" }),
      aggregates: [
        aggregate("home:cold-load", [
          sample({
            ttfbMs: { value: 999, availability: "available" },
            lcpAttribution: {
              element: "img.hero",
              ttfb: null,
              resourceLoadDelay: 50,
            },
          }),
        ]),
      ],
      history: [],
    });
    expect((explicitNull.diagnostics as LcpDiagnostics).ttfb).toBeNull();
    expect((explicitNull.diagnostics as LcpDiagnostics).resourceLoadDelay).toBe(
      50,
    );

    const fallback = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "lcpMs" }),
      aggregates: [
        aggregate("home:cold-load", [
          sample({
            ttfbMs: { value: 80, availability: "available" },
            lcpAttribution: { element: "img.hero", resourceLoadDelay: 50 },
          }),
        ]),
      ],
      history: [],
    });
    expect((fallback.diagnostics as LcpDiagnostics).ttfb).toBe(80);
  });
});

describe("INP diagnostics", () => {
  it("aggregates the measured interaction and ignores an unrelated target", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({
        metric: "inpMs",
        scenario: "home:interaction",
        median: 270,
        threshold: 200,
      }),
      aggregates: [
        aggregate(
          "home:interaction",
          [
            sample({
              inpAttribution: {
                eventTarget: "button.buy",
                eventType: "click",
                inputDelay: 10,
                processingDuration: 100,
                presentationDelay: 40,
              },
              diagnostics: { longAnimationFrames: 2, mainThreadBlockingMs: 30 },
            }),
            sample({
              inpAttribution: {
                eventTarget: "button.buy",
                eventType: "click",
                inputDelay: 30,
                processingDuration: 200,
                presentationDelay: 40,
              },
              diagnostics: { longAnimationFrames: 4, mainThreadBlockingMs: 90 },
            }),
            sample({
              inpAttribution: {
                eventTarget: "button.buy",
                eventType: "click",
                inputDelay: 50,
                processingDuration: 300,
                presentationDelay: 40,
              },
              diagnostics: { longAnimationFrames: 9 },
            }),
            sample({
              inpAttribution: {
                eventTarget: "a.unrelated",
                eventType: "keydown",
                inputDelay: 1,
                processingDuration: 9000,
                presentationDelay: 1,
              },
              diagnostics: {
                longAnimationFrames: 1,
                mainThreadBlockingMs: 5000,
              },
            }),
          ],
          { inpMs: 270, cls: 0.02, lcpMs: 1000 },
        ),
      ],
      history: [],
    });
    const diagnostics = context.diagnostics as InpDiagnostics;
    expect(diagnostics.target).toBe("button.buy");
    expect(diagnostics.eventType).toBe("click");
    expect(diagnostics.attributionUnstable).toBe(true);
    expect(diagnostics.inputDelay).toBe(30);
    expect(diagnostics.processingDuration).toBe(200);
    expect(diagnostics.presentationDelay).toBe(40);
    expect(diagnostics.longAnimationFrames).toBe(3);
    expect(diagnostics.mainThreadBlockingMs).toBe(90);
    expect(context.potentialBottlenecks).toEqual(["processingDuration"]);
    expect(context.potentialBottlenecks).not.toContain("longAnimationFrames");
    expect(context.protectedMetrics).toEqual([
      { metric: "lcpMs", median: 1000, threshold: 2500 },
      { metric: "cls", median: 0.02, threshold: 0.1 },
      { metric: "fcpMs", median: null, threshold: 1800 },
    ]);
  });

  it("omits delay components when interaction targets disagree", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "inpMs", scenario: "home:interaction" }),
      aggregates: [
        aggregate("home:interaction", [
          sample({
            inpAttribution: {
              eventTarget: "button.a",
              eventType: "click",
              processingDuration: 10,
            },
            diagnostics: { longAnimationFrames: 4 },
          }),
          sample({
            inpAttribution: {
              eventTarget: "button.b",
              eventType: "keydown",
              processingDuration: 800,
            },
            diagnostics: { longAnimationFrames: 6 },
          }),
        ]),
      ],
      history: [],
    });
    const diagnostics = context.diagnostics as InpDiagnostics;
    expect(diagnostics.target).toBeNull();
    expect(diagnostics.eventType).toBeNull();
    expect(diagnostics.processingDuration).toBeNull();
    expect(diagnostics.inputDelay).toBeNull();
    expect(diagnostics.presentationDelay).toBeNull();
    expect(diagnostics.longAnimationFrames).toBe(5);
    expect(diagnostics.mainThreadBlockingMs).toBeNull();
    expect(context.potentialBottlenecks).toEqual([]);
  });
});

describe("CLS diagnostics", () => {
  it("summarizes frequent shift sources and caps the list", () => {
    const longSource = `${"S".repeat(180)}LONG_SOURCE_TAIL`;
    const samples = [
      sample({
        clsAttribution: {
          largestShiftValue: 0.1,
          sources: ["DIV.ad", "DIV.ad"],
        },
      }),
      sample({
        clsAttribution: {
          largestShiftValue: 0.3,
          sources: ["DIV.ad", longSource],
        },
      }),
      sample({
        clsAttribution: { largestShiftValue: 0.2, sources: [longSource] },
      }),
    ];
    for (let index = 0; index < 12; index += 1) {
      samples.push(
        sample({
          clsAttribution: {
            largestShiftValue: 0.01,
            sources: [`m-noise-${String(index).padStart(2, "0")}`],
          },
        }),
      );
    }
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "cls", median: 0.2, threshold: 0.1 }),
      aggregates: [
        aggregate("home:cold-load", samples, { cls: 0.2, lcpMs: 1000 }),
      ],
      history: [],
    });
    const diagnostics = context.diagnostics as ClsDiagnostics;
    expect(diagnostics.largestShiftValue).toBe(0.01);
    expect(diagnostics.sources[0]).toBe("DIV.ad");
    expect(diagnostics.sources).toHaveLength(8);
    expect(diagnostics.sources.some((source) => source.startsWith("S"))).toBe(
      true,
    );
    expect(diagnostics.sources.join(" ")).not.toContain("LONG_SOURCE_TAIL");
    expect(diagnostics.sources.join(" ")).not.toContain("m-noise-11");
    expect(context.potentialBottlenecks).toEqual(
      diagnostics.sources.slice(0, 3),
    );
    expect(context.potentialBottlenecks).not.toContain("lcpMs");
  });
});

describe("FCP diagnostics", () => {
  it("reports transfer sizes without treating them as the cause", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({
        metric: "fcpMs",
        median: 2000,
        threshold: 1800,
      }),
      aggregates: [
        aggregate(
          "home:cold-load",
          [
            sample({
              diagnostics: {
                jsTransferBytes: 500_000,
                cssTransferBytes: 10_000,
                mainThreadBlockingMs: 700,
                longAnimationFrames: 2,
              },
            }),
            sample({
              diagnostics: {
                jsTransferBytes: 700_000,
                cssTransferBytes: 30_000,
                mainThreadBlockingMs: 900,
                longAnimationFrames: 4,
              },
            }),
          ],
          { fcpMs: 2000, ttfbMs: 900, lcpMs: 4000 },
        ),
      ],
      history: [],
    });
    const diagnostics = context.diagnostics as FcpDiagnostics;
    expect(diagnostics).toMatchObject({
      fcp: 2000,
      ttfb: 900,
      jsTransferBytes: 600_000,
      cssTransferBytes: 20_000,
      longAnimationFrames: 3,
      mainThreadBlockingMs: 800,
    });
    expect(context.potentialBottlenecks).toEqual([
      "ttfb",
      "mainThreadBlockingMs",
    ]);
    expect(context.potentialBottlenecks).not.toContain("jsTransferBytes");
    expect(JSON.stringify(diagnostics)).not.toContain("lcpAttribution");
  });

  it("leaves missing FCP inputs null", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "fcpMs", median: 0, threshold: 1800 }),
      aggregates: [
        aggregate(
          "home:cold-load",
          [sample({ diagnostics: { jsTransferBytes: 0 } })],
          {
            fcpMs: null,
            ttfbMs: null,
          },
        ),
      ],
      history: [],
    });
    const diagnostics = context.diagnostics as FcpDiagnostics;
    expect(diagnostics.fcp).toBeNull();
    expect(diagnostics.ttfb).toBeNull();
    expect(diagnostics.jsTransferBytes).toBe(0);
    expect(diagnostics.cssTransferBytes).toBeNull();
    expect(diagnostics.mainThreadBlockingMs).toBeNull();
    expect(context.potentialBottlenecks).toEqual([]);
  });

  it("does not call a small main-thread block the bottleneck", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "fcpMs", median: 400, threshold: 1800 }),
      aggregates: [
        aggregate(
          "home:cold-load",
          [
            sample({
              diagnostics: {
                mainThreadBlockingMs: 150,
                jsTransferBytes: 9_000_000,
              },
            }),
          ],
          { fcpMs: 400, ttfbMs: 40 },
        ),
      ],
      history: [],
    });
    expect(context.potentialBottlenecks).toEqual([]);
    expect((context.diagnostics as FcpDiagnostics).jsTransferBytes).toBe(
      9_000_000,
    );
  });
});

describe("optimization history", () => {
  const history: WebsiteAttemptSummary[] = [
    attempt({
      id: "iteration-001",
      targetMetric: "lcpMs",
      scenario: "home:cold-load",
      hypothesis: "first same files",
      filesModified: ["templates/index.html"],
    }),
    attempt({
      id: "iteration-006",
      targetMetric: "inpMs",
      scenario: "other:interaction",
      hypothesis: "UNIQUE_EXCLUDED_HYPOTHESIS",
      filesModified: ["pages/about.tsx"],
    }),
    attempt({
      id: "iteration-003",
      status: "accepted",
      targetMetric: "cls",
      scenario: "home:scroll",
      hypothesis: "same page",
      filesModified: ["pages/home.tsx"],
      improvementPercent: 8,
    }),
    attempt({
      id: "iteration-004",
      targetMetric: "lcpMs",
      scenario: "home:scroll",
      hypothesis: "same metric",
    }),
    attempt({
      id: "iteration-005",
      status: "inconclusive",
      targetMetric: "lcpMs",
      scenario: "home:cold-load",
      hypothesis: "newer same files",
      filesModified: ["templates/index.html"],
      referenceMedian: 3000,
      candidateMedian: 3100,
      decisionReasons: [
        "Target metric improvement is below the required margin",
      ],
      regressions: [{ metric: "cls", percent: 6.666 }],
    }),
    attempt({
      id: "iteration-002",
      targetMetric: "cls",
      scenario: "other:cold-load",
      hypothesis: "shared header",
      filesModified: ["src\\components\\Header.tsx"],
    }),
    attempt({
      id: "iteration-007",
      status: "running",
      targetMetric: "lcpMs",
      scenario: "home:cold-load",
      hypothesis: "still running",
    }),
  ];

  it("keeps same-file attempts and orders relevant history deterministically", () => {
    const selected = selectRelevantHistory(history, {
      metric: "lcpMs",
      scenario: "home:cold-load",
    });
    expect(selected.map((item) => item.id)).toEqual([
      "iteration-005",
      "iteration-001",
      "iteration-004",
      "iteration-003",
      "iteration-002",
    ]);
  });

  it("includes measured deltas and drops unrelated attempts from the context", () => {
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "lcpMs" }),
      aggregates: [
        aggregate("home:cold-load", [], {
          cls: 0.02,
          fcpMs: 1100,
          inpMs: 75319,
        }),
        aggregate("other:cold-load", [], { lcpMs: 86420 }),
      ],
      history,
    });
    expect(context.previousAttempts.map((item) => item.id)).toEqual([
      "iteration-005",
      "iteration-001",
      "iteration-004",
      "iteration-003",
      "iteration-002",
    ]);
    expect(context.previousAttempts[0]).toMatchObject({
      hypothesis: "newer same files",
      improvementPercent: -3.33,
      referenceMedian: 3000,
      candidateMedian: 3100,
      filesModified: ["templates/index.html"],
      regressions: [{ metric: "cls", percent: 6.67 }],
    });
    expect(context.previousAttempts[1]?.filesModified).toEqual([
      "templates/index.html",
    ]);
    expect(context.previousAttempts[4]?.filesModified).toEqual([
      "src/components/Header.tsx",
    ]);
    expect(context.protectedMetrics).toEqual([
      { metric: "cls", median: 0.02, threshold: 0.1 },
      { metric: "fcpMs", median: 1100, threshold: 1800 },
    ]);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("UNIQUE_EXCLUDED_HYPOTHESIS");
    expect(serialized).not.toContain("still running");
    expect(serialized).not.toContain("75319");
    expect(serialized).not.toContain("86420");
    expect(serialized).not.toContain("/other-secret");
    expect(serialized).not.toContain("#do-not-leak-scenario");
  });
});

describe("diagnostic context bounds", () => {
  it("limits history, sources and serialized size", () => {
    const longSource = `${"Q".repeat(220)}LONG_SOURCE_TAIL`;
    const samples = Array.from({ length: 6 }, () =>
      sample({
        clsAttribution: {
          largestShiftValue: 0.2,
          sources: [longSource, "DIV.stable"],
        },
      }),
    );
    for (let index = 0; index < 20; index += 1) {
      samples.push(
        sample({
          clsAttribution: {
            largestShiftValue: 0.01,
            sources: [`noise-source-${index}-${"n".repeat(300)}`],
          },
        }),
      );
    }
    const history = Array.from({ length: 15 }, (_, index) =>
      attempt({
        id: `iteration-${String(index + 1).padStart(3, "0")}`,
        targetMetric: "cls",
        scenario: "home:cold-load",
        hypothesis: `${"A".repeat(240)}TAIL_SHOULD_CLIP`,
        decisionReasons: [
          `${"R".repeat(200)}REASON_TAIL`,
          "second reason",
          "third reason",
        ],
        filesModified: Array.from(
          { length: 20 },
          (__, fileIndex) =>
            `src/file-${fileIndex}-${"p".repeat(180)}FILE_TAIL`,
        ),
      }),
    );
    history.push(
      attempt({
        id: "iteration-099",
        targetMetric: "inpMs",
        scenario: "other:interaction",
        hypothesis: "UNIQUE_EXCLUDED_HYPOTHESIS",
        filesModified: ["pages/about.tsx"],
      }),
    );
    const context = buildOptimizationContext({
      config: config(),
      bottleneck: bottleneck({ metric: "cls", median: 0.2, threshold: 0.1 }),
      aggregates: [aggregate("home:cold-load", samples, { cls: 0.2 })],
      history,
    });
    const diagnostics = context.diagnostics as ClsDiagnostics;
    const serialized = JSON.stringify(context);
    expect(context.previousAttempts.length).toBeLessThanOrEqual(6);
    expect(context.previousAttempts.length).toBeGreaterThan(0);
    expect(diagnostics.sources.length).toBeLessThanOrEqual(8);
    expect(serialized.length).toBeLessThanOrEqual(10_000);
    expect(serialized).not.toContain("TAIL_SHOULD_CLIP");
    expect(serialized).not.toContain("REASON_TAIL");
    expect(serialized).not.toContain("FILE_TAIL");
    expect(serialized).not.toContain("LONG_SOURCE_TAIL");
    expect(serialized).not.toContain("TRACE_BLOB_SENTINEL");
    expect(serialized).not.toContain("UNIQUE_EXCLUDED_HYPOTHESIS");
    expect(serialized).not.toContain('"samples"');
  });
});
