// Stub for node:fs/promises — safe to import in browser workers.
// @bench/loaders' fetchBytes imports readFile but only calls it for non-http URLs,
// which never happen in browser context (all artifact URLs are served over http(s)).
export function readFile() {
  throw new Error("readFile is not available in the browser");
}
