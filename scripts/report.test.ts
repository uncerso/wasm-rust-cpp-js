import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArtifactMeta } from "@bench/result-schema";

const reportScript = fileURLToPath(new URL("./report.ts", import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function metadata(): ArtifactMeta {
    return {
        combination: { benchmarkId: "hashmap_int", language: "rust", toolchain: "bindgen", profile: "size" },
        wasm: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450, hashSha256: "a".repeat(64) },
        jsGlue: { rawBytes: 200, gzipBytes: 100, brotliBytes: 90, hashSha256: "b".repeat(64) },
        jsModule: null,
        totalTransferGzipBytes: 600,
        toolchainVersions: { rustc: "1.95.0", node: "v22" },
        composition: {
            source: "pre-opt-twiggy",
            productionTotal: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 450 },
            preOptTotalBytes: 1000, calibrationFactor: 1, unattributedShare: 0,
            facilities: [{ facility: "observed", scaling: "observed", share: 1, approxBytes: 1000 }],
        },
    };
}

function result() {
    return {
        schemaVersion: 3,
        timestamp: "2026-10-09T00:00:00.000Z",
        machine: { os: "linux", cpu: "test", memoryGb: 8 },
        env: { kind: "node", name: "node", version: "v22", engine: "V8", parallel: false },
        benchmark: {
            id: "hashmap_int_lookup", inputSize: "S", fixtureBytes: 0, fixtureSha256: "c".repeat(64),
            language: "rust", toolchain: "bindgen", profile: "size", postprocess: ["wasm-opt"],
        },
        artifacts: metadata(),
        timingsMs: {
            fetch: 1, compile: 1, instantiate: 1, initTotal: 3, firstCall: 1,
            warmMedian: 1.234, warmP95: 1.5, warmP99: 1.7, warmStddev: 0.05,
            warmMin: 1, warmMax: 1.7, warmMad: 0.04, endToEndMedian: 5.234,
        },
        memory: { wasmMemoryBytesPeak: 65536, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
        stats: { nSamples: 30, cv: 0.01, relSem: 0.002, meanImprecise: false, subResolution: false },
        quality: { checksum: 42, validated: true, correctnessFailed: false },
        notes: { streamingInstantiation: false, worker: false, wasmFeatures: [] },
    };
}

describe("report CLI", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "bench-report-"));
        await mkdir(join(dir, "raw"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    async function writeResult(name: string, value: unknown): Promise<void> {
        await writeFile(join(dir, "raw", `${name}.json`), JSON.stringify(value));
    }

    function runReport(...args: string[]) {
        return execa(process.execPath, ["--import", tsx, reportScript, "--in=raw", "--out=html", ...args], {
            cwd: dir,
            reject: false,
        });
    }

    it("renders Size and Perf from saved metadata without dist", async () => {
        await writeResult("one", result());
        const run = await runReport();
        expect(run.stderr).toBe("");
        expect(run.exitCode).toBe(0);
        const html = await readFile(join(dir, "html/index.html"), "utf8");
        expect(html).toContain('data-raw="1000"');
        expect(html).toContain('data-raw="200"');
        expect(html).toContain('data-band="glue"');
        expect(html).toContain('data-fac="observed"');
        expect(html).toContain("1.234");
    });

    it("ignores an unrelated current dist", async () => {
        await writeResult("one", result());
        const meta = metadata();
        meta.combination.benchmarkId = "unrelated_build";
        const dist = join(dir, "dist/unrelated_build/rust-bindgen-size");
        await mkdir(dist, { recursive: true });
        await writeFile(join(dist, "meta.json"), JSON.stringify(meta));
        expect((await runReport()).exitCode).toBe(0);
        const html = await readFile(join(dir, "html/index.html"), "utf8");
        expect(html).toContain('data-raw="1000"');
        expect(html).not.toContain("unrelated_build");
    });

    it("deduplicates a binary across entries, sizes and environments regardless of metadata key order", async () => {
        await writeResult("one", result());
        const other = result();
        other.benchmark.id = "hashmap_int_build";
        other.benchmark.inputSize = "M";
        other.env = { ...other.env, kind: "browser", name: "firefox", engine: "SpiderMonkey" };
        other.artifacts.toolchainVersions = { node: "v22", rustc: "1.95.0" };
        await writeResult("two", other);
        expect((await runReport()).exitCode).toBe(0);
        const html = await readFile(join(dir, "html/index.html"), "utf8");
        expect(html.match(/<div class="size-row/g)).toHaveLength(1);
        expect(html).toContain("hashmap_int_lookup");
        expect(html).toContain("hashmap_int_build");
    });

    it.each(["wasm", "jsGlue", "composition"] as const)("rejects conflicting %s metadata before writing HTML", async (field) => {
        await writeResult("one", result());
        const other = result();
        if (field === "composition") {
            other.artifacts.composition = null;
        } else {
            other.artifacts[field]!.hashSha256 = "d".repeat(64);
        }
        await writeResult("two", other);
        const run = await runReport();
        expect(run.exitCode).not.toBe(0);
        expect(run.stderr).toMatch(/conflicting artifact metadata/i);
        await expect(access(join(dir, "html/index.html"))).rejects.toThrow();
    });

    it("rejects old results and incomplete metadata without writing HTML", async () => {
        const old = { ...result(), schemaVersion: 2 };
        await writeResult("one", old);
        expect((await runReport()).exitCode).not.toBe(0);
        const incomplete: Record<string, unknown> = result();
        delete incomplete.artifacts;
        await writeResult("one", incomplete);
        expect((await runReport()).exitCode).not.toBe(0);
        await expect(access(join(dir, "html/index.html"))).rejects.toThrow();
    });

    it("rejects the removed dist override", async () => {
        await writeResult("one", result());
        const run = await runReport("--dist=elsewhere");
        expect(run.exitCode).not.toBe(0);
        expect(run.stderr).toMatch(/--dist.*no longer supported/i);
        await expect(access(join(dir, "html/index.html"))).rejects.toThrow();
    });
});
