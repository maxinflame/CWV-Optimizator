/**
 * Точка входа браузерного бандла. Скрипт ставится через Playwright
 * addInitScript и выполняется в тестируемой странице до её собственных скриптов.
 * Официальные колбэки web-vitals/attribution — единственный источник LCP, INP,
 * CLS, FCP и TTFB. Синтетический visibilitychange не отправляется.
 */
import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type CLSMetricWithAttribution,
  type FCPMetricWithAttribution,
  type INPMetricWithAttribution,
  type LCPMetricWithAttribution,
  type TTFBMetricWithAttribution,
} from "web-vitals/attribution";
import {
  buildSnapshot,
  clsSources,
  createReportStore,
  resourceTimingAvailable,
  selectLcpParts,
  type CollectorController,
  type SnapshotExtras,
  type VitalReport,
} from "../reports.ts";

declare global {
  interface Window {
    __cwvCollector?: CollectorController;
  }
}

const LAB_REPORT = { reportAllChanges: true } as const;
/** Ниже 16 мс Chromium не создаёт event entries. Полевые 40 мс слишком грубы для лабораторного клика. */
const LAB_INP_DURATION_THRESHOLD = 16;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elementLabel(node: Node | null | undefined): string | null {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  try {
    const id = element.id ? `#${element.id}` : "";
    const className =
      typeof element.className === "string" ? element.className.trim() : "";
    const classes = className
      ? `.${className.split(/\s+/).slice(0, 2).join(".")}`
      : "";
    const tag = element.tagName;
    if (!tag) return null;
    return `${tag}${id}${classes}`;
  } catch {
    return null;
  }
}

function baseReport(
  metric: {
    name: VitalReport["name"];
    id: string;
    value: number;
    navigationId: number;
    navigationURL?: string;
    navigationType?: string;
    rating?: string;
  },
  attribution: Record<string, unknown>,
): VitalReport {
  return {
    name: metric.name,
    id: metric.id,
    value: metric.value,
    navigationId: metric.navigationId,
    ...(metric.navigationURL ? { navigationURL: metric.navigationURL } : {}),
    ...(metric.navigationType ? { navigationType: metric.navigationType } : {}),
    ...(metric.rating ? { rating: metric.rating } : {}),
    attribution,
  };
}

function recordLcp(metric: LCPMetricWithAttribution): VitalReport {
  const attribution = metric.attribution;
  const resource = attribution.lcpResourceEntry;
  const parts = selectLcpParts({
    hasPaintEntry: metric.entries.length > 0,
    hasNavigationTiming: Boolean(attribution.navigationEntry),
    timeToFirstByte: attribution.timeToFirstByte,
    resourceLoadDelay: attribution.resourceLoadDelay,
    resourceLoadDuration: attribution.resourceLoadDuration,
    elementRenderDelay: attribution.elementRenderDelay,
    url: attribution.url,
    resourceTimingAvailable: resourceTimingAvailable(resource),
  });
  const entry = attribution.lcpEntry;
  return baseReport(metric, {
    element: attribution.target,
    url: attribution.url ?? null,
    ...parts,
    size: entry?.size,
    renderTime: entry?.renderTime,
    loadTime: entry?.loadTime,
  });
}

function recordCls(metric: CLSMetricWithAttribution): VitalReport {
  const attribution = metric.attribution;
  const entry = attribution.largestShiftEntry;
  const fromNodes: string[] = [];
  for (const source of entry?.sources ?? []) {
    const label = elementLabel(source?.node);
    if (label) fromNodes.push(label);
  }
  return baseReport(metric, {
    largestShiftValue: attribution.largestShiftValue ?? null,
    largestShiftTarget: attribution.largestShiftTarget,
    largestShiftTime: attribution.largestShiftTime,
    loadState: attribution.loadState,
    sources: clsSources(fromNodes, attribution.largestShiftTarget),
  });
}

function recordInp(metric: INPMetricWithAttribution): VitalReport {
  const attribution = metric.attribution;
  const hasEntries = metric.entries.length > 0;
  const script = attribution.longestScript;
  const source = script?.entry.sourceURL || script?.entry.invoker;
  return baseReport(metric, {
    eventTarget: attribution.interactionTarget,
    eventType: attribution.interactionType,
    inputDelay: hasEntries ? attribution.inputDelay : null,
    processingDuration: hasEntries ? attribution.processingDuration : null,
    presentationDelay: hasEntries ? attribution.presentationDelay : null,
    loadState: attribution.loadState,
    interactionTime: attribution.interactionTime,
    nextPaintTime: attribution.nextPaintTime,
    longestScriptSubpart: script?.subpart,
    longestScriptSource: source,
  });
}

function recordFcp(metric: FCPMetricWithAttribution): VitalReport {
  const attribution = metric.attribution;
  const hasNavigation = Boolean(attribution.navigationEntry);
  return baseReport(metric, {
    timeToFirstByte: hasNavigation ? attribution.timeToFirstByte : null,
    firstByteToFCP: hasNavigation ? attribution.firstByteToFCP : null,
    loadState: attribution.loadState,
  });
}

function recordTtfb(metric: TTFBMetricWithAttribution): VitalReport {
  const attribution = metric.attribution;
  const entry = metric.entries[0];
  const hasNavigation = entry instanceof PerformanceNavigationTiming;
  return baseReport(metric, {
    waitingDuration: hasNavigation ? attribution.waitingDuration : null,
    cacheDuration: hasNavigation ? attribution.cacheDuration : null,
    dnsDuration: hasNavigation ? attribution.dnsDuration : null,
    connectionDuration: hasNavigation ? attribution.connectionDuration : null,
    requestDuration: hasNavigation ? attribution.requestDuration : null,
  });
}

function navigationResponseStart(): number | null {
  try {
    const navigation = performance.getEntriesByType("navigation")[0];
    if (!navigation || !Number.isFinite(navigation.responseStart)) return null;
    if (navigation.responseStart < 0) return null;
    return navigation.responseStart;
  } catch {
    return null;
  }
}

function resourceStats(): Pick<
  SnapshotExtras,
  "resourceTransferBytes" | "jsTransferBytes" | "cssTransferBytes"
> {
  try {
    const resources = performance.getEntriesByType("resource");
    let total = 0;
    let js = 0;
    let css = 0;
    for (const resource of resources) {
      const size = resource.transferSize || 0;
      total += size;
      if (
        resource.initiatorType === "script" ||
        /\.m?js(\?|$)/.test(resource.name)
      ) {
        js += size;
      }
      if (
        resource.initiatorType === "link" ||
        /\.css(\?|$)/.test(resource.name)
      ) {
        css += size;
      }
    }
    return {
      resourceTransferBytes: total,
      jsTransferBytes: js,
      cssTransferBytes: css,
    };
  } catch {
    return {
      resourceTransferBytes: 0,
      jsTransferBytes: 0,
      cssTransferBytes: 0,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function installBroken(message: string): void {
  const store = createReportStore();
  const controller: CollectorController = {
    async flush() {},
    async markFinalized() {},
    snapshot: () =>
      buildSnapshot(store, {
        visibility: document.visibilityState,
        finalized: false,
        hiddenTrusted: false,
        loadedInBackground: document.visibilityState === "hidden",
        installedReadyState: document.readyState,
        installedAtMs: performance.now(),
        fatalErrors: [message],
        diagnosticErrors: [],
        longAnimationFrames: 0,
        navigationResponseStart: navigationResponseStart(),
        ...resourceStats(),
      }),
  };
  window.__cwvCollector = controller;
}

function install(): void {
  if (window.__cwvCollector) return;

  const store = createReportStore();
  const fatalErrors: string[] = [];
  const diagnosticErrors: string[] = [];
  const installedReadyState = document.readyState;
  const installedAtMs = performance.now();
  const loadedInBackground =
    document.visibilityState === "hidden" && !document.prerendering;
  let hiddenTrusted = false;
  let finalized = false;
  let longAnimationFrames = 0;

  document.addEventListener(
    "visibilitychange",
    (event) => {
      if (event.isTrusted && document.visibilityState === "hidden") {
        hiddenTrusted = true;
      }
    },
    true,
  );

  const guard = (label: string, register: () => void, fatal: boolean): void => {
    try {
      register();
    } catch (error) {
      const message = `${label}: ${errorText(error)}`;
      if (fatal) fatalErrors.push(message);
      else diagnosticErrors.push(message);
    }
  };

  guard(
    "LCP",
    () => onLCP((metric) => store.record(recordLcp(metric)), LAB_REPORT),
    true,
  );
  guard(
    "CLS",
    () => onCLS((metric) => store.record(recordCls(metric)), LAB_REPORT),
    true,
  );
  guard(
    "FCP",
    () => onFCP((metric) => store.record(recordFcp(metric)), LAB_REPORT),
    true,
  );
  guard(
    "TTFB",
    () => onTTFB((metric) => store.record(recordTtfb(metric)), LAB_REPORT),
    true,
  );
  guard(
    "INP",
    () =>
      onINP((metric) => store.record(recordInp(metric)), {
        ...LAB_REPORT,
        durationThreshold: LAB_INP_DURATION_THRESHOLD,
      }),
    true,
  );
  guard(
    "long-animation-frame",
    () => {
      const observer = new PerformanceObserver((list) => {
        longAnimationFrames += list.getEntries().length;
      });
      observer.observe({ type: "long-animation-frame", buffered: true });
    },
    false,
  );

  const extras = (): SnapshotExtras => ({
    visibility: document.visibilityState,
    finalized,
    hiddenTrusted,
    loadedInBackground,
    installedReadyState,
    installedAtMs,
    fatalErrors,
    diagnosticErrors,
    longAnimationFrames,
    navigationResponseStart: navigationResponseStart(),
    ...resourceStats(),
  });

  const paintExpected = () => !loadedInBackground;

  const controller: CollectorController = {
    async flush(options) {
      if (document.readyState !== "complete") {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, options.timeoutMs);
          addEventListener(
            "load",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
      await delay(0);
      const deadline = performance.now() + options.timeoutMs;
      let signature: string | null = null;
      let stableSince: number | null = null;
      while (performance.now() < deadline) {
        const paintReady =
          !paintExpected() ||
          (store.has("LCP") && store.has("FCP") && store.has("CLS"));
        const inpReady = !options.expectInp || store.has("INP");
        if (paintReady && store.has("TTFB") && inpReady) {
          const next = [
            store.latest("LCP")?.id,
            store.latest("LCP")?.value,
            store.latest("CLS")?.id,
            store.latest("CLS")?.value,
            store.latest("INP")?.id,
            store.latest("INP")?.value,
          ].join(":");
          if (next === signature) {
            if (stableSince === null) stableSince = performance.now();
            // Ждём, пока late LCP/CLS перестанут обновлять отчёт.
            if (performance.now() - stableSince >= 300) break;
          } else {
            signature = next;
            stableSince = performance.now();
          }
        } else {
          signature = null;
          stableSince = null;
        }
        await delay(20);
      }
    },
    async markFinalized() {
      const deadline = performance.now() + 150;
      while (performance.now() < deadline && !hiddenTrusted) {
        await delay(16);
      }
      if (hiddenTrusted) await delay(0);
      finalized = true;
    },
    snapshot: () => buildSnapshot(store, extras()),
  };

  window.__cwvCollector = controller;
}

try {
  install();
} catch (error) {
  installBroken(errorText(error));
}
