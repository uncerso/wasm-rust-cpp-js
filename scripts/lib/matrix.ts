import type { Language, Toolchain, Profile, InputSize, Spec } from "@bench/result-schema";

// ─── new API (multi-bench + multi-entry) ─────────────────────────────────

/** A binary artifact: one (sourceBench, lang, toolchain, profile) build unit. */
export interface BinaryCombination {
    sourceBench: string;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
}

/** A measurement case: a binary × entry × size × env. */
export interface RunCase extends BinaryCombination {
    entry: string;
    inputSize: InputSize;
    env: "node" | "browser-chromium" | "browser-firefox";
}

export function distDirFor(b: BinaryCombination): string {
    return `dist/${b.sourceBench}/${b.language}-${b.toolchain}-${b.profile}`;
}

/** Per-spec binary expansion: cross product of supported langs × toolchains × profiles. */
export function enumerateBinaries(spec: Spec): BinaryCombination[] {
    const out: BinaryCombination[] = [];
    if (!spec.supported) {
        throw new Error(`spec ${spec.id} has no .supported block`);
    }
    for (const lang of spec.supported.languages) {
        const toolchains = spec.supported.toolchains[lang] ?? [];
        for (const tc of toolchains) {
            for (const p of spec.supported.profiles) {
                out.push({ sourceBench: spec.id, language: lang, toolchain: tc, profile: p });
            }
        }
    }
    return out;
}

/** Per-spec run-case expansion: binaries × entries × sizes × envs. */
export function enumerateRunCases(
    spec: Spec,
    sizes: readonly InputSize[],
    envs: readonly RunCase["env"][],
): RunCase[] {
    const out: RunCase[] = [];
    for (const bin of enumerateBinaries(spec)) {
        for (const entry of spec.entries) {
            for (const sz of sizes) {
                for (const env of envs) {
                    out.push({ ...bin, entry, inputSize: sz, env });
                }
            }
        }
    }
    return out;
}

