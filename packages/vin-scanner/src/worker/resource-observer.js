// Optional diagnostic metadata only; no URLs, images, or recognition data leave the worker.
try {
  new PerformanceObserver((list) => {
    const count = list.getEntries().filter((entry) => /^https?:/.test(entry.name)).length;
    if (count) self.postMessage({ type: "diagnostics-resources", count });
  }).observe({ type: "resource", buffered: true });
} catch {
  // Resource timing is not required for recognition.
}
