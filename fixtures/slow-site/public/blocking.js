// Intentionally blocks parsing; keeps main thread busy briefly.
const start = Date.now();
while (Date.now() - start < 80) {
  // busy wait
}
window.__blockingReady = true;
