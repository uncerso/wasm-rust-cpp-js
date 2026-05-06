// Browser-safe stub for `node:fs/promises`. Aliased in vite.config.ts so the
// worker can import @bench/loaders without Vite injecting a property-throwing
// proxy at module-eval time. fetchBytes only calls readFile for non-http(s)
// URLs, which never occur in the browser — all artifact URLs are http(s).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub intentionally ignores all args; browser never calls readFile
export function readFile(..._: unknown[]): Promise<never> {
    return Promise.reject(new Error("readFile is not available in the browser"));
}
