export enum ShapeKind {
    Circle = 0,
    Square = 1,
    Triangle = 2,
}

export interface Shape {
    kind: ShapeKind;
    p1: number;
    p2: number;
}

export function parseShapes(buf: Uint8Array): Shape[] {
    const n = buf.length / 24;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out: Shape[] = [];
    out.length = n;
    for (let i = 0; i < n; i++) {
        const off = i * 24;
        const kind = buf[off] as ShapeKind;
        const p1 = view.getFloat64(off + 8, true);
        const p2 = view.getFloat64(off + 16, true);
        out[i] = { kind, p1, p2 };
    }
    return out;
}

export function computeScore(s: Shape): number {
    let a = 0;
    let p = 0;
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
    }
    return a * Math.sqrt(p / (a + 1)) + Math.log(a + p + 1);
}

export function checksumQuantized(shapes: Shape[]): bigint {
    let acc = 0n;
    const mask = (1n << 64n) - 1n;
    for (const s of shapes) {
        const score = computeScore(s);
        acc = (acc + BigInt(Math.round(score * 1e6))) & mask;
    }
    return acc;
}
