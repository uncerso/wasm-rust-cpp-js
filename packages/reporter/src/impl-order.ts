// Canonical (language, toolchain) order, taken from spec.json `supported`
// declaration order. Applied to BOTH the perf and size tabs so a given
// toolchain always sits in the same row/segment position — the alternative
// (sorting by measured speed) makes positions jump cell-to-cell.
export const IMPL_ORDER: readonly string[] = [
    "js/idiomatic",
    "js/typed-array",
    "rust/raw",
    "rust/bindgen",
    "cpp/emscripten",
    "cpp/wasi-sdk",
];

export function implOrderRank(language: string, toolchain: string): number {
    const i = IMPL_ORDER.indexOf(`${language}/${toolchain}`);
    return i < 0 ? IMPL_ORDER.length : i;
}
