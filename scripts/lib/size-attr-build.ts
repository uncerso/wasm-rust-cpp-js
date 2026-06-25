import { existsSync } from "node:fs";
import { rm, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { buildComposition, parseTwiggyJson, type CategorizeCtx, type ProductionTotal } from "@bench/size-attr";
import type { SizeComposition } from "@bench/result-schema";
import { run, capture } from "./exec.js";
import { twiggyPath, wasmPackPath } from "./tool-paths.js";
import type { BinaryCombination } from "./matrix.js";

const ATTR_TARGET = "target/attr"; // isolated; never clobbers production target/

// Cargo profile env key: release | release-size -> CARGO_PROFILE_RELEASE_STRIP / _RELEASE_SIZE_STRIP
function stripEnvKey(profile: "release" | "release-size"): string {
    return `CARGO_PROFILE_${profile.toUpperCase().replace(/-/g, "_")}_STRIP`;
}

/** Exported symbol names that count as "observed" for rust/raw (extern "C" surface). */
function rustObservedCtx(c: BinaryCombination): CategorizeCtx {
    return {
        exportNames: new Set([
            "alloc", "load_input", "reset",
            `${c.sourceBench}`, "matmul", "output_ptr", "output_len",
            `${c.sourceBench}_insert`, `${c.sourceBench}_lookup`, `${c.sourceBench}_delete`,
            `${c.sourceBench}_insert_reset`, `${c.sourceBench}_lookup_reset`, `${c.sourceBench}_delete_reset`,
        ]),
        // Bench-name substring catches both `<bench>_<entry>` extern exports (interop_calls_noop)
        // and the mangled crate path `<bench>_rust_raw::…` (shape_dispatch trait-impl/vtable methods),
        // which the narrower `<bench>::` prefix missed (crate name carries the `_rust_raw` suffix).
        workloadPrefixes: [`${c.sourceBench}`, "matmul_shared::", "parse_pairs", "with_slices"],
    };
}

export async function attributeRustRaw(
    c: BinaryCombination,
    productionTotal: ProductionTotal,
): Promise<SizeComposition> {
    const crateDir = `benches/${c.sourceBench}/rust/raw`;
    const profile = c.profile === "speed" ? "release" : "release-size";
    // Name-bearing build into isolated target dir (STRIP=false keeps the name section).
    await run("cargo", ["build", `--profile=${profile}`, "--target=wasm32-unknown-unknown"], {
        cwd: crateDir,
        env: { [stripEnvKey(profile)]: "false", CARGO_TARGET_DIR: resolve(ATTR_TARGET) },
    });
    const wasm = join(ATTR_TARGET, "wasm32-unknown-unknown", profile, `${c.sourceBench}_rust_raw.wasm`);
    const json = await capture(twiggyPath(), ["top", "-f", "json", "-n", "1000", wasm]);
    const rows = parseTwiggyJson(json);
    return buildComposition(rows, rustObservedCtx(c), productionTotal);
}

/** Exported symbol names that count as "observed" for rust/bindgen (#[wasm_bindgen] surface). */
function rustBindgenObservedCtx(c: BinaryCombination): CategorizeCtx {
    return {
        exportNames: new Set([
            "alloc", "load_input", "reset", "wasm_memory",
            c.sourceBench, "matmul",
            `${c.sourceBench}_insert`, `${c.sourceBench}_lookup`, `${c.sourceBench}_delete`,
            `${c.sourceBench}_insert_reset`, `${c.sourceBench}_lookup_reset`, `${c.sourceBench}_delete_reset`,
        ]),
        workloadPrefixes: [`${c.sourceBench}`, "matmul_shared::", "parse_pairs", "with_slices"],
    };
}

export async function attributeRustBindgen(
    c: BinaryCombination,
    productionTotal: ProductionTotal,
): Promise<SizeComposition | null> {
    const crateDir = `benches/${c.sourceBench}/rust/bindgen`;
    const pkgDir = join(crateDir, "pkg-attr");
    await rm(pkgDir, { recursive: true, force: true });
    // Name-bearing: STRIP=false keeps the wasm name section for both profiles.
    // Production uses --release for both speed and size (size profile differs only by a
    // post-build wasm-opt -Oz step). We mirror production: --release + STRIP=false.
    // wasm-pack's internal wasm-opt is disabled via Cargo metadata (wasm-opt = false),
    // so the _bg.wasm is pre-opt + named — suitable for twiggy attribution.
    await run(wasmPackPath(), ["build", "--target=web", "--release", "--out-dir=pkg-attr"], {
        cwd: crateDir,
        env: { CARGO_PROFILE_RELEASE_STRIP: "false" },
    });
    const files = await readdir(pkgDir);
    const wasmFile = files.find((f) => f.endsWith("_bg.wasm"));
    if (!wasmFile) {
        return null;
    }
    const wasm = join(pkgDir, wasmFile);
    const json = await capture(twiggyPath(), ["top", "-f", "json", "-n", "1000", wasm]);
    const rows = parseTwiggyJson(json);
    const composition = buildComposition(rows, rustBindgenObservedCtx(c), productionTotal);
    if (composition.unattributedShare > 0.5) {
        console.warn(`[size-attr] ${c.sourceBench} ${c.toolchain}/${c.profile}: bindgen attribution unusable (unattributed ${(composition.unattributedShare * 100).toFixed(1)}%); writing null.`);
        return null;
    }
    return composition;
}

/** Exported symbol names that count as "observed" for cpp (extern "C" surface). twiggy auto-demangles C++. */
function cppObservedCtx(c: BinaryCombination): CategorizeCtx {
    return {
        exportNames: new Set([
            "alloc", "load_input", "reset",
            `${c.sourceBench}`, "matmul", "output_ptr", "output_len",
            `${c.sourceBench}_insert`, `${c.sourceBench}_lookup`, `${c.sourceBench}_delete`,
            `${c.sourceBench}_insert_reset`, `${c.sourceBench}_lookup_reset`, `${c.sourceBench}_delete_reset`,
        ]),
        workloadPrefixes: ["parse_pairs", "(anonymous namespace)", "::state(", "::State"],
    };
}

export async function attributeWasiSdk(
    c: BinaryCombination,
    attrDir: string,
    productionTotal: ProductionTotal,
): Promise<SizeComposition | null> {
    const named = join(attrDir, "module.attr.wasm");
    if (!existsSync(named)) {
        return null; // name-bearing output absent (e.g. build script not yet SIZE_ATTR-aware)
    }
    const json = await capture(twiggyPath(), ["top", "-f", "json", "-n", "1000", named]);
    const rows = parseTwiggyJson(json);
    const composition = buildComposition(rows, cppObservedCtx(c), productionTotal);
    // Guard against the cpp/wasi-sdk name-section heisenbug: when build-wasi-sdk.sh emits
    // module.attr.wasm with anonymous code[N] (no usable "function names" subsection), nearly
    // everything falls to `unattributed`. Rather than ship a meaningless ~98%-unattributed
    // composition, degrade to section-only (null). See docs/superpowers/bug-reports.
    if (composition.unattributedShare > 0.5) {
        console.warn(
            `[size-attr] ${c.sourceBench} ${c.toolchain}/${c.profile}: attribution unusable `
            + `(unattributed ${(composition.unattributedShare * 100).toFixed(1)}% — name section not read); `
            + "writing composition: null.",
        );
        return null;
    }
    return composition;
}
