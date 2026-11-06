import {
  effectiveThreshold,
  type CwvMetric,
  type WebsiteConfig,
} from "./config.js";
import type { ScenarioAggregate } from "./measure/types.js";

export interface Bottleneck {
  metric: CwvMetric;
  scenario: string;
  median: number;
  threshold: number;
  excessRatio: number;
}

export interface AcceptanceDecision {
  accepted: boolean;
  inconclusive: boolean;
  reasons: string[];
  targetMetric: CwvMetric;
  scenario: string;
  referenceMedian: number | null;
  candidateMedian: number | null;
  improvementPercent: number | null;
  regressions: Array<{ metric: CwvMetric; percent: number }>;
}

const primaryOrder: CwvMetric[] = ["lcpMs", "inpMs", "cls", "fcpMs"];

export function selectBottleneck(
  aggregates: ScenarioAggregate[],
  config: WebsiteConfig,
): Bottleneck | null {
  const candidates: Bottleneck[] = [];
  for (const aggregate of aggregates) {
    for (const metric of primaryOrder) {
      if (metric === "inpMs" && !aggregate.scenario.endsWith(":interaction"))
        continue;
      const median = aggregate.medians[metric];
      if (median === null || median === undefined) continue;
      const threshold = effectiveThreshold(config, metric);
      if (median <= threshold) continue;
      candidates.push({
        metric,
        scenario: aggregate.scenario,
        median,
        threshold,
        excessRatio: median / threshold,
      });
    }
  }
  candidates.sort((a, b) => b.excessRatio - a.excessRatio);
  return candidates[0] ?? null;
}

export function compareCandidate(options: {
  config: WebsiteConfig;
  targetMetric: CwvMetric;
  scenario: string;
  reference: ScenarioAggregate;
  candidate: ScenarioAggregate;
  allReference: ScenarioAggregate[];
  allCandidate: ScenarioAggregate[];
}): AcceptanceDecision {
  const {
    config,
    targetMetric,
    scenario,
    reference,
    candidate,
    allReference,
    allCandidate,
  } = options;
  const reasons: string[] = [];
  const referenceMedian = reference.medians[targetMetric] ?? null;
  const candidateMedian = candidate.medians[targetMetric] ?? null;
  let inconclusive = false;

  if (referenceMedian === null || candidateMedian === null) {
    reasons.push("Required target metric samples are unavailable");
    inconclusive = true;
  }

  const referenceSpread = reference.variability[targetMetric] ?? 0;
  const improvementPercent =
    referenceMedian && candidateMedian !== null && referenceMedian !== 0
      ? (100 * (referenceMedian - candidateMedian)) / referenceMedian
      : null;

  if (improvementPercent !== null && !inconclusive && referenceMedian !== null) {
    const uncertainty =
      referenceMedian === 0
        ? 0
        : (100 * (referenceSpread ?? 0)) / Math.max(referenceMedian, Number.EPSILON);
    const required = Math.max(
      config.objectives.minImprovementPercent,
      uncertainty * 0.5,
    );
    if (improvementPercent < required) {
      reasons.push(
        `Target metric improvement ${improvementPercent.toFixed(2)}% is below required ${required.toFixed(2)}% (includes variability margin)`,
      );
    }
  }

  const regressions: AcceptanceDecision["regressions"] = [];
  for (const metric of config.objectives.protectedMetrics) {
    // INP is only meaningful on interaction scenarios (same rule as selectBottleneck).
    if (metric === "inpMs" && !scenario.endsWith(":interaction")) continue;
    const refAgg =
      allReference.find((item) => item.scenario === scenario) ?? reference;
    const candAgg =
      allCandidate.find((item) => item.scenario === scenario) ?? candidate;
    const refValue = refAgg.medians[metric];
    const candValue = candAgg.medians[metric];
    if (refValue === null || refValue === undefined || candValue === null || candValue === undefined) {
      if (metric === targetMetric) continue;
      reasons.push(`Protected metric ${metric} unavailable for regression check`);
      inconclusive = true;
      continue;
    }
    if (metric === targetMetric) continue;
    if (refValue <= 0) continue;
    const regressionPercent = (100 * (candValue - refValue)) / refValue;
    if (regressionPercent > config.objectives.maxRegressionPercent) {
      regressions.push({ metric, percent: regressionPercent });
      reasons.push(
        `Protected metric ${metric} regressed by ${regressionPercent.toFixed(2)}%`,
      );
    }
  }

  const accepted = !reasons.length && !inconclusive;
  if (accepted)
    reasons.push("Target metric improved beyond variability without protected regressions");
  if (!accepted && !reasons.length) reasons.push("INCONCLUSIVE");

  return {
    accepted,
    inconclusive: inconclusive || (!accepted && improvementPercent === null),
    reasons,
    targetMetric,
    scenario,
    referenceMedian,
    candidateMedian,
    improvementPercent,
    regressions,
  };
}

export function quickReject(
  config: WebsiteConfig,
  targetMetric: CwvMetric,
  reference: ScenarioAggregate,
  candidate: ScenarioAggregate,
): { reject: boolean; reason?: string } {
  const ref = reference.medians[targetMetric];
  const cand = candidate.medians[targetMetric];
  if (ref === null || ref === undefined || cand === null || cand === undefined)
    return { reject: true, reason: "Quick benchmark missing target metric" };
  if (cand > ref * (1 + config.objectives.maxRegressionPercent / 100))
    return {
      reject: true,
      reason: "Quick benchmark clearly worse than reference",
    };

  const scenario = candidate.scenario || reference.scenario;
  for (const metric of config.objectives.protectedMetrics) {
    if (metric === targetMetric) continue;
    if (metric === "inpMs" && !scenario.endsWith(":interaction")) continue;
    const refValue = reference.medians[metric];
    const candValue = candidate.medians[metric];
    if (
      refValue === null ||
      refValue === undefined ||
      candValue === null ||
      candValue === undefined ||
      refValue <= 0
    ) {
      continue;
    }
    const regressionPercent = (100 * (candValue - refValue)) / refValue;
    if (regressionPercent > config.objectives.maxRegressionPercent) {
      return {
        reject: true,
        reason: `Quick benchmark protected metric ${metric} regressed by ${regressionPercent.toFixed(2)}%`,
      };
    }
  }

  return { reject: false };
}
