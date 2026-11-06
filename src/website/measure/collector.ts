/**
 * Injected before navigation. Collects web-vitals attribution via PerformanceObserver
 * and Navigation Timing. Kept as a string so Playwright can addInitScript it.
 */
export const collectorInitScript = `
(() => {
  if (window.__cwvCollector) return;
  const state = {
    lcp: null,
    fcp: null,
    cls: { value: 0, entries: [] },
    inp: null,
    ttfb: null,
    longAnimationFrames: 0,
    finalized: false,
  };

  const visibility = () => document.visibilityState;

  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) state.ttfb = nav.responseStart;
  } catch {}

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
  } catch {}

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        state.lcp = {
          value: last.startTime,
          element: last.element ? (last.element.tagName + (last.element.id ? '#' + last.element.id : '') + (last.element.className ? '.' + String(last.element.className).trim().split(/\\s+/).slice(0,2).join('.') : '')) : undefined,
          url: last.url || null,
          size: last.size,
          renderTime: last.renderTime,
          loadTime: last.loadTime,
        };
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}

  try {
    let sessionValue = 0;
    let sessionEntries = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        const first = sessionEntries[0];
        const last = sessionEntries[sessionEntries.length - 1];
        if (
          sessionValue &&
          entry.startTime - (last?.startTime ?? 0) < 1000 &&
          entry.startTime - (first?.startTime ?? 0) < 5000
        ) {
          sessionValue += entry.value;
          sessionEntries.push(entry);
        } else {
          sessionValue = entry.value;
          sessionEntries = [entry];
        }
        if (sessionValue > state.cls.value) {
          state.cls = {
            value: sessionValue,
            entries: sessionEntries.map((e) => ({
              value: e.value,
              startTime: e.startTime,
              sources: (e.sources || []).map((s) => {
                const node = s.node;
                if (!node) return 'unknown';
                return node.tagName + (node.id ? '#' + node.id : '');
              }),
            })),
          };
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}

  try {
    let worst = null;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.interactionId || entry.duration >= 40) {
          if (!worst || entry.duration > worst.duration) {
            worst = {
              value: entry.duration,
              eventTarget: entry.target ? (entry.target.tagName + (entry.target.id ? '#' + entry.target.id : '')) : undefined,
              eventType: entry.name,
              startTime: entry.startTime,
              processingStart: entry.processingStart,
              processingEnd: entry.processingEnd,
            };
          }
        }
      }
      state.inp = worst;
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch {}

  try {
    new PerformanceObserver((list) => {
      state.longAnimationFrames += list.getEntries().length;
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {}

  function resourceAttribution(lcp) {
    if (!lcp || !lcp.url) {
      return {
        ttfb: state.ttfb,
        resourceLoadDelay: null,
        resourceLoadDuration: null,
        elementRenderDelay: null,
      };
    }
    try {
      const resources = performance.getEntriesByType('resource');
      const match = resources.find((r) => r.name === lcp.url) || resources.find((r) => lcp.url.endsWith(r.name.split('/').pop()));
      const nav = performance.getEntriesByType('navigation')[0];
      const ttfb = nav ? nav.responseStart : state.ttfb;
      if (!match) {
        return { ttfb, resourceLoadDelay: null, resourceLoadDuration: null, elementRenderDelay: null };
      }
      const resourceLoadDelay = Math.max(0, match.startTime - (ttfb || 0));
      const resourceLoadDuration = match.responseEnd - match.startTime;
      const elementRenderDelay = Math.max(0, lcp.value - match.responseEnd);
      return { ttfb, resourceLoadDelay, resourceLoadDuration, elementRenderDelay };
    } catch {
      return { ttfb: state.ttfb, resourceLoadDelay: null, resourceLoadDuration: null, elementRenderDelay: null };
    }
  }

  function resourceStats() {
    try {
      const resources = performance.getEntriesByType('resource');
      let total = 0, js = 0, css = 0;
      for (const r of resources) {
        const size = r.transferSize || 0;
        total += size;
        if (r.initiatorType === 'script' || /\\.m?js(\\?|$)/.test(r.name)) js += size;
        if (r.initiatorType === 'link' || /\\.css(\\?|$)/.test(r.name)) css += size;
      }
      return { resourceTransferBytes: total, jsTransferBytes: js, cssTransferBytes: css };
    } catch {
      return { resourceTransferBytes: 0, jsTransferBytes: 0, cssTransferBytes: 0 };
    }
  }

  window.__cwvCollector = {
    snapshot() {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) state.ttfb = nav.responseStart;
      const lcpAttr = resourceAttribution(state.lcp);
      const largest = state.cls.entries?.slice().sort((a,b) => b.value - a.value)[0];
      return {
        visibility: visibility(),
        lcp: state.lcp ? { value: state.lcp.value, element: state.lcp.element, url: state.lcp.url, ...lcpAttr } : null,
        fcp: state.fcp,
        cls: { value: state.cls.value, largestShiftValue: largest?.value ?? null, sources: largest?.sources ?? [] },
        inp: state.inp,
        ttfb: state.ttfb,
        longAnimationFrames: state.longAnimationFrames,
        ...resourceStats(),
      };
    },
  };
})();
`;

export interface CollectorSnapshot {
  visibility?: string;
  lcp: {
    value: number;
    element?: string;
    url?: string | null;
    ttfb?: number | null;
    resourceLoadDelay?: number | null;
    resourceLoadDuration?: number | null;
    elementRenderDelay?: number | null;
  } | null;
  fcp: number | null;
  cls: {
    value: number;
    largestShiftValue?: number | null;
    sources?: string[];
  };
  inp: {
    value: number;
    eventTarget?: string;
    eventType?: string;
    processingStart?: number;
    processingEnd?: number;
    startTime?: number;
  } | null;
  ttfb: number | null;
  longAnimationFrames?: number;
  resourceTransferBytes?: number;
  jsTransferBytes?: number;
  cssTransferBytes?: number;
}
