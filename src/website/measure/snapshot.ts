import type {
  BrowserMeasurement,
  ClsAttribution,
  InpAttribution,
  LcpAttribution,
  MetricValue,
} from "./types.js";
import type { CollectorSnapshot } from "./reports.js";

export function metricValue(value: number | null | undefined): MetricValue {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return { value: null, availability: "unavailable" };
  }
  return { value, availability: "available" };
}

function lcpAttribution(
  snapshot: CollectorSnapshot,
): LcpAttribution | undefined {
  const lcp = snapshot.lcp;
  if (!lcp) return undefined;
  const attribution: LcpAttribution = {
    element: lcp.element,
    url: lcp.url,
    ttfb: lcp.ttfb,
    resourceLoadDelay: lcp.resourceLoadDelay,
    resourceLoadDuration: lcp.resourceLoadDuration,
    elementRenderDelay: lcp.elementRenderDelay,
  };
  if (lcp.size !== undefined) attribution.size = lcp.size;
  if (lcp.renderTime !== undefined) attribution.renderTime = lcp.renderTime;
  if (lcp.loadTime !== undefined) attribution.loadTime = lcp.loadTime;
  if (lcp.navigationType) attribution.navigationType = lcp.navigationType;
  if (lcp.rating) attribution.rating = lcp.rating;
  return attribution;
}

function clsAttribution(
  snapshot: CollectorSnapshot,
): ClsAttribution | undefined {
  const cls = snapshot.cls;
  if (!cls) return undefined;
  const attribution: ClsAttribution = {
    largestShiftValue: cls.largestShiftValue,
    sources: cls.sources,
  };
  if (cls.largestShiftTarget)
    attribution.largestShiftTarget = cls.largestShiftTarget;
  if (cls.largestShiftTime !== undefined) {
    attribution.largestShiftTime = cls.largestShiftTime;
  }
  if (cls.loadState) attribution.loadState = cls.loadState;
  return attribution;
}

function inpAttribution(
  snapshot: CollectorSnapshot,
): InpAttribution | undefined {
  const inp = snapshot.inp;
  if (!inp) return undefined;
  const attribution: InpAttribution = {
    eventTarget: inp.eventTarget,
    eventType: inp.eventType,
    inputDelay: inp.inputDelay,
    processingDuration: inp.processingDuration,
    presentationDelay: inp.presentationDelay,
  };
  if (inp.loadState) attribution.loadState = inp.loadState;
  if (inp.interactionTime !== undefined)
    attribution.interactionTime = inp.interactionTime;
  if (inp.nextPaintTime !== undefined)
    attribution.nextPaintTime = inp.nextPaintTime;
  if (inp.longestScriptSubpart) {
    attribution.longestScriptSubpart = inp.longestScriptSubpart;
  }
  if (inp.longestScriptSource) {
    attribution.longestScriptSource = inp.longestScriptSource;
  }
  return attribution;
}

export function measurementFromSnapshot(
  snapshot: CollectorSnapshot,
  meta: {
    scenario: string;
    pageId: string;
    scenarioKind: string;
    url: string;
    startedAt: string;
    finishedAt: string;
  },
): BrowserMeasurement {
  return {
    ...meta,
    lcpMs: metricValue(snapshot.lcp?.value ?? null),
    fcpMs: metricValue(snapshot.fcp),
    cls: metricValue(snapshot.cls ? snapshot.cls.value : null),
    inpMs: metricValue(snapshot.inp?.value ?? null),
    ttfbMs: metricValue(snapshot.ttfb),
    lcpAttribution: lcpAttribution(snapshot),
    clsAttribution: clsAttribution(snapshot),
    inpAttribution: inpAttribution(snapshot),
    diagnostics: {
      longAnimationFrames: snapshot.longAnimationFrames,
      resourceTransferBytes: snapshot.resourceTransferBytes,
      jsTransferBytes: snapshot.jsTransferBytes,
      cssTransferBytes: snapshot.cssTransferBytes,
      navigationResponseStart: snapshot.navigationResponseStart,
      ...(snapshot.inpUnavailableReason
        ? { inpUnavailableReason: snapshot.inpUnavailableReason }
        : {}),
    },
    raw: snapshot,
  };
}
