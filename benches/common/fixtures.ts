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
