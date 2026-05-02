import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, "../../dist"),
  server: { port: 5174, fs: { allow: [resolve(__dirname, "../..")] } },
  build: { target: "es2022" },
  worker: { format: "es" },
  optimizeDeps: {
    // Exclude workspace packages so they are served as raw ESM through Vite's
    // module graph (avoids esbuild pre-bundling, simplifies resolution).
    exclude: ["@bench/loaders", "@bench/harness", "@bench/result-schema"],
  },
  // Map node:fs/promises to a browser-safe stub so that fetchBytes can be
  // imported in a worker without throwing at module evaluation time.
  // fetchBytes only calls readFile for non-http(s) URLs, which never occur
  // in the browser context — all artifact URLs are served over http(s).
  resolve: {
    alias: {
      "node:fs/promises": resolve(__dirname, "src/node-fs-stub.js"),
    },
  },
});
