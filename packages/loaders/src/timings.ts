import type { InitTimings } from "@bench/harness";

export class TimingRecorder {
  private fetchMs = 0;
  private compileMs = 0;
  private instantiateMs = 0;
  private readonly start = performance.now();

  recordFetch(t: number) { this.fetchMs = t; }
  recordCompile(t: number) { this.compileMs = t; }
  recordInstantiate(t: number) { this.instantiateMs = t; }

  finalize(): InitTimings {
    return {
      fetchMs: this.fetchMs,
      compileMs: this.compileMs,
      instantiateMs: this.instantiateMs,
      initTotalMs: performance.now() - this.start,
    };
  }
}

export async function timed<T>(fn: () => Promise<T> | T): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
}
