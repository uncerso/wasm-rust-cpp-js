// Mock multi-entry bench: factory takes entry and returns a BenchModule whose
// run output depends on the entry id. Used by plainJsLoader multi-entry test.
export default function create(entry) {
    if (entry === "alpha") {
        return {
            loadInput(_buf) {},
            run(iters) { return { checksum: iters * 2 }; },
        };
    }
    if (entry === "beta") {
        return {
            loadInput(_buf) {},
            run(iters) { return { checksum: iters * 3 }; },
        };
    }
    throw new Error(`unknown entry: ${entry}`);
}
