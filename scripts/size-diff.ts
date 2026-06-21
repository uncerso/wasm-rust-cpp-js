import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./lib/exec.js";
import { statArtifact } from "./lib/meta.js";
import { wasmOptPath } from "./lib/tool-paths.js";

const DIFF_TARGET = "target/diff"; // isolated; never clobbers production target/
const PROFILE = "release-size";    // matches `pnpm build:rust` size profile

interface Sized { rawBytes: number; gzipBytes: number; brotliBytes: number; }

/** Build a workspace crate for wasm32, run the production wasm-opt -Oz pipeline, measure. */
async function buildAndMeasure(crateDir: string, artifactStem: string): Promise<Sized> {
    await run("cargo", ["build", `--profile=${PROFILE}`, "--target=wasm32-unknown-unknown"], {
        cwd: crateDir,
        env: { CARGO_TARGET_DIR: join(process.cwd(), DIFF_TARGET) },
    });
    const built = join(DIFF_TARGET, "wasm32-unknown-unknown", PROFILE, `${artifactStem}.wasm`);
    const opt = join(DIFF_TARGET, `${artifactStem}.opt.wasm`);
    await copyFile(built, opt);
    await run(wasmOptPath(), ["-Oz", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", opt, "-o", opt]);
    return statArtifact(opt);
}

function row(label: string, s: Sized): string {
    return `${label.padEnd(34)} raw=${String(s.rawBytes).padStart(6)}  gz=${String(s.gzipBytes).padStart(6)}  br=${String(s.brotliBytes).padStart(6)}`;
}

function delta(label: string, hi: Sized, lo: Sized): string {
    const d = (a: number, b: number): string => String(a - b).padStart(6);
    return `${label.padEnd(34)} raw=${d(hi.rawBytes, lo.rawBytes)}  gz=${d(hi.gzipBytes, lo.gzipBytes)}  br=${d(hi.brotliBytes, lo.brotliBytes)}`;
}

async function main(): Promise<void> {
    await mkdir(DIFF_TARGET, { recursive: true });

    const bare = await buildAndMeasure("benches/_diff/rust/d_bare", "d_bare");
    const alloc = await buildAndMeasure("benches/_diff/rust/d_alloc", "d_alloc");
    const map1 = await buildAndMeasure("benches/_diff/rust/d_map1", "d_map1");
    const map8 = await buildAndMeasure("benches/_diff/rust/d_map8", "d_map8");

    // Monomorphisation premium: existing production crates (static = N monomorphised copies, dyn = vtable).
    const stat = await buildAndMeasure("benches/shape_dispatch_homo_static/rust/raw", "shape_dispatch_homo_static_rust_raw");
    const dyn = await buildAndMeasure("benches/shape_dispatch_homo_dyn/rust/raw", "shape_dispatch_homo_dyn_rust_raw");

    console.log("\n=== absolute (rust/raw, -Oz) ===");
    console.log(row("d_bare (std, no heap)", bare));
    console.log(row("d_alloc (+allocator)", alloc));
    console.log(row("d_map1 (+HashMap, 1 use-site)", map1));
    console.log(row("d_map8 (+HashMap, 8 use-sites)", map8));
    console.log(row("shape_dispatch_homo_static", stat));
    console.log(row("shape_dispatch_homo_dyn", dyn));

    console.log("\n=== headline deltas ===");
    console.log(delta("allocator floor   (alloc-bare)", alloc, bare));
    console.log(delta("hash-map machinery (map1-alloc)", map1, alloc));
    console.log(delta("map paid-once     (map8-map1≈0)", map8, map1));
    console.log(delta("monomorph premium (static-dyn)", stat, dyn));
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
