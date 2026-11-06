import type { Bottleneck } from "./acceptance.js";
import {
  effectiveThreshold,
  type CwvMetric,
  type WebsiteConfig,
} from "./config.js";
import type { BrowserMeasurement, ScenarioAggregate } from "./measure/types.js";
import type { WebsiteAttemptSummary } from "./prompt.js";

/** Доля самой частой метки, ниже которой подчасти времени не публикуются. */
const DOMINANT_SHARE = 0.6;
const HISTORY_LIMIT = 6;
const CONTEXT_JSON_MAX = 10_000;
const SOURCE_LIMIT = 8;
const OBSERVED_LABEL_LIMIT = 5;
const FILE_LIMIT = 6;
const FILE_MAX = 100;
const REASON_LIMIT = 2;
const REASON_MAX = 140;
const ELEMENT_MAX = 180;
const URL_MAX = 200;
const SOURCE_MAX = 160;

/** Доля FCP, начиная с которой TTFB считается заметной частью старта отрисовки. */
const FCP_TTFB_SHARE = 0.4;
/** Блокировка основного потока заметна, когда она и достаточно велика, и занимает заметную долю FCP. */
const FCP_BLOCKING_SHARE = 0.25;
const FCP_BLOCKING_MIN_MS = 200;

const LCP_PARTS = [
  "ttfb",
  "resourceLoadDelay",
  "resourceLoadDuration",
  "elementRenderDelay",
] as const;

const INP_PARTS = [
  "inputDelay",
  "processingDuration",
  "presentationDelay",
] as const;

const SHARED_DIRECTORY =
  /(^|\/)(components?|layouts?|shared|common|ui|shell|widgets?|partials?)(\/|$)/i;
const SHARED_FILENAME =
  /(^|\/)(header|footer|nav|navbar|layout|app)\.[a-z0-9]+$/i;
const SHARED_STYLESHEET = /(^|\/)(global|main|app|index)\.(css|scss|sass)$/i;

export interface LcpDiagnostics {
  element: string | null;
  url: string | null;
  attributionUnstable: boolean;
  observedElements?: string[];
  urlUnstable?: boolean;
  ttfb: number | null;
  resourceLoadDelay: number | null;
  resourceLoadDuration: number | null;
  elementRenderDelay: number | null;
}

export interface InpDiagnostics {
  target: string | null;
  eventType: string | null;
  attributionUnstable: boolean;
  observedTargets?: string[];
  inputDelay: number | null;
  processingDuration: number | null;
  presentationDelay: number | null;
  longAnimationFrames: number | null;
  mainThreadBlockingMs: number | null;
}

export interface ClsDiagnostics {
  largestShiftValue: number | null;
  sources: string[];
  attributionUnstable?: boolean;
}

export interface FcpDiagnostics {
  fcp: number | null;
  ttfb: number | null;
  jsTransferBytes: number | null;
  cssTransferBytes: number | null;
  longAnimationFrames: number | null;
  mainThreadBlockingMs: number | null;
}

export interface CompactAttempt {
  id: string;
  status: string;
  metric: string | null;
  scenario: string | null;
  hypothesis: string | null;
  improvementPercent: number | null;
  referenceMedian: number | null;
  candidateMedian: number | null;
  reasons: string[];
  filesModified: string[];
  regressions: Array<{ metric: string; percent: number }>;
}

export interface OptimizationContext {
  objective: {
    metric: CwvMetric;
    scenario: string;
    pagePath: string | null;
    current: number | null;
    target: number;
  };
  diagnostics:
    LcpDiagnostics | InpDiagnostics | ClsDiagnostics | FcpDiagnostics;
  potentialBottlenecks: string[];
  notes: string[];
  protectedMetrics: Array<{
    metric: CwvMetric;
    median: number | null;
    threshold: number;
  }>;
  previousAttempts: CompactAttempt[];
}

interface Diagnosis {
  diagnostics: OptimizationContext["diagnostics"];
  potentialBottlenecks: string[];
  notes: string[];
}

interface LabelSummary {
  dominant: string | null;
  unstable: boolean;
  withhold: boolean;
  observed: string[];
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
}

function finite(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  return value;
}

function real(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(
  values: Array<number | null | undefined>,
  digits: number,
): number | null {
  const nums: number[] = [];
  for (const value of values) {
    const next = finite(value);
    if (next !== null) nums.push(next);
  }
  if (!nums.length) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  const value =
    nums.length % 2 === 0 ? (nums[mid - 1]! + nums[mid]!) / 2 : nums[mid]!;
  return round(value, digits);
}

function metricDigits(metric: CwvMetric | "ttfbMs"): number {
  return metric === "cls" ? 4 : 1;
}

function metricMedian(
  aggregate: ScenarioAggregate | undefined,
  metric: CwvMetric | "ttfbMs",
): number | null {
  const value = finite(aggregate?.medians[metric]);
  if (value === null) return null;
  return round(value, metricDigits(metric));
}

function flattenLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const flat = value.replace(/\s+/g, " ").trim();
  return flat || null;
}

function summarizeLabels(
  labels: Array<string | null | undefined>,
): LabelSummary {
  const counts = new Map<string, number>();
  let total = 0;
  for (const label of labels) {
    const flat = flattenLabel(label);
    if (!flat) continue;
    total += 1;
    counts.set(flat, (counts.get(flat) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const top = ranked[0];
  if (!top || total === 0) {
    return { dominant: null, unstable: false, withhold: false, observed: [] };
  }
  const second = ranked[1];
  const tied = second !== undefined && second[1] === top[1];
  const share = top[1] / total;
  const unstable = ranked.length > 1;
  const withhold = tied || share < DOMINANT_SHARE;
  return {
    dominant: withhold ? null : top[0],
    unstable,
    withhold,
    observed: ranked
      .slice(0, OBSERVED_LABEL_LIMIT)
      .map(([label]) => clip(label, ELEMENT_MAX)),
  };
}

function groupedSamples(
  samples: BrowserMeasurement[],
  labels: LabelSummary,
  read: (sample: BrowserMeasurement) => string | null | undefined,
): BrowserMeasurement[] {
  if (labels.withhold) return [];
  if (!labels.dominant) return samples;
  return samples.filter(
    (sample) => flattenLabel(read(sample)) === labels.dominant,
  );
}

function modeString(
  values: Array<string | null | undefined>,
  maxLen: number,
): { value: string | null; unstable: boolean } {
  const counts = new Map<string, number>();
  for (const value of values) {
    const flat = flattenLabel(value);
    if (!flat) continue;
    counts.set(flat, (counts.get(flat) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const top = ranked[0];
  if (!top) return { value: null, unstable: false };
  const tied = ranked[1] !== undefined && ranked[1][1] === top[1];
  return {
    value: tied ? null : clip(top[0], maxLen),
    unstable: ranked.length > 1,
  };
}

function lcpTtfb(sample: BrowserMeasurement): number | null {
  const attribution = sample.lcpAttribution;
  if (!attribution) return null;
  if (Object.prototype.hasOwnProperty.call(attribution, "ttfb")) {
    return finite(attribution.ttfb);
  }
  if (sample.ttfbMs.availability === "available")
    return finite(sample.ttfbMs.value);
  return null;
}

function largest(
  values: Record<string, number | null>,
  order: readonly string[],
): string[] {
  let max = 0;
  for (const key of order) {
    const value = values[key];
    if (typeof value === "number" && value > max) max = value;
  }
  if (max <= 0) return [];
  return order.filter((key) => values[key] === max);
}

function lcpBlock(samples: BrowserMeasurement[]): Diagnosis {
  const labels = summarizeLabels(
    samples.map((sample) => sample.lcpAttribution?.element),
  );
  const grouped = groupedSamples(
    samples,
    labels,
    (sample) => sample.lcpAttribution?.element,
  );
  const timings = {
    ttfb: median(grouped.map(lcpTtfb), 1),
    resourceLoadDelay: median(
      grouped.map((sample) => sample.lcpAttribution?.resourceLoadDelay),
      1,
    ),
    resourceLoadDuration: median(
      grouped.map((sample) => sample.lcpAttribution?.resourceLoadDuration),
      1,
    ),
    elementRenderDelay: median(
      grouped.map((sample) => sample.lcpAttribution?.elementRenderDelay),
      1,
    ),
  };
  const url = modeString(
    grouped.map((sample) => sample.lcpAttribution?.url),
    URL_MAX,
  );
  const notes: string[] = [];
  if (labels.unstable && labels.withhold) {
    notes.push(
      "LCP element attribution is unstable across samples. Subpart timings were omitted so unrelated elements are not mixed.",
    );
  } else if (labels.unstable) {
    notes.push(
      "LCP element differs between samples. Timings are medians for the most common element only.",
    );
  }
  if (url.unstable) {
    notes.push(
      "LCP resource URL differs between samples for the selected element.",
    );
  }
  const diagnostics: LcpDiagnostics = {
    element: labels.dominant ? clip(labels.dominant, ELEMENT_MAX) : null,
    url: url.value,
    attributionUnstable: labels.unstable,
    ttfb: timings.ttfb,
    resourceLoadDelay: timings.resourceLoadDelay,
    resourceLoadDuration: timings.resourceLoadDuration,
    elementRenderDelay: timings.elementRenderDelay,
  };
  if (labels.unstable && labels.observed.length) {
    diagnostics.observedElements = labels.observed;
  }
  if (url.unstable) diagnostics.urlUnstable = true;
  return {
    diagnostics,
    potentialBottlenecks: largest(timings, LCP_PARTS),
    notes,
  };
}

function inpBlock(samples: BrowserMeasurement[]): Diagnosis {
  const labels = summarizeLabels(
    samples.map((sample) => sample.inpAttribution?.eventTarget),
  );
  const grouped = groupedSamples(
    samples,
    labels,
    (sample) => sample.inpAttribution?.eventTarget,
  );
  const eventType = modeString(
    grouped.map((sample) => sample.inpAttribution?.eventType),
    40,
  );
  const timings = {
    inputDelay: median(
      grouped.map((sample) => sample.inpAttribution?.inputDelay),
      1,
    ),
    processingDuration: median(
      grouped.map((sample) => sample.inpAttribution?.processingDuration),
      1,
    ),
    presentationDelay: median(
      grouped.map((sample) => sample.inpAttribution?.presentationDelay),
      1,
    ),
  };
  const notes: string[] = [];
  if (labels.unstable && labels.withhold) {
    notes.push(
      "INP target attribution is unstable across samples. Delay components were omitted so unrelated interactions are not mixed.",
    );
  } else if (labels.unstable) {
    notes.push(
      "INP target differs between samples. Delay components are medians for the most common target only.",
    );
  }
  if (eventType.unstable) {
    notes.push(
      "INP event type differs between samples for the selected target.",
    );
  }
  const diagnostics: InpDiagnostics = {
    target: labels.dominant ? clip(labels.dominant, ELEMENT_MAX) : null,
    eventType: eventType.value,
    attributionUnstable: labels.unstable,
    inputDelay: timings.inputDelay,
    processingDuration: timings.processingDuration,
    presentationDelay: timings.presentationDelay,
    longAnimationFrames: median(
      samples.map((sample) => sample.diagnostics?.longAnimationFrames),
      1,
    ),
    mainThreadBlockingMs: median(
      samples.map((sample) => sample.diagnostics?.mainThreadBlockingMs),
      1,
    ),
  };
  if (labels.unstable && labels.observed.length) {
    diagnostics.observedTargets = labels.observed;
  }
  return {
    diagnostics,
    potentialBottlenecks: largest(timings, INP_PARTS),
    notes,
  };
}

function clsBlock(samples: BrowserMeasurement[]): Diagnosis {
  const counts = new Map<string, number>();
  let samplesWithSources = 0;
  for (const sample of samples) {
    const sources = sample.clsAttribution?.sources;
    if (!Array.isArray(sources)) continue;
    const seen = new Set<string>();
    for (const source of sources) {
      const flat = flattenLabel(source);
      if (!flat || seen.has(flat)) continue;
      seen.add(flat);
      counts.set(flat, (counts.get(flat) ?? 0) + 1);
    }
    if (seen.size) samplesWithSources += 1;
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const sources = ranked
    .slice(0, SOURCE_LIMIT)
    .map(([source]) => clip(source, SOURCE_MAX));
  const topCount = ranked[0]?.[1] ?? 0;
  const unstable =
    ranked.length >= 3 &&
    samplesWithSources > 0 &&
    topCount / samplesWithSources < 0.5;
  return {
    diagnostics: {
      largestShiftValue: median(
        samples.map((sample) => sample.clsAttribution?.largestShiftValue),
        4,
      ),
      sources,
      ...(unstable ? { attributionUnstable: true } : {}),
    },
    potentialBottlenecks: sources.slice(0, 3),
    notes: unstable
      ? [
          "Layout-shift sources differ across samples. Listed selectors are the most frequent, not every shifted node.",
        ]
      : [],
  };
}

function fcpBlock(aggregate: ScenarioAggregate | undefined): Diagnosis {
  const samples = aggregate?.samples ?? [];
  const fcp = metricMedian(aggregate, "fcpMs");
  const ttfb = metricMedian(aggregate, "ttfbMs");
  const blocking = median(
    samples.map((sample) => sample.diagnostics?.mainThreadBlockingMs),
    1,
  );
  const potentialBottlenecks: string[] = [];
  if (
    fcp !== null &&
    fcp > 0 &&
    ttfb !== null &&
    ttfb / fcp >= FCP_TTFB_SHARE
  ) {
    potentialBottlenecks.push("ttfb");
  }
  if (
    fcp !== null &&
    fcp > 0 &&
    blocking !== null &&
    blocking >= FCP_BLOCKING_MIN_MS &&
    blocking / fcp >= FCP_BLOCKING_SHARE
  ) {
    potentialBottlenecks.push("mainThreadBlockingMs");
  }
  return {
    diagnostics: {
      fcp,
      ttfb,
      jsTransferBytes: median(
        samples.map((sample) => sample.diagnostics?.jsTransferBytes),
        0,
      ),
      cssTransferBytes: median(
        samples.map((sample) => sample.diagnostics?.cssTransferBytes),
        0,
      ),
      longAnimationFrames: median(
        samples.map((sample) => sample.diagnostics?.longAnimationFrames),
        1,
      ),
      mainThreadBlockingMs: blocking,
    },
    potentialBottlenecks,
    notes: [],
  };
}

function diagnose(
  metric: CwvMetric,
  aggregate: ScenarioAggregate | undefined,
): Diagnosis {
  const samples = aggregate?.samples ?? [];
  switch (metric) {
    case "lcpMs":
      return lcpBlock(samples);
    case "inpMs":
      return inpBlock(samples);
    case "cls":
      return clsBlock(samples);
    case "fcpMs":
      return fcpBlock(aggregate);
  }
}

function pageId(scenario: string | undefined): string | undefined {
  if (!scenario) return undefined;
  const id = scenario.split(":")[0]?.trim();
  return id || undefined;
}

function isSharedFile(file: string): boolean {
  const path = file.replace(/\\/g, "/").trim();
  if (!path) return false;
  return (
    SHARED_DIRECTORY.test(path) ||
    SHARED_FILENAME.test(path) ||
    SHARED_STYLESHEET.test(path)
  );
}

function informative(attempt: WebsiteAttemptSummary): boolean {
  return Boolean(
    attempt.hypothesis?.trim() ||
    attempt.decisionReasons?.some((reason) => reason.trim()) ||
    attempt.filesModified?.length,
  );
}

function historyRank(
  attempt: WebsiteAttemptSummary,
  metric: string,
  scenario: string,
  page: string | undefined,
): number | null {
  if (attempt.status === "running" || !informative(attempt)) return null;
  if (attempt.targetMetric === metric && attempt.scenario === scenario)
    return 0;
  if (attempt.targetMetric === metric) return 1;
  if (page && pageId(attempt.scenario) === page) return 2;
  if ((attempt.filesModified ?? []).some(isSharedFile)) return 3;
  return null;
}

export function selectRelevantHistory(
  history: WebsiteAttemptSummary[],
  bottleneck: Pick<Bottleneck, "metric" | "scenario">,
): WebsiteAttemptSummary[] {
  const page = pageId(bottleneck.scenario);
  return history
    .map((attempt, index) => ({
      attempt,
      index,
      rank: historyRank(attempt, bottleneck.metric, bottleneck.scenario, page),
    }))
    .filter(
      (item): item is typeof item & { rank: number } => item.rank !== null,
    )
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.attempt.id !== b.attempt.id)
        return a.attempt.id < b.attempt.id ? 1 : -1;
      return a.index - b.index;
    })
    .slice(0, HISTORY_LIMIT)
    .map((item) => item.attempt);
}

function uniqueClip(
  values: string[],
  maxItems: number,
  maxLen: number,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const sorted = values
    .map((value) => value.replace(/\\/g, "/").trim())
    .filter(Boolean)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const value of sorted) {
    const clipped = clip(value, maxLen);
    if (!clipped || seen.has(clipped)) continue;
    seen.add(clipped);
    result.push(clipped);
    if (result.length >= maxItems) break;
  }
  return result;
}

function improvementOf(attempt: WebsiteAttemptSummary): number | null {
  const given = real(attempt.improvementPercent);
  if (given !== null) return round(given, 2);
  const reference = real(attempt.referenceMedian);
  const candidate = real(attempt.candidateMedian);
  if (reference === null || candidate === null || reference === 0) return null;
  return round((100 * (reference - candidate)) / reference, 2);
}

function roundOrNull(
  value: number | null | undefined,
  digits: number,
): number | null {
  const next = real(value);
  if (next === null) return null;
  return round(next, digits);
}

function compactAttempt(attempt: WebsiteAttemptSummary): CompactAttempt {
  const digits = attempt.targetMetric === "cls" ? 4 : 1;
  return {
    id: attempt.id,
    status: attempt.status,
    metric: attempt.targetMetric ?? null,
    scenario: attempt.scenario ?? null,
    hypothesis: attempt.hypothesis
      ? clip(attempt.hypothesis, 200) || null
      : null,
    improvementPercent: improvementOf(attempt),
    referenceMedian: roundOrNull(attempt.referenceMedian, digits),
    candidateMedian: roundOrNull(attempt.candidateMedian, digits),
    reasons: (attempt.decisionReasons ?? [])
      .map((reason) => clip(reason, REASON_MAX))
      .filter(Boolean)
      .slice(0, REASON_LIMIT),
    filesModified: uniqueClip(
      attempt.filesModified ?? [],
      FILE_LIMIT,
      FILE_MAX,
    ),
    regressions: (attempt.regressions ?? [])
      .filter(
        (item) =>
          typeof item.metric === "string" &&
          typeof item.percent === "number" &&
          Number.isFinite(item.percent),
      )
      .slice(0, 3)
      .map((item) => ({
        metric: item.metric,
        percent: round(item.percent, 2),
      })),
  };
}

function objectiveOf(
  config: WebsiteConfig,
  bottleneck: Bottleneck,
): OptimizationContext["objective"] {
  const page = config.pages.find(
    (item) => item.id === pageId(bottleneck.scenario),
  );
  const digits = metricDigits(bottleneck.metric);
  const current = real(bottleneck.median);
  return {
    metric: bottleneck.metric,
    scenario: bottleneck.scenario,
    pagePath: page?.path ?? null,
    current: current === null ? null : round(current, digits),
    target: round(bottleneck.threshold, digits),
  };
}

function protectedOf(
  config: WebsiteConfig,
  bottleneck: Bottleneck,
  aggregate: ScenarioAggregate | undefined,
): OptimizationContext["protectedMetrics"] {
  const result: OptimizationContext["protectedMetrics"] = [];
  for (const metric of config.objectives.protectedMetrics) {
    if (metric === bottleneck.metric) continue;
    if (metric === "inpMs" && !bottleneck.scenario.endsWith(":interaction"))
      continue;
    result.push({
      metric,
      median: metricMedian(aggregate, metric),
      threshold: round(
        effectiveThreshold(config, metric),
        metricDigits(metric),
      ),
    });
  }
  return result;
}

function fit(context: OptimizationContext): OptimizationContext {
  let next = context;
  while (
    next.previousAttempts.length > 0 &&
    JSON.stringify(next).length > CONTEXT_JSON_MAX
  ) {
    next = {
      ...next,
      previousAttempts: next.previousAttempts.slice(0, -1),
    };
  }
  return next;
}

export function buildOptimizationContext(options: {
  config: WebsiteConfig;
  bottleneck: Bottleneck;
  aggregates: ScenarioAggregate[];
  history: WebsiteAttemptSummary[];
}): OptimizationContext {
  const aggregate = options.aggregates.find(
    (item) => item.scenario === options.bottleneck.scenario,
  );
  const diagnosed = diagnose(options.bottleneck.metric, aggregate);
  return fit({
    objective: objectiveOf(options.config, options.bottleneck),
    diagnostics: diagnosed.diagnostics,
    potentialBottlenecks: diagnosed.potentialBottlenecks,
    notes: diagnosed.notes,
    protectedMetrics: protectedOf(
      options.config,
      options.bottleneck,
      aggregate,
    ),
    previousAttempts: selectRelevantHistory(
      options.history,
      options.bottleneck,
    ).map(compactAttempt),
  });
}
