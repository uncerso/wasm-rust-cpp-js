import type { Language, Profile, Toolchain, InputSize } from "@bench/result-schema";

export interface BenchModule {
    loadInput(input: Uint8Array): void;
    run(iterations: number): RunResult;
    reset?(): void;
    dispose?(): void;
}

export interface RunResult {
    checksum: number | string;
    logicalOps?: number;
}

export interface InitTimings {
    fetchMs: number;
    compileMs: number;
    instantiateMs: number;
    initTotalMs: number;
}

export interface MeasureConfig {
    warmupIterations: number;
    innerIterations: number;
    minSamples: number;
    maxSamples: number;
    semThreshold: number;
    wallBudgetMs: number;
}

export interface MeasureInput {
    module: BenchModule;
    fixture: Uint8Array;
    expectedChecksum: number | string;
    config: MeasureConfig;
}

export interface MeasureOutput {
    firstCallMs: number;
    warmSamplesMs: number[];
    finalChecksum: number | string;
    correctnessFailed: boolean;
}

export interface CaseDescriptor {
    benchmarkId: string;
    inputSize: InputSize;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
}
