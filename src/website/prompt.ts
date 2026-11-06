import type { CwvMetric, WebsiteConfig } from "./config.js";
import type { Bottleneck } from "./acceptance.js";
import type { ScenarioAggregate } from "./measure/types.js";

export interface WebsiteAttemptSummary {
  id: string;
  status: string;
  hypothesis?: string;
  targetMetric?: string;
  scenario?: string;
  decisionReasons?: string[];
  filesModified?: string[];
}

const HYPOTHESIS_HISTORY_MAX = 200;

export function summarizeHypothesis(hypothesis: string | undefined): string | undefined {
  if (!hypothesis) return undefined;
  const flat = hypothesis.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length <= HYPOTHESIS_HISTORY_MAX
    ? flat
    : `${flat.slice(0, HYPOTHESIS_HISTORY_MAX - 1)}…`;
}

function modeValue<T extends string>(values: Array<T | undefined | null>): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function medianNumber(values: Array<number | null | undefined>): number | undefined {
  const nums = values.filter((value): value is number => typeof value === "number");
  if (!nums.length) return undefined;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1]! + nums[mid]!) / 2 : nums[mid];
}

function measurementHints(aggregate: ScenarioAggregate) {
  const samples = aggregate.samples;
  const lcpElement = modeValue(samples.map((sample) => sample.lcpAttribution?.element));
  const lcpUrlSample = samples.find(
    (sample) => sample.lcpAttribution?.element === lcpElement && sample.lcpAttribution?.url,
  );
  const clsSources = [
    ...new Set(
      samples.flatMap((sample) => sample.clsAttribution?.sources ?? []).filter(Boolean),
    ),
  ];
  const clsLargest = medianNumber(
    samples.map((sample) => sample.clsAttribution?.largestShiftValue),
  );

  return {
    lcpAttribution: lcpElement
      ? {
          element: lcpElement,
          url: lcpUrlSample?.lcpAttribution?.url ?? null,
        }
      : undefined,
    clsAttribution:
      clsSources.length || clsLargest !== undefined
        ? {
            largestShiftValue: clsLargest ?? null,
            sources: clsSources,
          }
        : undefined,
    diagnostics: {
      resourceTransferBytes: medianNumber(
        samples.map((sample) => sample.diagnostics?.resourceTransferBytes),
      ),
      jsTransferBytes: medianNumber(
        samples.map((sample) => sample.diagnostics?.jsTransferBytes),
      ),
      cssTransferBytes: medianNumber(
        samples.map((sample) => sample.diagnostics?.cssTransferBytes),
      ),
    },
  };
}

export function createWebsitePrompt(options: {
  config: WebsiteConfig;
  bottleneck: Bottleneck;
  aggregates: ScenarioAggregate[];
  history: WebsiteAttemptSummary[];
}): string {
  const { config, bottleneck, aggregates, history } = options;
  const pagePaths = config.pages.map((page) => `${page.id} (${page.path})`).join(", ");
  return [
    "You are optimizing an existing website for Core Web Vitals in the current working directory.",
    "Make exactly one focused optimization for the identified bottleneck. Do not decide whether it succeeded — the pipeline measures acceptance.",
    `Change only code that affects the configured measurement pages (${pagePaths}) and the bottleneck scenario ${bottleneck.scenario}. Do not edit unrelated routes or pages "while you are here".`,
    "Target the lab attribution in the JSON (LCP element / CLS sources). Do not optimize a different element unless attribution shows it.",
    "Rely on the lab measurements in this prompt. Do not call external PageSpeed Insights / CrUX / PSI APIs.",
    "The pipeline commits your changes and runs website.buildCommand after you finish. Do not skip or defer the production-ready edit waiting for a manual rebuild.",
    "Do not change the visual design, remove important content/functionality, or hide/relocate content merely to improve metrics.",
    "Do not change benchmark code, measurement configuration, thresholds, pipeline files, or Git history policy files.",
    "Do not introduce unnecessary dependencies. Prefer framework-appropriate production optimizations.",
    "Do not repeat a previous attempt's file set or hypothesis when history shows it already failed.",
    "Explain the hypothesis and the files you changed.",
    "Return a JSON object as the final answer: {\"hypothesis\":\"...\"}.",
    JSON.stringify(
      {
        objective: {
          metric: bottleneck.metric,
          scenario: bottleneck.scenario,
          currentMedian: bottleneck.median,
          internalThreshold: bottleneck.threshold,
          direction: "lower-is-better",
        },
        thresholds: config.objectives.thresholds,
        protectedMetrics: config.objectives.protectedMetrics,
        currentMeasurements: aggregates.map((item) => ({
          scenario: item.scenario,
          medians: item.medians,
          variability: item.variability,
          ...measurementHints(item),
        })),
        history: history.map((attempt) => ({
          id: attempt.id,
          status: attempt.status,
          hypothesis: summarizeHypothesis(attempt.hypothesis),
          targetMetric: attempt.targetMetric,
          scenario: attempt.scenario,
          decisionReasons: attempt.decisionReasons,
          filesModified: attempt.filesModified,
        })),
        pages: config.pages,
      },
      null,
      2,
    ),
  ].join("\n\n");
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
