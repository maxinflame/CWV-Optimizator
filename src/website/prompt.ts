import type { CwvMetric, WebsiteConfig } from "./config.js";
import type { Bottleneck } from "./acceptance.js";
import type { ScenarioAggregate } from "./measure/types.js";
import { buildOptimizationContext } from "./diagnostics.js";

export interface WebsiteAttemptSummary {
  id: string;
  status: string;
  hypothesis?: string;
  targetMetric?: string;
  scenario?: string;
  decisionReasons?: string[];
  filesModified?: string[];
  improvementPercent?: number | null;
  referenceMedian?: number | null;
  candidateMedian?: number | null;
  regressions?: Array<{ metric: CwvMetric; percent: number }>;
}

const HYPOTHESIS_HISTORY_MAX = 200;

const STATIC_INSTRUCTIONS = [
  "You are optimizing an existing website for Core Web Vitals in the current working directory.",
  "Make exactly one focused optimization for the bottleneck in the context below.",
  "Step 1 — Understand the bottleneck. Analyze the measurements. Identify the most likely cause supported by the diagnostics. Distinguish measured facts from hypotheses.",
  "Step 2 — Inspect relevant code. Inspect only the parts of the website likely to affect the selected metric on the target page and scenario. Do not scan unrelated files or edit unrelated routes.",
  "Step 3 — Form one hypothesis. Choose a single focused optimization and explain how that code change should cause the improvement.",
  "Step 4 — Implement the smallest reasonable production-ready change. Leave unrelated code unchanged. The pipeline runs the production build after you finish.",
  "Step 5 — Report the hypothesis, supporting evidence, actual changes, and regression risks. Do not claim success; the pipeline measures the candidate.",
  "potentialBottlenecks lists the largest measured delay components or the most frequent layout-shift sources. Treat them as hints, not a confirmed root cause.",
  "Preserve functionality, visual appearance, and accessibility. Do not remove, hide, or relocate meaningful content. Do not optimize for benchmark detection.",
  "Do not edit measurement code, scenarios, thresholds, or pipeline configuration. Do not modify Git history or run git commit, reset, or checkout. Do not run Lighthouse or other performance benchmarks. Do not add unnecessary dependencies.",
  "Do not repeat a previously unsuccessful hypothesis without new evidence or a meaningfully different implementation. Editing the same files as a previous attempt is allowed when the implementation is meaningfully different.",
  'Final answer JSON: {"hypothesis":"...","evidence":"...","expectedImpact":"...","changedFiles":["..."],"regressionRisks":["..."]}. Keep strings short. Git, not changedFiles, is the source of truth for the diff.',
].join("\n");

export const websiteResponseSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    hypothesis: { type: "string" },
    evidence: { type: "string" },
    expectedImpact: { type: "string" },
    changedFiles: { type: "array", items: { type: "string" } },
    regressionRisks: { type: "array", items: { type: "string" } },
  },
  required: ["hypothesis"],
  additionalProperties: false,
};

export function summarizeHypothesis(
  hypothesis: string | undefined,
): string | undefined {
  if (!hypothesis) return undefined;
  const flat = hypothesis.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length <= HYPOTHESIS_HISTORY_MAX
    ? flat
    : `${flat.slice(0, HYPOTHESIS_HISTORY_MAX - 1)}…`;
}

function metricInstructions(metric: CwvMetric): string {
  switch (metric) {
    case "lcpMs":
      return "LCP: prioritize the largest avoidable delay in the breakdown. Investigate resource discovery, loading, server response, or render delay only for that subpart. Do not apply generic optimizations unrelated to the measured LCP element.";
    case "inpMs":
      return "INP: focus on the measured interaction. Distinguish input delay, processing duration, and presentation delay. Investigate event handlers, synchronous work, rendering, or layout only when that component is the large one. Long animation frames and main-thread blocking are context; do not assume they caused this interaction.";
    case "cls":
      return "CLS: focus on the elements associated with the layout shifts. Preserve the intended layout, content, and visual appearance. Do not hide elements or remove content to reduce CLS.";
    case "fcpMs":
      return "FCP: investigate the initial rendering path. Preserve essential functionality. Do not improve FCP at the expense of significant LCP or INP regressions. Do not infer render-blocking resources or font-loading problems from transfer sizes alone.";
  }
}

export function createWebsitePrompt(options: {
  config: WebsiteConfig;
  bottleneck: Bottleneck;
  aggregates: ScenarioAggregate[];
  history: WebsiteAttemptSummary[];
}): string {
  const context = buildOptimizationContext(options);
  return [
    STATIC_INSTRUCTIONS,
    metricInstructions(options.bottleneck.metric),
    `Context:\n${JSON.stringify(context)}`,
  ].join("\n");
}

export function readWebsiteHypothesis(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "hypothesis" in value &&
    typeof (value as { hypothesis: unknown }).hypothesis === "string" &&
    (value as { hypothesis: string }).hypothesis.trim()
  )
    return (value as { hypothesis: string }).hypothesis.trim();
  throw new Error("Agent returned no hypothesis");
}

export function describeMetric(metric: CwvMetric): string {
  switch (metric) {
    case "lcpMs":
      return "Largest Contentful Paint (ms)";
    case "fcpMs":
      return "First Contentful Paint (ms)";
    case "cls":
      return "Cumulative Layout Shift";
    case "inpMs":
      return "Interaction to Next Paint (ms)";
  }
}
