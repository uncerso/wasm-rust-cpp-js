// Mandelbrot has seven scalar input parameters and one scalar checksum, so
// there is no array representation axis: this is the sole JS variant.
interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): { checksum: number };
    reset(): void;
}

export default function create(entry: string): BenchModule {
    if (entry !== "mandelbrot") {
        throw new Error(`mandelbrot/js-idiomatic: unknown entry "${entry}"`);
    }
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    let dimsX = 0;
    let dimsY = 0;
    let maxIter = 0;

    return {
        loadInput(input: Uint8Array) {
            const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
            minX = dv.getFloat64(0, true);
            maxX = dv.getFloat64(8, true);
            minY = dv.getFloat64(16, true);
            maxY = dv.getFloat64(24, true);
            dimsX = dv.getFloat64(32, true);
            dimsY = dv.getFloat64(40, true);
            maxIter = dv.getFloat64(48, true);
        },

        run(iterations: number): { checksum: number } {
            const stepX = (maxX - minX) / dimsX;
            const stepY = (maxY - minY) / dimsY;
            let last = 0;
            for (let it = 0; it < iterations; it++) {
                let acc = 0;
                for (let py = 0; py < dimsY; py++) {
                    const cy = minY + py * stepY;
                    for (let px = 0; px < dimsX; px++) {
                        const cx = minX + px * stepX;
                        let zx = 0;
                        let zy = 0;
                        let iter = 0;
                        while (iter < maxIter) {
                            const zx2 = zx * zx;
                            const zy2 = zy * zy;
                            if (zx2 + zy2 > 4.0) {
                                break;
                            }
                            zy = 2.0 * zx * zy + cy;
                            zx = zx2 - zy2 + cx;
                            iter++;
                        }
                        acc += iter;
                    }
                }
                last = acc;
            }
            return { checksum: last };
        },
        reset() {},
    };
}
