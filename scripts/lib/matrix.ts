import type { Language, Toolchain, Profile, InputSize } from "@bench/result-schema";

export interface Combination {
    benchmarkId: string;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
}

export interface RunCombination extends Combination {
    inputSize: InputSize;
    env: "node" | "browser-chromium" | "browser-firefox";
}

export const ALL_COMBINATIONS: Combination[] = [
    // JS
    { benchmarkId: "matmul", language: "js",   toolchain: "idiomatic",   profile: "speed" },
    { benchmarkId: "matmul", language: "js",   toolchain: "typed-array", profile: "speed" },
    // Rust
    { benchmarkId: "matmul", language: "rust", toolchain: "raw",        profile: "speed" },
    { benchmarkId: "matmul", language: "rust", toolchain: "raw",        profile: "size"  },
    { benchmarkId: "matmul", language: "rust", toolchain: "bindgen",    profile: "speed" },
    { benchmarkId: "matmul", language: "rust", toolchain: "bindgen",    profile: "size"  },
    // C++
    { benchmarkId: "matmul", language: "cpp",  toolchain: "emscripten", profile: "speed" },
    { benchmarkId: "matmul", language: "cpp",  toolchain: "emscripten", profile: "size"  },
    { benchmarkId: "matmul", language: "cpp",  toolchain: "wasi-sdk",   profile: "speed" },
    { benchmarkId: "matmul", language: "cpp",  toolchain: "wasi-sdk",   profile: "size"  },
];

export function distDir(c: Combination): string {
    return `dist/${c.benchmarkId}/${c.language}-${c.toolchain}-${c.profile}`;
}
