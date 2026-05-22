import { computeStats, runMeasure, type MeasureConfig } from "@bench/harness";
import {
    plainJsLoader,
    rawWasmLoader,
    rustBindgenLoader,
    emscriptenLoader,
    type Loader,
} from "@bench/loaders";
import {
    BenchResultSchema,
    SCHEMA_VERSION,
    type BenchResult,
    type Language,
    type Toolchain,
    type Profile,
    type InputSize,
} from "@bench/result-schema";

// NOTE D: declare worker scope properly
declare const self: DedicatedWorkerGlobalScope;

// NOTE E: define ArtifactMetaFile interface mirroring run-case.ts
interface ArtifactStat {
    rawBytes: number;
    gzipBytes: number;
    brotliBytes: number;
    hashSha256: string;
}

interface ArtifactMetaFile {
    combination: { benchmarkId: string; language: string; toolchain: string; profile: string };
    wasm: ArtifactStat | null;
    jsGlue: ArtifactStat | null;
    jsModule: ArtifactStat | null;
    totalTransferGzipBytes: number;
    toolchainVersions: Record<string, string>;
}

export interface WorkerInput {
    benchmarkId: string;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
    inputSize: InputSize;
    fixtureSha256: string;
    expectedChecksum: number | string;
    measureConfig: MeasureConfig;
    baseUrl: string; // e.g. "http://localhost:5174"
    debugTimings?: boolean; // Wave 4: propagate BENCH_DEBUG_TIMINGS into worker scope
}

function pickLoader(lang: Language, tc: Toolchain): Loader {
    if (lang === "js") {
        return plainJsLoader;
    }
    if (lang === "rust" && tc === "raw") {
        return rawWasmLoader;
    }
    if (lang === "rust" && tc === "bindgen") {
        return rustBindgenLoader;
    }
    if (lang === "cpp" && tc === "emscripten") {
        return emscriptenLoader;
    }
    if (lang === "cpp" && tc === "wasi-sdk") {
        return rawWasmLoader;
    }
    throw new Error(`no loader for ${lang}/${tc}`);
}

// NOTE B: prefix hash with sha256: and reject empty
function asSha256Prefixed(hash: string | undefined): string {
    if (!hash) {
        return "";
    }
    return hash.startsWith("sha256:") ? hash : `sha256:${hash}`;
}

self.onmessage = async (evt: MessageEvent<WorkerInput>) => {
    const i = evt.data;
    // Wave 4: propagate debug flag into worker's globalThis so runMeasure can read it
    if (i.debugTimings) {
        (globalThis as { __BENCH_DEBUG_TIMINGS__?: boolean }).__BENCH_DEBUG_TIMINGS__ = true;
    }
    try {
        const distBase = `${i.baseUrl}/${i.benchmarkId}/${i.language}-${i.toolchain}-${i.profile}`;

        // Fetch meta.json
        const metaRes = await fetch(`${distBase}/meta.json`);
        if (!metaRes.ok) {
            throw new Error(`meta.json fetch failed: ${metaRes.status}`);
        }
        const meta = (await metaRes.json()) as ArtifactMetaFile;

        const loader = pickLoader(i.language, i.toolchain);

        const loaderInput: { artifactUrl: string; glueUrl?: string; entry: string } = (() => {
            // Entry == benchmarkId until --entry flag lands (Task 12).
            const entry = i.benchmarkId;
            if (i.language === "js") {
                return { artifactUrl: `${distBase}/module.js`, entry };
            }
            if (i.toolchain === "bindgen") {
                return {
                    artifactUrl: `${distBase}/module.wasm`,
                    glueUrl: `${distBase}/glue.js`,
                    entry,
                };
            }
            if (i.toolchain === "emscripten") {
                return {
                    artifactUrl: `${distBase}/glue.wasm`,
                    glueUrl: `${distBase}/glue.mjs`,
                    entry,
                };
            }
            return { artifactUrl: `${distBase}/module.wasm`, entry };
        })();

        const loaded = await loader.load(loaderInput);

        // Fetch fixture
        const fixtureUrl = `${i.baseUrl}/${i.benchmarkId}/fixtures/${i.inputSize.toLowerCase()}.bin`;
        const fixtureRes = await fetch(fixtureUrl);
        if (!fixtureRes.ok) {
            throw new Error(`fixture fetch failed: ${fixtureRes.status}`);
        }
        const fixture = new Uint8Array(await fixtureRes.arrayBuffer());

        const memBefore = loaded.memoryRef?.buffer.byteLength ?? 0;
        const measure = await runMeasure({
            module: loaded.module,
            fixture,
            expectedChecksum: i.expectedChecksum,
            config: i.measureConfig,
        });
        const memAfter = loaded.memoryRef?.buffer.byteLength ?? 0;

        const stats = measure.warmSamplesMs.length > 0
            ? computeStats(measure.warmSamplesMs)
            : { median: 0, p95: 0, p99: 0, stddev: 0, min: 0, max: 0, mean: 0, cv: 0, n: 0 };

        // NOTE A: derive postprocess from profile/language, not from toolchainVersions
        const ranWasmOpt =
            i.profile === "size" && (i.language === "rust" || i.language === "cpp");

        const artifactHashRaw = meta.wasm?.hashSha256 ?? meta.jsModule?.hashSha256;

        // Browser env info via navigator
        const ua = navigator.userAgent;
        // Detect browser name/version from UA (best-effort)
        const browserMatch = ua.match(/(?:Chrome|Firefox|Safari)\/([0-9.]+)/);
        const browserVersion = browserMatch?.[1] ?? "unknown";
        const browserName = ua.includes("Firefox") ? "firefox"
            : ua.includes("Chrome") ? "chromium"
                : "safari";

        const result: BenchResult = {
            schemaVersion: SCHEMA_VERSION,
            timestamp: new Date().toISOString(),
            machine: {
                os: navigator.platform || "browser",
                cpu: "unknown",
                memoryGb: Math.max(
                    1,
                    // navigator.deviceMemory is a non-standard API
                    Math.round(
                        ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 1),
                    ),
                ),
            },
            env: {
                kind: "browser",
                name: browserName,
                version: browserVersion,
                engine: ua.includes("Firefox") ? "SpiderMonkey" : "V8",
            },
            benchmark: {
                id: i.benchmarkId,
                inputSize: i.inputSize,
                fixtureBytes: fixture.byteLength,
                fixtureSha256: i.fixtureSha256,
                language: i.language,
                toolchain: i.toolchain,
                profile: i.profile,
                postprocess: ranWasmOpt ? ["wasm-opt"] : [],
            },
            artifacts: {
                wasmRawBytes: meta.wasm?.rawBytes ?? 0,
                wasmGzipBytes: meta.wasm?.gzipBytes ?? 0,
                wasmBrotliBytes: meta.wasm?.brotliBytes ?? 0,
                jsGlueRawBytes: meta.jsGlue?.rawBytes ?? 0,
                jsGlueGzipBytes: meta.jsGlue?.gzipBytes ?? 0,
                totalTransferGzipBytes: meta.totalTransferGzipBytes ?? 0,
                // NOTE B: prefix with sha256:
                artifactHash: asSha256Prefixed(artifactHashRaw),
            },
            timingsMs: {
                fetch: loaded.timings.fetchMs,
                compile: loaded.timings.compileMs,
                instantiate: loaded.timings.instantiateMs,
                initTotal: loaded.timings.initTotalMs,
                firstCall: measure.firstCallMs,
                warmMedian: stats.median,
                warmP95: stats.p95,
                warmP99: stats.p99,
                warmStddev: stats.stddev,
                warmMin: stats.min,
                warmMax: stats.max,
                endToEndMedian: loaded.timings.initTotalMs + measure.firstCallMs + stats.median,
            },
            memory: {
                wasmMemoryBytesPeak: memAfter,
                wasmMemoryDeltaBytes: memAfter - memBefore,
                jsHeapUsedAfter: null, // not accessible in browser workers
            },
            stats: {
                // NOTE C: clamp nSamples to at least 1
                nSamples: Math.max(stats.n, 1),
                cv: stats.cv,
                noisy: stats.cv > i.measureConfig.cvThreshold,
            },
            quality: {
                checksum: measure.finalChecksum,
                validated: !measure.correctnessFailed,
                correctnessFailed: measure.correctnessFailed,
            },
            notes: {
                streamingInstantiation: false,
                worker: true,
                wasmFeatures: ["bulk-memory", "sign-ext"],
            },
        };

        const parsed = BenchResultSchema.parse(result);
        self.postMessage({ ok: true, result: parsed });
    } catch (err) {
        self.postMessage({ ok: false, error: String(err) });
    }
};
