import { readFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { computeStats, runMeasure, type MeasureConfig } from "@bench/harness";
import {
    plainJsLoader, rawWasmLoader, rustBindgenLoader, emscriptenLoader, type Loader,
} from "@bench/loaders";
import {
    BenchResultSchema, SCHEMA_VERSION,
    type BenchResult, type Toolchain, type Profile, type Language, type InputSize,
} from "@bench/result-schema";

interface RunCaseInput {
    benchmarkId: string;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
    inputSize: InputSize;
    measureConfig: MeasureConfig;
}

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

interface SpecSizeEntry {
    fixtureSha256: string;
    expectedChecksum: number | string;
}

interface SpecFile {
    inputSizes: Record<InputSize, SpecSizeEntry>;
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

function asSha256Prefixed(hash: string | undefined): string {
    if (!hash) {
        return "";
    }
    return hash.startsWith("sha256:") ? hash : `sha256:${hash}`;
}

export async function runCase(input: RunCaseInput): Promise<BenchResult> {
    const distRoot = resolve(`dist/${input.benchmarkId}/${input.language}-${input.toolchain}-${input.profile}`);
    const meta = JSON.parse(await readFile(join(distRoot, "meta.json"), "utf8")) as ArtifactMetaFile;

    const loader = pickLoader(input.language, input.toolchain);
    const loaderInput: { artifactUrl: string; glueUrl?: string } = (() => {
        if (input.language === "js") {
            return { artifactUrl: pathToFileURL(join(distRoot, "module.js")).href };
        }
        if (input.toolchain === "bindgen") {
            return {
                artifactUrl: pathToFileURL(join(distRoot, "module.wasm")).href,
                glueUrl: pathToFileURL(join(distRoot, "glue.js")).href,
            };
        }
        if (input.toolchain === "emscripten") {
            // Emscripten loader uses only glueUrl; the wasm filename is hardcoded by
            // emcc in glue.mjs. artifactUrl is required by the type but unused.
            return {
                artifactUrl: pathToFileURL(join(distRoot, "glue.wasm")).href,
                glueUrl: pathToFileURL(join(distRoot, "glue.mjs")).href,
            };
        }
        return { artifactUrl: join(distRoot, "module.wasm") }; // raw-wasm reads via fs
    })();

    const loaded = await loader.load(loaderInput);

    const specPath = resolve(`benches/${input.benchmarkId}/spec.json`);
    const spec = JSON.parse(await readFile(specPath, "utf8")) as SpecFile;
    const sizeSpec = spec.inputSizes[input.inputSize];
    if (!sizeSpec) {
        throw new Error(`spec missing inputSize ${input.inputSize}`);
    }
    const fixturePath = resolve(`benches/${input.benchmarkId}/fixtures/${input.inputSize.toLowerCase()}.bin`);
    const fixture = new Uint8Array(await readFile(fixturePath));

    const memBefore = loaded.memoryRef?.buffer.byteLength ?? 0;
    const measure = await runMeasure({
        module: loaded.module,
        fixture,
        expectedChecksum: sizeSpec.expectedChecksum,
        config: input.measureConfig,
    });
    const memAfter = loaded.memoryRef?.buffer.byteLength ?? 0;

    const stats = measure.warmSamplesMs.length > 0
        ? computeStats(measure.warmSamplesMs)
        : { median: 0, p95: 0, p99: 0, stddev: 0, min: 0, max: 0, mean: 0, cv: 0, n: 0 };

    // Whether wasm-opt actually ran: only for size profile of rust/cpp.
    const ranWasmOpt =
        input.profile === "size" && (input.language === "rust" || input.language === "cpp");

    const artifactHashRaw = meta.wasm?.hashSha256 ?? meta.jsModule?.hashSha256;

    const result: BenchResult = {
        schemaVersion: SCHEMA_VERSION,
        timestamp: new Date().toISOString(),
        machine: {
            os: `${process.platform} ${process.arch}`,
            cpu: process.env["MACHINE_CPU"] ?? "unknown",
            memoryGb: Math.max(1, Math.round(totalmem() / (1024 ** 3))),
        },
        env: { kind: "node", name: "node", version: process.version, engine: "V8" },
        benchmark: {
            id: input.benchmarkId,
            inputSize: input.inputSize,
            fixtureBytes: fixture.byteLength,
            fixtureSha256: sizeSpec.fixtureSha256,
            language: input.language,
            toolchain: input.toolchain,
            profile: input.profile,
            postprocess: ranWasmOpt ? ["wasm-opt"] : [],
        },
        artifacts: {
            wasmRawBytes: meta.wasm?.rawBytes ?? 0,
            wasmGzipBytes: meta.wasm?.gzipBytes ?? 0,
            wasmBrotliBytes: meta.wasm?.brotliBytes ?? 0,
            jsGlueRawBytes: meta.jsGlue?.rawBytes ?? 0,
            jsGlueGzipBytes: meta.jsGlue?.gzipBytes ?? 0,
            totalTransferGzipBytes: meta.totalTransferGzipBytes ?? 0,
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
            jsHeapUsedAfter: Math.round(process.memoryUsage().heapUsed),
        },
        stats: {
            nSamples: Math.max(stats.n, 1),
            cv: stats.cv,
            noisy: stats.cv > input.measureConfig.cvThreshold,
        },
        quality: {
            checksum: measure.finalChecksum,
            validated: !measure.correctnessFailed,
            correctnessFailed: measure.correctnessFailed,
        },
        notes: { streamingInstantiation: false, worker: false, wasmFeatures: ["bulk-memory", "sign-ext"] },
    };

    return BenchResultSchema.parse(result);
}
