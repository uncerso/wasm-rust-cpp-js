export function mulberry32(seed: number): () => number {
    let t = seed >>> 0;
    return () => {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = t;
        r = Math.imul(r ^ (r >>> 15), r | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

export function genF64Array(n: number, seed: number): Uint8Array {
    const rng = mulberry32(seed);
    const total = 2 * n * n;
    const f = new Float64Array(total);
    for (let i = 0; i < total; i++) {
        f[i] = rng() * 2 - 1;
    }
    return new Uint8Array(f.buffer);
}

const HEX = "0123456789abcdef";

export function genAsciiHexKeys(n: number, seed: number): Uint8Array {
    const rng = mulberry32(seed);
    const PAIR_BYTES = 24;
    const out = new Uint8Array(n * PAIR_BYTES);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < n; i++) {
        const base = i * PAIR_BYTES;
        // 16 hex chars: two u32 outputs from rng, each converted to 8 hex digits.
        const r1 = Math.floor(rng() * 0x100000000) >>> 0;
        const r2 = Math.floor(rng() * 0x100000000) >>> 0;
        for (let j = 0; j < 8; j++) {
            out[base + j] = HEX.charCodeAt((r1 >>> ((7 - j) * 4)) & 0xF);
            out[base + 8 + j] = HEX.charCodeAt((r2 >>> ((7 - j) * 4)) & 0xF);
        }
        // value u64 LE, in [0, 2^32).
        const v = Math.floor(rng() * 0x100000000);
        dv.setBigUint64(base + 16, BigInt(v), true);
    }
    return out;
}

export function genIntPairs53(n: number, seed: number): Uint8Array {
    const rng = mulberry32(seed);
    const PAIR_BYTES = 16;
    const out = new Uint8Array(n * PAIR_BYTES);
    const dv = new DataView(out.buffer);
    const TWO_53 = 0x20000000000000;  // 2^53
    const TWO_32 = 0x100000000;       // 2^32
    for (let i = 0; i < n; i++) {
        const k = Math.floor(rng() * TWO_53);   // [0, 2^53)
        const v = Math.floor(rng() * TWO_32);   // [0, 2^32)
        dv.setBigUint64(i * PAIR_BYTES,     BigInt(k), true);
        dv.setBigUint64(i * PAIR_BYTES + 8, BigInt(v), true);
    }
    return out;
}

export function genShapes(n: number, seed: number): Uint8Array {
    const buf = new Uint8Array(n * 24);
    const view = new DataView(buf.buffer);
    const rand = mulberry32(seed);
    for (let i = 0; i < n; i++) {
        const off = i * 24;
        const tag = Math.floor(rand() * 3);  // 0, 1, or 2
        buf[off] = tag;
        // padding bytes [off+1 .. off+8) already zero
        const p1 = 0.5 + rand() * 4.5;
        view.setFloat64(off + 8, p1, true);
        const p2 = tag === 2 ? 0.5 + rand() * 4.5 : 0;  // Triangle uses p2; others ignored
        view.setFloat64(off + 16, p2, true);
    }
    return buf;
}
