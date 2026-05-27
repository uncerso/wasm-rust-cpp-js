import { ShapeKind } from "../../../../common/shape-reference.js";

interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

class Circle {
    constructor(public r: number) {}
    score(): number {
        const a = Math.PI * this.r * this.r;
        const p = 2 * Math.PI * this.r;
        return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
    }
}

class Square {
    constructor(public s: number) {}
    score(): number {
        const a = this.s * this.s;
        const p = 4 * this.s;
        return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
    }
}

class Triangle {
    constructor(public b: number, public h: number) {}
    score(): number {
        const a = 0.5 * this.b * this.h;
        const p = this.b + this.h + Math.sqrt(this.b * this.b + this.h * this.h);
        return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
    }
}

export default function create(entry: string): BenchModule {
    if (entry !== "shape_dispatch_homo_dyn") {
        throw new Error(`shape_dispatch_homo_dyn/js-idiomatic: unknown entry "${entry}"`);
    }

    let circles: Circle[] = [];
    let squares: Square[] = [];
    let triangles: Triangle[] = [];

    return {
        loadInput(buf: Uint8Array): void {
            const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
            const n = buf.length / 24;
            const cs: Circle[] = [];
            const sqs: Square[] = [];
            const ts: Triangle[] = [];
            for (let i = 0; i < n; i++) {
                const off = i * 24;
                const tag = buf[off] as ShapeKind;
                const p1 = view.getFloat64(off + 8, true);
                const p2 = view.getFloat64(off + 16, true);
                switch (tag) {
                    case ShapeKind.Circle:
                        cs.push(new Circle(p1));
                        break;
                    case ShapeKind.Square:
                        sqs.push(new Square(p1));
                        break;
                    case ShapeKind.Triangle:
                        ts.push(new Triangle(p1, p2));
                        break;
                    default:
                        throw new Error(`shape_dispatch_homo_dyn/js-idiomatic: unknown tag ${String(tag)}`);
                }
            }
            circles = cs;
            squares = sqs;
            triangles = ts;
        },

        run(_iterations: number): { checksum: number } {
            let acc = 0n;
            const mask = (1n << 64n) - 1n;
            for (const c of circles) {
                acc = (acc + BigInt(Math.round(c.score() * 1e6))) & mask;
            }
            for (const sq of squares) {
                acc = (acc + BigInt(Math.round(sq.score() * 1e6))) & mask;
            }
            for (const t of triangles) {
                acc = (acc + BigInt(Math.round(t.score() * 1e6))) & mask;
            }
            return { checksum: Number(acc) };
        },

        reset(): void {},
    };
}
