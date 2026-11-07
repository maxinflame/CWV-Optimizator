import type { CwvMetric } from "../config.js";

export type MetricAvailability = "available" | "unavailable";

export interface MetricValue {
  value: number | null;
  availability: MetricAvailability;
}

export interface LcpAttribution {
  element?: string;
  url?: string | null;
  ttfb?: number | null;
  resourceLoadDelay?: number | null;
  resourceLoadDuration?: number | null;
  elementRenderDelay?: number | null;
  size?: number;
  renderTime?: number;
  loadTime?: number;
  navigationType?: string;
  rating?: string;
}

export interface ClsAttribution {
  largestShiftValue?: number | null;
  sources?: string[];
  largestShiftTarget?: string;
  largestShiftTime?: number;
  loadState?: string;
}

export interface InpAttribution {
  eventTarget?: string;
  eventType?: string;
  inputDelay?: number | null;
  processingDuration?: number | null;
  presentationDelay?: number | null;
  loadState?: string;
  interactionTime?: number;
  nextPaintTime?: number;
  longestScriptSubpart?: string;
  longestScriptSource?: string;
}

export interface BrowserMeasurement {
  scenario: string;
  pageId: string;
  scenarioKind: string;
  url: string;
  startedAt: string;
  finishedAt: string;
  lcpMs: MetricValue;
  fcpMs: MetricValue;
  cls: MetricValue;
  inpMs: MetricValue;
  ttfbMs: MetricValue;
  lcpAttribution?: LcpAttribution;
  clsAttribution?: ClsAttribution;
  inpAttribution?: InpAttribution;
  diagnostics?: {
    longAnimationFrames?: number;
    resourceTransferBytes?: number;
    jsTransferBytes?: number;
    cssTransferBytes?: number;
    mainThreadBlockingMs?: number;
    navigationResponseStart?: number | null;
    inpUnavailableReason?: string;
  };
  raw?: unknown;
}

export interface ScenarioAggregate {
  scenario: string;
  samples: BrowserMeasurement[];
  medians: Partial<Record<CwvMetric | "ttfbMs", number | null>>;
  variability: Partial<Record<CwvMetric | "ttfbMs", number | null>>;
}

export function metricNumber(value: MetricValue | undefined): number | null {
  if (!value || value.availability !== "available" || value.value === null)
    return null;
  return value.value;
}
