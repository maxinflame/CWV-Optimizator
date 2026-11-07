/**
 * Чистые функции отчётов web-vitals. Модуль выполняется и в Node-тестах,
 * и внутри браузерного бандла. Сюда нельзя импортировать Playwright или DOM.
 */

export type VitalName = "LCP" | "FCP" | "CLS" | "INP" | "TTFB";

export interface VitalReport {
  name: VitalName;
  id: string;
  value: number;
  navigationId: number;
  navigationURL?: string;
  navigationType?: string;
  rating?: string;
  attribution: Record<string, unknown>;
}

export interface ReportStore {
  record(report: VitalReport): void;
  latest(name: VitalName): VitalReport | null;
  has(name: VitalName): boolean;
}

export function createReportStore(): ReportStore {
  const byId = new Map<string, VitalReport & { sequence: number }>();
  let sequence = 0;

  return {
    record(report) {
      if (!Number.isFinite(report.value) || report.value < 0) return;
      sequence += 1;
      const key = `${report.name}:${report.id}`;
      byId.set(key, {
        name: report.name,
        id: report.id,
        value: report.value,
        navigationId: report.navigationId,
        ...(report.navigationURL
          ? { navigationURL: report.navigationURL }
          : {}),
        ...(report.navigationType
          ? { navigationType: report.navigationType }
          : {}),
        ...(report.rating ? { rating: report.rating } : {}),
        attribution: { ...report.attribution },
        sequence,
      });
    },
    latest(name) {
      let best: (VitalReport & { sequence: number }) | null = null;
      for (const report of byId.values()) {
        if (report.name !== name) continue;
        if (!best || report.sequence > best.sequence) best = report;
      }
      if (!best) return null;
      return {
        name: best.name,
        id: best.id,
        value: best.value,
        navigationId: best.navigationId,
        ...(best.navigationURL ? { navigationURL: best.navigationURL } : {}),
        ...(best.navigationType ? { navigationType: best.navigationType } : {}),
        ...(best.rating ? { rating: best.rating } : {}),
        attribution: best.attribution,
      };
    },
    has(name) {
      return this.latest(name) !== null;
    },
  };
}

export interface LcpPartInput {
  hasPaintEntry: boolean;
  hasNavigationTiming: boolean;
  timeToFirstByte: number;
  resourceLoadDelay: number;
  resourceLoadDuration: number;
  elementRenderDelay: number;
  url?: string;
  resourceTimingAvailable: boolean;
}

export interface LcpParts {
  ttfb: number | null;
  resourceLoadDelay: number | null;
  resourceLoadDuration: number | null;
  elementRenderDelay: number | null;
}

/**
 * Нулевые фазы ресурса из web-vitals означают «ресурса нет» или «тайминги
 * закрыты cross-origin». Такие нули не записываются как измеренное время.
 * Настоящий нуль сохраняется только когда запись Resource Timing пригодна.
 */
export function selectLcpParts(input: LcpPartInput): LcpParts {
  if (!input.hasPaintEntry) {
    return {
      ttfb: null,
      resourceLoadDelay: null,
      resourceLoadDuration: null,
      elementRenderDelay: null,
    };
  }

  const ttfb = input.hasNavigationTiming ? input.timeToFirstByte : null;
  const url = input.url?.trim();
  if (!url) {
    return {
      ttfb,
      resourceLoadDelay: null,
      resourceLoadDuration: null,
      elementRenderDelay: input.hasNavigationTiming
        ? input.elementRenderDelay
        : null,
    };
  }
  if (!input.resourceTimingAvailable) {
    return {
      ttfb,
      resourceLoadDelay: null,
      resourceLoadDuration: null,
      elementRenderDelay: null,
    };
  }
  return {
    ttfb,
    resourceLoadDelay: input.resourceLoadDelay,
    resourceLoadDuration: input.resourceLoadDuration,
    elementRenderDelay: input.elementRenderDelay,
  };
}

export function resourceTimingAvailable(
  resource:
    | {
        responseEnd?: number;
        requestStart?: number;
        startTime?: number;
      }
    | null
    | undefined,
): boolean {
  if (!resource) return false;
  const responseEnd = resource.responseEnd ?? 0;
  const requestStart = resource.requestStart ?? 0;
  const startTime = resource.startTime ?? 0;
  if (!(responseEnd > 0)) return false;
  if (!(requestStart > 0) && !(startTime > 0)) return false;
  return true;
}

export function clsSources(fromNodes: string[], target?: string): string[] {
  const sources = fromNodes
    .map((source) => source.trim())
    .filter((source) => source.length > 0);
  if (!sources.length && target?.trim()) sources.push(target.trim());
  return sources;
}

export const INP_UNAVAILABLE_REASON = "No qualifying interaction was recorded";

export interface SnapshotExtras {
  visibility: string;
  finalized: boolean;
  hiddenTrusted: boolean;
  loadedInBackground: boolean;
  installedReadyState: string;
  installedAtMs: number;
  fatalErrors: string[];
  diagnosticErrors: string[];
  longAnimationFrames: number;
  resourceTransferBytes: number;
  jsTransferBytes: number;
  cssTransferBytes: number;
  navigationResponseStart: number | null;
}

export interface LcpSnapshot {
  value: number;
  id: string;
  element?: string;
  url: string | null;
  ttfb: number | null;
  resourceLoadDelay: number | null;
  resourceLoadDuration: number | null;
  elementRenderDelay: number | null;
  size?: number;
  renderTime?: number;
  loadTime?: number;
  navigationType?: string;
  rating?: string;
}

export interface ClsSnapshot {
  value: number;
  id: string;
  largestShiftValue: number | null;
  sources: string[];
  largestShiftTarget?: string;
  largestShiftTime?: number;
  loadState?: string;
}

export interface InpSnapshot {
  value: number;
  id: string;
  eventTarget?: string;
  eventType?: string;
  inputDelay: number | null;
  processingDuration: number | null;
  presentationDelay: number | null;
  loadState?: string;
  interactionTime?: number;
  nextPaintTime?: number;
  longestScriptSubpart?: string;
  longestScriptSource?: string;
}

export interface PhaseDetails {
  id: string;
  value: number;
  timeToFirstByte: number | null;
  firstByteToFCP: number | null;
  loadState?: string;
}

export interface TtfbDetails {
  id: string;
  value: number;
  waitingDuration: number | null;
  cacheDuration: number | null;
  dnsDuration: number | null;
  connectionDuration: number | null;
  requestDuration: number | null;
}

export interface CollectorSnapshot {
  visibility: string;
  finalized: boolean;
  hiddenTrusted: boolean;
  loadedInBackground: boolean;
  installedReadyState: string;
  installedAtMs: number;
  fatalErrors: string[];
  diagnosticErrors: string[];
  navigationURL: string | null;
  navigationResponseStart: number | null;
  inpUnavailableReason: string | null;
  ids: {
    lcp: string | null;
    fcp: string | null;
    cls: string | null;
    inp: string | null;
    ttfb: string | null;
  };
  lcp: LcpSnapshot | null;
  fcp: number | null;
  fcpDetails: PhaseDetails | null;
  cls: ClsSnapshot | null;
  inp: InpSnapshot | null;
  ttfb: number | null;
  ttfbDetails: TtfbDetails | null;
  longAnimationFrames: number;
  resourceTransferBytes: number;
  jsTransferBytes: number;
  cssTransferBytes: number;
}

export interface CollectorController {
  flush(options: { expectInp: boolean; timeoutMs: number }): Promise<void>;
  markFinalized(): Promise<void>;
  snapshot(): CollectorSnapshot;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalFinite(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number === null ? undefined : number;
}

function lcpSnapshot(report: VitalReport): LcpSnapshot {
  const attribution = report.attribution;
  const element = text(attribution.element);
  const snapshot: LcpSnapshot = {
    value: report.value,
    id: report.id,
    url: text(attribution.url) ?? null,
    ttfb: finiteNumber(attribution.ttfb),
    resourceLoadDelay: finiteNumber(attribution.resourceLoadDelay),
    resourceLoadDuration: finiteNumber(attribution.resourceLoadDuration),
    elementRenderDelay: finiteNumber(attribution.elementRenderDelay),
  };
  if (element) snapshot.element = element;
  const size = optionalFinite(attribution.size);
  const renderTime = optionalFinite(attribution.renderTime);
  const loadTime = optionalFinite(attribution.loadTime);
  const navigationType = text(report.navigationType);
  const rating = text(report.rating);
  if (size !== undefined) snapshot.size = size;
  if (renderTime !== undefined) snapshot.renderTime = renderTime;
  if (loadTime !== undefined) snapshot.loadTime = loadTime;
  if (navigationType) snapshot.navigationType = navigationType;
  if (rating) snapshot.rating = rating;
  return snapshot;
}

function clsSnapshot(report: VitalReport): ClsSnapshot {
  const attribution = report.attribution;
  const sources = Array.isArray(attribution.sources)
    ? attribution.sources.filter(
        (source): source is string => typeof source === "string",
      )
    : [];
  const snapshot: ClsSnapshot = {
    value: report.value,
    id: report.id,
    largestShiftValue: finiteNumber(attribution.largestShiftValue),
    sources,
  };
  const target = text(attribution.largestShiftTarget);
  const loadState = text(attribution.loadState);
  const largestShiftTime = optionalFinite(attribution.largestShiftTime);
  if (target) snapshot.largestShiftTarget = target;
  if (largestShiftTime !== undefined)
    snapshot.largestShiftTime = largestShiftTime;
  if (loadState) snapshot.loadState = loadState;
  return snapshot;
}

function inpSnapshot(report: VitalReport): InpSnapshot {
  const attribution = report.attribution;
  const snapshot: InpSnapshot = {
    value: report.value,
    id: report.id,
    inputDelay: finiteNumber(attribution.inputDelay),
    processingDuration: finiteNumber(attribution.processingDuration),
    presentationDelay: finiteNumber(attribution.presentationDelay),
  };
  const eventTarget = text(attribution.eventTarget);
  const eventType = text(attribution.eventType);
  const loadState = text(attribution.loadState);
  const interactionTime = optionalFinite(attribution.interactionTime);
  const nextPaintTime = optionalFinite(attribution.nextPaintTime);
  const longestScriptSubpart = text(attribution.longestScriptSubpart);
  const longestScriptSource = text(attribution.longestScriptSource);
  if (eventTarget) snapshot.eventTarget = eventTarget;
  if (eventType) snapshot.eventType = eventType;
  if (loadState) snapshot.loadState = loadState;
  if (interactionTime !== undefined) snapshot.interactionTime = interactionTime;
  if (nextPaintTime !== undefined) snapshot.nextPaintTime = nextPaintTime;
  if (longestScriptSubpart)
    snapshot.longestScriptSubpart = longestScriptSubpart;
  if (longestScriptSource) snapshot.longestScriptSource = longestScriptSource;
  return snapshot;
}

function phaseDetails(report: VitalReport | null): PhaseDetails | null {
  if (!report) return null;
  const attribution = report.attribution;
  const details: PhaseDetails = {
    id: report.id,
    value: report.value,
    timeToFirstByte: finiteNumber(attribution.timeToFirstByte),
    firstByteToFCP: finiteNumber(attribution.firstByteToFCP),
  };
  const loadState = text(attribution.loadState);
  if (loadState) details.loadState = loadState;
  return details;
}

function ttfbDetails(report: VitalReport | null): TtfbDetails | null {
  if (!report) return null;
  const attribution = report.attribution;
  return {
    id: report.id,
    value: report.value,
    waitingDuration: finiteNumber(attribution.waitingDuration),
    cacheDuration: finiteNumber(attribution.cacheDuration),
    dnsDuration: finiteNumber(attribution.dnsDuration),
    connectionDuration: finiteNumber(attribution.connectionDuration),
    requestDuration: finiteNumber(attribution.requestDuration),
  };
}

export function buildSnapshot(
  store: ReportStore,
  extras: SnapshotExtras,
): CollectorSnapshot {
  const lcp = store.latest("LCP");
  const fcp = store.latest("FCP");
  const cls = store.latest("CLS");
  const inp = store.latest("INP");
  const ttfb = store.latest("TTFB");
  const navigationURL =
    text(lcp?.navigationURL) ??
    text(fcp?.navigationURL) ??
    text(ttfb?.navigationURL) ??
    text(cls?.navigationURL) ??
    text(inp?.navigationURL) ??
    null;

  return {
    visibility: extras.visibility,
    finalized: extras.finalized,
    hiddenTrusted: extras.hiddenTrusted,
    loadedInBackground: extras.loadedInBackground,
    installedReadyState: extras.installedReadyState,
    installedAtMs: extras.installedAtMs,
    fatalErrors: [...extras.fatalErrors],
    diagnosticErrors: [...extras.diagnosticErrors],
    navigationURL,
    navigationResponseStart: extras.navigationResponseStart,
    inpUnavailableReason: inp ? null : INP_UNAVAILABLE_REASON,
    ids: {
      lcp: lcp?.id ?? null,
      fcp: fcp?.id ?? null,
      cls: cls?.id ?? null,
      inp: inp?.id ?? null,
      ttfb: ttfb?.id ?? null,
    },
    lcp: lcp ? lcpSnapshot(lcp) : null,
    fcp: fcp ? fcp.value : null,
    fcpDetails: phaseDetails(fcp),
    cls: cls ? clsSnapshot(cls) : null,
    inp: inp ? inpSnapshot(inp) : null,
    ttfb: ttfb ? ttfb.value : null,
    ttfbDetails: ttfbDetails(ttfb),
    longAnimationFrames: extras.longAnimationFrames,
    resourceTransferBytes: extras.resourceTransferBytes,
    jsTransferBytes: extras.jsTransferBytes,
    cssTransferBytes: extras.cssTransferBytes,
  };
}
