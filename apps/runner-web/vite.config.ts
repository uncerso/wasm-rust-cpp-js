import { defineConfig, type PluginOption } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sirv from "sirv";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function servePublicDirInPreview(publicDirPath: string): PluginOption {
    return {
        name: "serve-public-dir-in-preview",
        configurePreviewServer(server) {
            server.middlewares.use(sirv(publicDirPath, { dev: true, etag: true }));
        },
    };
}

export default defineConfig({
    root: __dirname,
    publicDir: resolve(__dirname, "../../dist"),
    plugins: [servePublicDirInPreview(resolve(__dirname, "../../dist"))],
    server: {
        port: 5174,
        fs: { allow: [resolve(__dirname, "../..")] },
        // Wave 4: enable cross-origin isolation so high-resolution performance.now()
        // is available in the browser (Chromium 100µs → ~5µs; Firefox 1ms → ~5µs).
        // All artifacts are served same-origin via publicDir, so require-corp is fine.
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
    },
    preview: {
        port: 5174,
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
    },
    build: {
        target: "es2022",
        outDir: resolve(__dirname, "dist"),
        copyPublicDir: false,
        emptyOutDir: true,
    },
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
            "node:fs/promises": resolve(__dirname, "src/node-fs-stub.ts"),
        },
    },
});
