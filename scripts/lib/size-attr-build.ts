import { resolve, join } from "node:path";
import { buildComposition, parseTwiggyJson, type CategorizeCtx, type ProductionTotal } from "@bench/size-attr";
import type { SizeComposition } from "@bench/result-schema";
import { run, capture } from "./exec.js";
import { twiggyPath } from "./tool-paths.js";
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
        workloadPrefixes: [`${c.sourceBench}::`, "matmul_shared::", "parse_pairs", "with_slices"],
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
