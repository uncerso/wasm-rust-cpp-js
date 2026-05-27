import { ShapeKind } from "../../../../common/shape-reference.js";

interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

class TaggedShape {
    constructor(public kind: ShapeKind, public p1: number, public p2: number) {}
}

// Top-level function with the switch inside its body — V8's TurboFan can
// specialize it once. Defining `score` inside `create()` would capture closure
// constants and trigger the V8 12.4 switch-over-closure-const deopt bug
// (see docs/superpowers/bug-reports/2026-05-23-v8-deopt-switch-over-closure-const.md).
function score(s: TaggedShape): number {
    let a: number;
    let p: number;
    switch (s.kind) {
        case ShapeKind.Circle:
            a = Math.PI * s.p1 * s.p1;
            p = 2 * Math.PI * s.p1;
            break;
        case ShapeKind.Square:
            a = s.p1 * s.p1;
            p = 4 * s.p1;
            break;
        case ShapeKind.Triangle:
            a = 0.5 * s.p1 * s.p2;
            p = s.p1 + s.p2 + Math.sqrt(s.p1 * s.p1 + s.p2 * s.p2);
            break;
        default:
            a = 0;
            p = 0;
    }
    return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
}

export default function create(entry: string): BenchModule {
    if (entry !== "shape_dispatch_mixed_static") {
        throw new Error(`shape_dispatch_mixed_static/js-idiomatic: unknown entry "${entry}"`);
    }

    let shapes: TaggedShape[] = [];

    return {
        loadInput(buf: Uint8Array): void {
            const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
            const n = buf.length / 24;
            const next: TaggedShape[] = [];
            next.length = n;
            for (let i = 0; i < n; i++) {
                const off = i * 24;
                const kind = buf[off] as ShapeKind;
                const p1 = view.getFloat64(off + 8, true);
                const p2 = view.getFloat64(off + 16, true);
                next[i] = new TaggedShape(kind, p1, p2);
            }
            shapes = next;
        },

        run(_iterations: number): { checksum: number } {
            let acc = 0n;
            const mask = (1n << 64n) - 1n;
            for (const s of shapes) {
                acc = (acc + BigInt(Math.round(score(s) * 1e6))) & mask;
            }
            return { checksum: Number(acc) };
        },

        reset(): void {},
    };
}
