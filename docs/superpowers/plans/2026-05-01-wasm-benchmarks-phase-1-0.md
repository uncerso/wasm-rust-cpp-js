# wasm-rust-cpp-js Phase 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end вертикаль одного workload'а (`matmul`): полная матрица сборки (8 wasm + 2 JS), оба раннера (Node + browser headless), JSON-результаты, статический HTML-отчёт.

**Architecture:** Monorepo на pnpm workspaces. Декларативные workload'ы (`benches/<id>/spec.json`). Изолированные пакеты `harness` / `loaders` / `result-schema` / `reporter`. Два приложения-раннера (`apps/runner-node`, `apps/runner-web`). Скрипты сборки и оркестрации в `scripts/` запускаются через `tsx`.

**Tech Stack:**
- Node 22 LTS, pnpm 9, TypeScript 5.6+, ESM-only
- Тесты: vitest 3
- Скрипты: tsx 4, execa 9
- Web-runner: Vite 6, Playwright 1.5+ (Chromium + Firefox)
- Schemas: zod 3
- Wasm-сборка: Rust 1.85 (`wasm32-unknown-unknown`, `wasm-pack 0.13`), Emscripten 4.0+, wasi-sdk 25, binaryen `wasm-opt`

**Источник правды по дизайну:** `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` (commit `270b5f8`).

---

## File Structure

```
wasm-rust-cpp-js/
├── package.json                          # root workspace, scripts
├── pnpm-workspace.yaml                   # workspace patterns
├── tsconfig.base.json                    # shared TS config
├── tool-versions.json                    # pinned external tool versions
├── rust-toolchain.toml                   # Rust pin
├── .nvmrc                                # node 22
├── .gitignore                            # dist/, results/, node_modules/, target/
├── README.md                             # quick-start
│
├── packages/
│   ├── result-schema/                    # zod schemas + version constant
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/index.ts
│   │   ├── src/schema.ts                 # все zod-схемы JSON-результата
│   │   ├── src/version.ts                # SCHEMA_VERSION = 1
│   │   └── tests/schema.test.ts
│   │
│   ├── harness/                          # измеритель + статистика
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/index.ts
│   │   ├── src/types.ts                  # BenchModule, RunResult, Loader, MeasureConfig
│   │   ├── src/stats.ts                  # median/p95/p99/cv
│   │   ├── src/measure.ts                # runBench()
│   │   ├── src/validation.ts             # checksum validation
│   │   ├── tests/stats.test.ts
│   │   ├── tests/measure.test.ts
│   │   └── tests/validation.test.ts
│   │
│   ├── loaders/                          # one loader per (lang × toolchain)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/index.ts
│   │   ├── src/types.ts                  # Loader, InitTimings
│   │   ├── src/timings.ts                # помощник для замера фаз init
│   │   ├── src/plain-js.ts               # JS modules
│   │   ├── src/raw-wasm.ts               # rust-raw + cpp-wasi-sdk
│   │   ├── src/rust-bindgen.ts           # rust-bindgen
│   │   ├── src/emscripten.ts             # cpp-emscripten
│   │   ├── tests/raw-wasm.test.ts
│   │   ├── tests/plain-js.test.ts
│   │   └── tests/fixtures/hello-bench/   # минимальные тестовые модули
│   │       ├── hello.wasm                # вручную скомпилированный
│   │       ├── hello.js
│   │       └── README.md
│   │
│   └── reporter/                         # JSON → HTML
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/index.ts
│       ├── src/aggregate.ts              # JSON → AggregatedResult
│       ├── src/render.ts                 # AggregatedResult → string HTML
│       ├── src/templates.ts              # HTML строки/фрагменты
│       ├── tests/aggregate.test.ts
│       └── tests/render.test.ts
│
├── apps/
│   ├── runner-node/                      # Node-раннер
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/main.ts                   # CLI entrypoint
│   │   └── src/run-case.ts               # одна комбинация
│   │
│   └── runner-web/                       # browser-раннер через Playwright
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── playwright.config.ts
│       ├── index.html                    # стартовая страница
│       ├── src/page.ts                   # код страницы (грузит worker)
│       ├── src/worker.ts                 # реальный измеритель в Worker
│       └── src/driver.ts                 # Playwright-runner: один CLI-process
│
├── benches/
│   └── matmul/
│       ├── spec.json                     # описание workload'а
│       ├── README.md                     # формат входа/выхода
│       ├── fixtures/
│       │   ├── generate.ts               # детерминированно создает s.bin/m.bin/l.bin
│       │   ├── s.bin                     # 64×64 (после генерации)
│       │   ├── m.bin                     # 256×256
│       │   └── l.bin                     # 1024×1024
│       ├── validate/
│       │   └── reference.ts              # JS reference, генерирует expected checksums
│       ├── js/
│       │   ├── idiomatic/
│       │   │   ├── package.json
│       │   │   ├── tsconfig.json
│       │   │   └── src/index.ts
│       │   └── typed-array/
│       │       ├── package.json
│       │       ├── tsconfig.json
│       │       └── src/index.ts
│       ├── rust/
│       │   ├── raw/
│       │   │   ├── Cargo.toml
│       │   │   └── src/lib.rs
│       │   └── bindgen/
│       │       ├── Cargo.toml
│       │       └── src/lib.rs
│       └── cpp/
│           ├── src/matmul.cpp            # общий source
│           ├── src/matmul.h
│           ├── build-emscripten.sh
│           └── build-wasi-sdk.sh
│
├── scripts/
│   ├── lib/
│   │   ├── matrix.ts                     # перечисление комбинаций
│   │   ├── exec.ts                       # обёртка над execa
│   │   ├── meta.ts                       # запись meta.json + размеров
│   │   └── tool-versions.ts              # чтение tool-versions.json
│   ├── build-rust.ts
│   ├── build-cpp.ts
│   ├── build-js.ts
│   ├── build-all.ts                      # всё вместе по dependency-графу
│   ├── collect-sizes.ts                  # raw/gzip/brotli + sha256
│   ├── generate-fixtures.ts              # вызывает benches/*/fixtures/generate.ts
│   ├── run-matrix.ts                     # обходит матрицу, дёргает раннеры
│   └── smoke.ts                          # быстрый s-size прогон matmul
│
├── dist/                                 # gitignored, итог сборки
│   └── matmul/<lang>-<toolchain>-<profile>/
│       ├── module.wasm                   # для wasm-вариантов
│       ├── glue.js                       # для wasm-bindgen/emscripten
│       ├── module.js                     # для JS
│       └── meta.json
│
└── results/                              # gitignored
    ├── raw/<timestamp>/                  # *.json
    └── summarized/<timestamp>/index.html
```

---

## Tasks

### Task 1: Bootstrap pnpm workspace and TS config

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `rust-toolchain.toml`
- Create: `tool-versions.json`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "wasm-rust-cpp-js",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": { "node": ">=22.0.0", "pnpm": ">=9.0.0" },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r --parallel test",
    "build:js": "tsx scripts/build-js.ts",
    "build:rust": "tsx scripts/build-rust.ts",
    "build:cpp": "tsx scripts/build-cpp.ts",
    "build:all": "tsx scripts/build-all.ts",
    "collect-sizes": "tsx scripts/collect-sizes.ts",
    "generate-fixtures": "tsx scripts/generate-fixtures.ts",
    "smoke": "tsx scripts/smoke.ts",
    "bench": "tsx scripts/run-matrix.ts",
    "bench:all": "pnpm build:all && pnpm bench --mode=eval && pnpm report"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.3",
    "execa": "^9.5.0",
    "vitest": "^3.0.0",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
  - "benches/matmul/js/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
results/
target/                                 # rust
.cache/
*.tsbuildinfo
.DS_Store
benches/matmul/fixtures/*.bin           # генерируются скриптом
```

- [ ] **Step 5: Create `.nvmrc`**

```
22
```

- [ ] **Step 6: Create `rust-toolchain.toml`**

```toml
[toolchain]
channel = "1.85.0"
targets = ["wasm32-unknown-unknown"]
profile = "minimal"
components = ["rustfmt", "clippy"]
```

- [ ] **Step 7: Create `tool-versions.json`**

```json
{
  "comment": "Внешние тулы, не управляемые pnpm. При расхождении версий результаты невоспроизводимы.",
  "rustc": "1.85.0",
  "wasm-pack": "0.13.1",
  "wasi-sdk": "25",
  "emscripten": "4.0.0",
  "wasm-opt": "120",
  "node": "22"
}
```

- [ ] **Step 8: Install dependencies and commit**

Run: `pnpm install`
Expected: lockfile generated, `node_modules` populated, no errors.

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore .nvmrc rust-toolchain.toml tool-versions.json
git commit -m "chore: bootstrap pnpm workspace with pinned toolchain versions"
```

---

### Task 2: `result-schema` package — Zod schemas

**Files:**
- Create: `packages/result-schema/package.json`
- Create: `packages/result-schema/tsconfig.json`
- Create: `packages/result-schema/src/version.ts`
- Create: `packages/result-schema/src/schema.ts`
- Create: `packages/result-schema/src/index.ts`
- Create: `packages/result-schema/tests/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/result-schema/tests/schema.test.ts
import { describe, expect, it } from "vitest";
import { BenchResultSchema, SCHEMA_VERSION } from "../src/index.js";

describe("BenchResultSchema", () => {
  it("accepts a fully-populated valid result", () => {
    const sample = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: "2026-05-01T00:00:00.000Z",
      machine: { os: "macOS 15.4", cpu: "Apple M3 Pro", memoryGb: 36 },
      env: { kind: "browser", name: "Chrome", version: "136.0.0", engine: "V8" },
      benchmark: {
        id: "matmul",
        inputSize: "M",
        fixtureBytes: 524288,
        fixtureSha256: "0000000000000000000000000000000000000000000000000000000000000000",
        language: "rust",
        toolchain: "raw",
        profile: "size",
        postprocess: ["wasm-opt -Oz"],
      },
      artifacts: {
        wasmRawBytes: 12345,
        wasmGzipBytes: 4567,
        wasmBrotliBytes: 4000,
        jsGlueRawBytes: 0,
        jsGlueGzipBytes: 0,
        totalTransferGzipBytes: 4567,
        artifactHash: "sha256:0000",
      },
      timingsMs: {
        fetch: 1.2, compile: 3.4, instantiate: 0.5, initTotal: 5.1,
        firstCall: 1.0,
        warmMedian: 0.8, warmP95: 1.0, warmP99: 1.1,
        warmStddev: 0.05, warmMin: 0.7, warmMax: 1.2,
        endToEndMedian: 6.5,
      },
      memory: { wasmMemoryBytesPeak: 65536, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
      stats: { nSamples: 30, cv: 0.02, noisy: false },
      quality: { checksum: "abc123", validated: true, correctnessFailed: false },
      notes: { streamingInstantiation: false, worker: true, wasmFeatures: ["bulk-memory"] },
    };
    const parsed = BenchResultSchema.parse(sample);
    expect(parsed.schemaVersion).toBe(1);
  });

  it("rejects unknown env.kind", () => {
    expect(() => BenchResultSchema.parse({ env: { kind: "other" } })).toThrow();
  });
});
```

- [ ] **Step 2: Create `packages/result-schema/package.json`**

```json
{
  "name": "@bench/result-schema",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^3.0.0" }
}
```

- [ ] **Step 3: Create `packages/result-schema/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Create `packages/result-schema/src/version.ts`**

```ts
export const SCHEMA_VERSION = 1 as const;
```

- [ ] **Step 5: Create `packages/result-schema/src/schema.ts`**

```ts
import { z } from "zod";
import { SCHEMA_VERSION } from "./version.js";

export const InputSizeSchema = z.enum(["S", "M", "L"]);

export const LanguageSchema = z.enum(["js", "rust", "cpp"]);

export const ToolchainSchema = z.enum([
  "idiomatic",      // js
  "typed-array",    // js
  "raw",            // rust
  "bindgen",        // rust
  "emscripten",     // cpp
  "wasi-sdk",       // cpp
]);

export const ProfileSchema = z.enum(["speed", "size"]);

export const EnvSchema = z.object({
  kind: z.enum(["browser", "node"]),
  name: z.string(),
  version: z.string(),
  engine: z.string(),
});

export const MachineSchema = z.object({
  os: z.string(),
  cpu: z.string(),
  memoryGb: z.number().nonnegative(),
});

export const BenchmarkMetaSchema = z.object({
  id: z.string(),
  inputSize: InputSizeSchema,
  fixtureBytes: z.number().int().nonnegative(),
  fixtureSha256: z.string().length(64),
  language: LanguageSchema,
  toolchain: ToolchainSchema,
  profile: ProfileSchema,
  postprocess: z.array(z.string()),
});

export const ArtifactsSchema = z.object({
  wasmRawBytes: z.number().int().nonnegative(),
  wasmGzipBytes: z.number().int().nonnegative(),
  wasmBrotliBytes: z.number().int().nonnegative(),
  jsGlueRawBytes: z.number().int().nonnegative(),
  jsGlueGzipBytes: z.number().int().nonnegative(),
  totalTransferGzipBytes: z.number().int().nonnegative(),
  artifactHash: z.string(),
});

export const TimingsSchema = z.object({
  fetch: z.number().nonnegative(),
  compile: z.number().nonnegative(),
  instantiate: z.number().nonnegative(),
  initTotal: z.number().nonnegative(),
  firstCall: z.number().nonnegative(),
  warmMedian: z.number().nonnegative(),
  warmP95: z.number().nonnegative(),
  warmP99: z.number().nonnegative(),
  warmStddev: z.number().nonnegative(),
  warmMin: z.number().nonnegative(),
  warmMax: z.number().nonnegative(),
  endToEndMedian: z.number().nonnegative(),
});

export const MemorySchema = z.object({
  wasmMemoryBytesPeak: z.number().int().nonnegative(),
  wasmMemoryDeltaBytes: z.number().int(),
  jsHeapUsedAfter: z.number().int().nullable(),
});

export const StatsSchema = z.object({
  nSamples: z.number().int().positive(),
  cv: z.number().nonnegative(),
  noisy: z.boolean(),
});

export const QualitySchema = z.object({
  checksum: z.union([z.string(), z.number()]),
  validated: z.boolean(),
  correctnessFailed: z.boolean(),
});

export const NotesSchema = z.object({
  streamingInstantiation: z.boolean(),
  worker: z.boolean(),
  wasmFeatures: z.array(z.string()),
});

export const BenchResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  timestamp: z.string().datetime(),
  machine: MachineSchema,
  env: EnvSchema,
  benchmark: BenchmarkMetaSchema,
  artifacts: ArtifactsSchema,
  timingsMs: TimingsSchema,
  memory: MemorySchema,
  stats: StatsSchema,
  quality: QualitySchema,
  notes: NotesSchema,
});

export type BenchResult = z.infer<typeof BenchResultSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type Toolchain = z.infer<typeof ToolchainSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type InputSize = z.infer<typeof InputSizeSchema>;
```

- [ ] **Step 6: Create `packages/result-schema/src/index.ts`**

```ts
export * from "./schema.js";
export * from "./version.js";
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @bench/result-schema test && pnpm --filter @bench/result-schema typecheck`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add packages/result-schema/
git commit -m "feat(schema): add zod schemas for benchmark JSON results"
```

---

### Task 3: `harness` package — types and stats

**Files:**
- Create: `packages/harness/package.json`
- Create: `packages/harness/tsconfig.json`
- Create: `packages/harness/src/types.ts`
- Create: `packages/harness/src/stats.ts`
- Create: `packages/harness/tests/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/harness/tests/stats.test.ts
import { describe, expect, it } from "vitest";
import { computeStats } from "../src/stats.js";

describe("computeStats", () => {
  it("computes median, p95, p99, stddev for known data", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r = computeStats(samples);
    expect(r.median).toBeCloseTo(5.5);
    expect(r.min).toBe(1);
    expect(r.max).toBe(10);
    expect(r.p95).toBeCloseTo(9.55);
    expect(r.stddev).toBeCloseTo(3.028, 2);
    expect(r.cv).toBeCloseTo(3.028 / 5.5, 2);
  });

  it("throws on empty input", () => {
    expect(() => computeStats([])).toThrow();
  });

  it("handles single-element input", () => {
    const r = computeStats([42]);
    expect(r.median).toBe(42);
    expect(r.stddev).toBe(0);
    expect(r.cv).toBe(0);
  });
});
```

- [ ] **Step 2: Create `packages/harness/package.json`**

```json
{
  "name": "@bench/harness",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@bench/result-schema": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^3.0.0" }
}
```

- [ ] **Step 3: Create `packages/harness/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Create `packages/harness/src/types.ts`**

```ts
import type { Language, Profile, Toolchain, InputSize } from "@bench/result-schema";

export interface BenchModule {
  loadInput(input: Uint8Array): void;
  run(iterations: number): RunResult;
  readOutput(): Float64Array | Int32Array | Uint8Array;
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
  warmupIterations: number;       // выбрасываются (≥10 для V8 tier-up)
  innerIterations: number;        // сколько раз внутри одного sample вызвать run()
  minSamples: number;             // минимум sample'ов
  maxSamples: number;             // потолок (если CV>5%)
  cvThreshold: number;            // 0.05 в Phase 1
}

export interface MeasureInput {
  module: BenchModule;
  fixture: Uint8Array;
  expectedChecksum: number | string;
  config: MeasureConfig;
}

export interface MeasureOutput {
  firstCallMs: number;
  warmSamplesMs: number[];        // длиной от minSamples до maxSamples
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
```

- [ ] **Step 5: Create `packages/harness/src/stats.ts`**

```ts
export interface StatsResult {
  median: number;
  p95: number;
  p99: number;
  stddev: number;
  min: number;
  max: number;
  mean: number;
  cv: number;
  n: number;
}

export function computeStats(samples: readonly number[]): StatsResult {
  if (samples.length === 0) throw new Error("computeStats: empty samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  const variance =
    n === 1 ? 0 : sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  const stddev = Math.sqrt(variance);
  return {
    n,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    mean,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    stddev,
    cv: mean === 0 ? 0 : stddev / mean,
  };
}

function percentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) throw new Error("percentile: empty");
  if (n === 1) return sorted[0]!;
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @bench/harness test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/harness/
git commit -m "feat(harness): add types and statistics primitives"
```

---

### Task 4: `harness` — measure loop with mock module

**Files:**
- Create: `packages/harness/src/measure.ts`
- Create: `packages/harness/tests/measure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/harness/tests/measure.test.ts
import { describe, expect, it, vi } from "vitest";
import type { BenchModule } from "../src/types.js";
import { runMeasure } from "../src/measure.js";

function mockModule(opts: {
  checksum: number;
  perRunMs: number;
  driftCv?: number;
}): BenchModule {
  let now = 0;
  const drift = opts.driftCv ?? 0;
  return {
    loadInput: vi.fn(),
    run: vi.fn((iters: number) => {
      const noise = drift > 0 ? (Math.random() * 2 - 1) * drift * opts.perRunMs : 0;
      now += iters * (opts.perRunMs + noise);
      return { checksum: opts.checksum };
    }),
    readOutput: () => new Uint8Array(),
    reset: vi.fn(),
  };
}

describe("runMeasure", () => {
  it("collects minSamples warm samples when noise is low", async () => {
    const mod = mockModule({ checksum: 42, perRunMs: 1.0 });
    const out = await runMeasure({
      module: mod,
      fixture: new Uint8Array([1]),
      expectedChecksum: 42,
      config: {
        warmupIterations: 5,
        innerIterations: 100,
        minSamples: 30,
        maxSamples: 100,
        cvThreshold: 0.05,
      },
    });
    expect(out.warmSamplesMs.length).toBe(30);
    expect(out.correctnessFailed).toBe(false);
    expect(out.finalChecksum).toBe(42);
  });

  it("flags correctness failure on checksum mismatch", async () => {
    const mod = mockModule({ checksum: 99, perRunMs: 1.0 });
    const out = await runMeasure({
      module: mod,
      fixture: new Uint8Array([1]),
      expectedChecksum: 42,
      config: {
        warmupIterations: 1,
        innerIterations: 10,
        minSamples: 5,
        maxSamples: 5,
        cvThreshold: 0.05,
      },
    });
    expect(out.correctnessFailed).toBe(true);
  });
});
```

- [ ] **Step 2: Create `packages/harness/src/measure.ts`**

```ts
import { computeStats } from "./stats.js";
import type { MeasureInput, MeasureOutput } from "./types.js";

export async function runMeasure(input: MeasureInput): Promise<MeasureOutput> {
  const { module, fixture, expectedChecksum, config } = input;

  module.loadInput(fixture);

  const firstCallStart = performance.now();
  const firstResult = module.run(1);
  const firstCallMs = performance.now() - firstCallStart;

  if (firstResult.checksum !== expectedChecksum) {
    return {
      firstCallMs,
      warmSamplesMs: [],
      finalChecksum: firstResult.checksum,
      correctnessFailed: true,
    };
  }

  for (let i = 0; i < config.warmupIterations; i++) {
    module.run(config.innerIterations);
  }

  const samples: number[] = [];
  let lastChecksum: number | string = firstResult.checksum;

  while (samples.length < config.maxSamples) {
    module.reset?.();
    const t0 = performance.now();
    const r = module.run(config.innerIterations);
    const t1 = performance.now();
    samples.push(t1 - t0);
    lastChecksum = r.checksum;

    if (r.checksum !== expectedChecksum) {
      return {
        firstCallMs,
        warmSamplesMs: samples,
        finalChecksum: r.checksum,
        correctnessFailed: true,
      };
    }

    if (samples.length >= config.minSamples) {
      const stats = computeStats(samples);
      if (stats.cv <= config.cvThreshold) break;
    }
  }

  return {
    firstCallMs,
    warmSamplesMs: samples,
    finalChecksum: lastChecksum,
    correctnessFailed: false,
  };
}
```

- [ ] **Step 3: Create `packages/harness/src/index.ts`** (re-export)

```ts
export * from "./types.js";
export * from "./stats.js";
export * from "./measure.js";
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bench/harness test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/harness/
git commit -m "feat(harness): add measurement loop with cv-based early stopping"
```

---

### Task 5: `harness` — checksum validation utility

**Files:**
- Create: `packages/harness/src/validation.ts`
- Create: `packages/harness/tests/validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/harness/tests/validation.test.ts
import { describe, expect, it } from "vitest";
import { f64ChecksumSumAbs, eqChecksum } from "../src/validation.js";

describe("f64ChecksumSumAbs", () => {
  it("sums absolute values of f64 array", () => {
    const arr = new Float64Array([1.0, -2.0, 3.5, -4.5]);
    expect(f64ChecksumSumAbs(arr)).toBeCloseTo(11.0);
  });
  it("returns 0 for empty", () => {
    expect(f64ChecksumSumAbs(new Float64Array())).toBe(0);
  });
});

describe("eqChecksum", () => {
  it("compares numbers within tolerance", () => {
    expect(eqChecksum(1.0, 1.0 + 1e-10)).toBe(true);
    expect(eqChecksum(1.0, 1.001)).toBe(false);
  });
  it("compares strings strictly", () => {
    expect(eqChecksum("abc", "abc")).toBe(true);
    expect(eqChecksum("abc", "abd")).toBe(false);
  });
  it("returns false on type mismatch", () => {
    expect(eqChecksum("1", 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Create `packages/harness/src/validation.ts`**

```ts
export function f64ChecksumSumAbs(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.abs(arr[i]!);
  return s;
}

const FLOAT_TOLERANCE = 1e-9;

export function eqChecksum(a: number | string, b: number | string): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" && typeof b === "number") {
    if (a === 0 && b === 0) return true;
    const denom = Math.max(Math.abs(a), Math.abs(b));
    return Math.abs(a - b) / denom < FLOAT_TOLERANCE;
  }
  return a === b;
}
```

- [ ] **Step 3: Update `packages/harness/src/index.ts`** to re-export validation

```ts
export * from "./types.js";
export * from "./stats.js";
export * from "./measure.js";
export * from "./validation.js";
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bench/harness test`
Expected: PASS.

- [ ] **Step 5: Update `runMeasure` to use `eqChecksum`** in `measure.ts`

Replace both `r.checksum !== expectedChecksum` checks with `!eqChecksum(r.checksum, expectedChecksum)`. Re-run tests; should still pass (mock uses exact integers).

- [ ] **Step 6: Commit**

```bash
git add packages/harness/
git commit -m "feat(harness): add checksum validation with float tolerance"
```

---

### Task 6: `loaders` package — types and timings helper

**Files:**
- Create: `packages/loaders/package.json`
- Create: `packages/loaders/tsconfig.json`
- Create: `packages/loaders/src/types.ts`
- Create: `packages/loaders/src/timings.ts`
- Create: `packages/loaders/src/index.ts`

- [ ] **Step 1: Create `packages/loaders/package.json`**

```json
{
  "name": "@bench/loaders",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@bench/harness": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^3.0.0" }
}
```

- [ ] **Step 2: Create `packages/loaders/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `packages/loaders/src/types.ts`**

```ts
import type { BenchModule, InitTimings } from "@bench/harness";

export interface LoadedModule {
  module: BenchModule;
  timings: InitTimings;
  /** Имя WebAssembly.Memory или null для plain JS */
  memoryRef: WebAssembly.Memory | null;
  wasmRawBytes: number | null;
  jsGlueRawBytes: number | null;
}

export interface LoaderInput {
  /** Абсолютный URL или путь, в зависимости от среды */
  artifactUrl: string;
  /** Для wasm-bindgen / Emscripten: путь к JS-glue */
  glueUrl?: string;
}

export interface Loader {
  load(input: LoaderInput): Promise<LoadedModule>;
}
```

- [ ] **Step 4: Create `packages/loaders/src/timings.ts`**

```ts
import type { InitTimings } from "@bench/harness";

export class TimingRecorder {
  private fetchMs = 0;
  private compileMs = 0;
  private instantiateMs = 0;
  private start = performance.now();

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
```

- [ ] **Step 5: Create `packages/loaders/src/index.ts`**

```ts
export * from "./types.js";
export * from "./timings.js";
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bench/loaders typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/loaders/
git commit -m "feat(loaders): scaffold package with Loader interface and timing helpers"
```

---

### Task 7: `loaders` — plain-js loader

**Files:**
- Create: `packages/loaders/src/plain-js.ts`
- Create: `packages/loaders/tests/plain-js.test.ts`
- Create: `packages/loaders/tests/fixtures/hello-bench/hello.js`

- [ ] **Step 1: Create test fixture `packages/loaders/tests/fixtures/hello-bench/hello.js`**

```js
// Минимальный bench module: просто возвращает фиксированную checksum.
export default function create() {
  let lastInput = null;
  return {
    loadInput(buf) { lastInput = buf; },
    run(_iters) { return { checksum: 42 }; },
    readOutput() { return lastInput ?? new Uint8Array(); },
  };
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/loaders/tests/plain-js.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { plainJsLoader } from "../src/plain-js.js";

const fixtureUrl = fileURLToPath(
  new URL("./fixtures/hello-bench/hello.js", import.meta.url),
);

describe("plainJsLoader", () => {
  it("loads a JS module and returns a BenchModule + timings", async () => {
    const loaded = await plainJsLoader.load({ artifactUrl: fixtureUrl });
    expect(typeof loaded.module.run).toBe("function");
    expect(loaded.module.run(1).checksum).toBe(42);
    expect(loaded.timings.initTotalMs).toBeGreaterThanOrEqual(0);
    expect(loaded.memoryRef).toBeNull();
  });
});
```

- [ ] **Step 3: Create `packages/loaders/src/plain-js.ts`**

```ts
import type { BenchModule } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";

interface JsModuleFactory {
  default: () => BenchModule;
}

export const plainJsLoader: Loader = {
  async load(input: LoaderInput): Promise<LoadedModule> {
    const tr = new TimingRecorder();
    const fetched = await timed(() => import(input.artifactUrl));
    tr.recordFetch(fetched.ms);

    const factory = fetched.value as JsModuleFactory;
    if (typeof factory.default !== "function") {
      throw new Error(`plainJsLoader: module ${input.artifactUrl} has no default export`);
    }

    const compiled = await timed(() => factory.default());
    tr.recordCompile(compiled.ms);
    tr.recordInstantiate(0);

    return {
      module: compiled.value,
      timings: tr.finalize(),
      memoryRef: null,
      wasmRawBytes: null,
      jsGlueRawBytes: null,
    };
  },
};
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bench/loaders test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/loaders/
git commit -m "feat(loaders): add plain-js loader for ESM bench modules"
```

---

### Task 8: `loaders` — raw-wasm loader

**Files:**
- Create: `packages/loaders/src/raw-wasm.ts`
- Create: `packages/loaders/tests/fixtures/hello-bench/hello.wat`
- Create: `packages/loaders/tests/fixtures/hello-bench/hello.wasm` (compiled)
- Create: `packages/loaders/tests/raw-wasm.test.ts`
- Create: `packages/loaders/tests/fixtures/hello-bench/README.md`

The "raw" loader expects a wasm module that exports:
- `memory: WebAssembly.Memory`
- `alloc(size: i32) -> i32`           — allocates linear memory, returns ptr
- `load_input(ptr: i32, len: i32) -> void`  — receives a copy of the fixture
- `run(iters: i32) -> f64`            — returns checksum (we use f64 to keep it generic)
- `output_ptr() -> i32`, `output_len() -> i32`  — for `readOutput`
- `reset() -> void`                   — optional

- [ ] **Step 1: Create reference WAT fixture `packages/loaders/tests/fixtures/hello-bench/hello.wat`**

```wat
(module
  (memory (export "memory") 1)
  (global $next (mut i32) (i32.const 0))
  (global $out_ptr (mut i32) (i32.const 0))
  (global $out_len (mut i32) (i32.const 0))
  (func (export "alloc") (param $sz i32) (result i32)
    (local $p i32)
    (local.set $p (global.get $next))
    (global.set $next (i32.add (global.get $next) (local.get $sz)))
    (local.get $p))
  (func (export "load_input") (param $ptr i32) (param $len i32)
    (global.set $out_ptr (local.get $ptr))
    (global.set $out_len (local.get $len)))
  (func (export "run") (param $iters i32) (result f64)
    (f64.const 42))
  (func (export "output_ptr") (result i32) (global.get $out_ptr))
  (func (export "output_len") (result i32) (global.get $out_len))
  (func (export "reset")))
```

- [ ] **Step 2: Compile WAT to WASM and write README**

Run: `npx wabt-wasm wat2wasm packages/loaders/tests/fixtures/hello-bench/hello.wat -o packages/loaders/tests/fixtures/hello-bench/hello.wasm`

If `wabt-wasm` isn't installed: `pnpm add -Dw wabt && npx wat2wasm ...`

Create `packages/loaders/tests/fixtures/hello-bench/README.md`:

```markdown
# hello-bench

Minimal wasm module exporting the raw-wasm contract.
Re-build with: `npx wat2wasm hello.wat -o hello.wasm`.
Compiled file is committed to avoid wabt requirement at test-time.
```

- [ ] **Step 3: Write the failing test**

```ts
// packages/loaders/tests/raw-wasm.test.ts
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { rawWasmLoader } from "../src/raw-wasm.js";

const fixtureUrl = fileURLToPath(
  new URL("./fixtures/hello-bench/hello.wasm", import.meta.url),
);

describe("rawWasmLoader", () => {
  it("loads a wasm module conforming to the raw contract", async () => {
    const loaded = await rawWasmLoader.load({ artifactUrl: fixtureUrl });
    expect(loaded.memoryRef).toBeInstanceOf(WebAssembly.Memory);
    expect(loaded.wasmRawBytes).toBeGreaterThan(0);

    loaded.module.loadInput(new Uint8Array([1, 2, 3, 4]));
    const r = loaded.module.run(1);
    expect(r.checksum).toBe(42);
  });
});
```

- [ ] **Step 4: Create `packages/loaders/src/raw-wasm.ts`**

```ts
import { readFile } from "node:fs/promises";
import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";

interface RawExports {
  memory: WebAssembly.Memory;
  alloc(sz: number): number;
  load_input(ptr: number, len: number): void;
  run(iters: number): number;
  output_ptr(): number;
  output_len(): number;
  reset?(): void;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`raw-wasm: fetch ${url} -> ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(await readFile(url));
}

export const rawWasmLoader: Loader = {
  async load(input: LoaderInput): Promise<LoadedModule> {
    const tr = new TimingRecorder();

    const fetched = await timed(() => fetchBytes(input.artifactUrl));
    tr.recordFetch(fetched.ms);
    const wasmRawBytes = fetched.value.byteLength;

    const compiled = await timed(() => WebAssembly.compile(fetched.value));
    tr.recordCompile(compiled.ms);

    const instantiated = await timed(() => WebAssembly.instantiate(compiled.value, {}));
    tr.recordInstantiate(instantiated.ms);

    const exports = instantiated.value.exports as unknown as RawExports;
    if (!exports.memory) {
      throw new Error("raw-wasm: module missing 'memory' export");
    }

    const module: BenchModule = {
      loadInput(buf: Uint8Array) {
        const ptr = exports.alloc(buf.byteLength);
        new Uint8Array(exports.memory.buffer).set(buf, ptr);
        exports.load_input(ptr, buf.byteLength);
      },
      run(iters: number): RunResult {
        return { checksum: exports.run(iters) };
      },
      readOutput(): Uint8Array {
        const ptr = exports.output_ptr();
        const len = exports.output_len();
        return new Uint8Array(exports.memory.buffer, ptr, len).slice();
      },
      reset() { exports.reset?.(); },
    };

    return {
      module,
      timings: tr.finalize(),
      memoryRef: exports.memory,
      wasmRawBytes,
      jsGlueRawBytes: 0,
    };
  },
};
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @bench/loaders test`
Expected: PASS for both raw-wasm and plain-js.

- [ ] **Step 6: Commit**

```bash
git add packages/loaders/
git commit -m "feat(loaders): add raw-wasm loader with hello-bench wat fixture"
```

---

### Task 9: `loaders` — wasm-bindgen and emscripten stubs

These two loaders depend on conventions of their respective glue. We scaffold them now and verify them later by building real `matmul` artifacts. For now: signatures + obvious tests against the same `hello.wasm` adapted via thin wrappers.

**Files:**
- Create: `packages/loaders/src/rust-bindgen.ts`
- Create: `packages/loaders/src/emscripten.ts`

- [ ] **Step 1: Create `packages/loaders/src/rust-bindgen.ts`**

```ts
import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";

/**
 * wasm-bindgen glue exports: an `init(url)` async function plus named exports
 * matching #[wasm_bindgen] attributes on the Rust side. The bench's bindgen
 * implementation MUST expose: init(), load_input(Uint8Array), run(iters)->number,
 * output_view()->Uint8Array, memory()->WebAssembly.Memory, reset().
 */
interface BindgenGlue {
  default: (input?: { module_or_path?: string }) => Promise<unknown>;
  load_input: (buf: Uint8Array) => void;
  run: (iters: number) => number;
  output_view: () => Uint8Array;
  memory: () => WebAssembly.Memory;
  reset: () => void;
  __wasm_byte_length?: () => number;
}

export const rustBindgenLoader: Loader = {
  async load(input: LoaderInput): Promise<LoadedModule> {
    if (!input.glueUrl) throw new Error("rust-bindgen: glueUrl required");
    const tr = new TimingRecorder();

    const importTimed = await timed(() => import(input.glueUrl!));
    tr.recordFetch(importTimed.ms);

    const glue = importTimed.value as BindgenGlue;
    const initTimed = await timed(() => glue.default({ module_or_path: input.artifactUrl }));
    // wasm-bindgen does fetch+compile+instantiate inside init; lump into instantiate.
    tr.recordCompile(0);
    tr.recordInstantiate(initTimed.ms);

    const memory = glue.memory();

    const module: BenchModule = {
      loadInput: (buf) => glue.load_input(buf),
      run: (iters): RunResult => ({ checksum: glue.run(iters) }),
      readOutput: () => glue.output_view().slice(),
      reset: () => glue.reset(),
    };

    return {
      module,
      timings: tr.finalize(),
      memoryRef: memory,
      wasmRawBytes: glue.__wasm_byte_length?.() ?? null,
      jsGlueRawBytes: null,
    };
  },
};
```

- [ ] **Step 2: Create `packages/loaders/src/emscripten.ts`**

```ts
import type { BenchModule, RunResult } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";

/**
 * Emscripten with -s MODULARIZE=1 -s ENVIRONMENT=web,worker,node exports a
 * factory function as default. The bench's Emscripten build MUST expose via
 * `EXPORTED_FUNCTIONS` plain C functions with `_` prefix:
 *   _alloc, _load_input, _run, _output_ptr, _output_len, _reset
 * and via EXPORTED_RUNTIME_METHODS: HEAPU8, HEAPF64.
 */
interface EmModule {
  HEAPU8: Uint8Array;
  _alloc(sz: number): number;
  _load_input(ptr: number, len: number): void;
  _run(iters: number): number;
  _output_ptr(): number;
  _output_len(): number;
  _reset(): void;
  wasmMemory: WebAssembly.Memory;
}

interface EmFactory { default: (opts?: object) => Promise<EmModule>; }

export const emscriptenLoader: Loader = {
  async load(input: LoaderInput): Promise<LoadedModule> {
    if (!input.glueUrl) throw new Error("emscripten: glueUrl required");
    const tr = new TimingRecorder();

    const importTimed = await timed(() => import(input.glueUrl!));
    tr.recordFetch(importTimed.ms);
    const factory = importTimed.value as EmFactory;

    const initTimed = await timed(() => factory.default({}));
    tr.recordCompile(0);
    tr.recordInstantiate(initTimed.ms);

    const inst = initTimed.value;

    const module: BenchModule = {
      loadInput(buf) {
        const ptr = inst._alloc(buf.byteLength);
        inst.HEAPU8.set(buf, ptr);
        inst._load_input(ptr, buf.byteLength);
      },
      run(iters): RunResult { return { checksum: inst._run(iters) }; },
      readOutput(): Uint8Array {
        const ptr = inst._output_ptr();
        const len = inst._output_len();
        return inst.HEAPU8.slice(ptr, ptr + len);
      },
      reset() { inst._reset(); },
    };

    return {
      module,
      timings: tr.finalize(),
      memoryRef: inst.wasmMemory,
      wasmRawBytes: null,
      jsGlueRawBytes: null,
    };
  },
};
```

- [ ] **Step 3: Update `packages/loaders/src/index.ts` to re-export all loaders**

```ts
export * from "./types.js";
export * from "./timings.js";
export * from "./plain-js.js";
export * from "./raw-wasm.js";
export * from "./rust-bindgen.js";
export * from "./emscripten.js";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bench/loaders typecheck`
Expected: PASS. (Real integration tests for these two come later when matmul artifacts exist.)

- [ ] **Step 5: Commit**

```bash
git add packages/loaders/
git commit -m "feat(loaders): scaffold rust-bindgen and emscripten loaders"
```

---

### Task 10: `matmul` workload — spec.json and fixture generator

**Files:**
- Create: `benches/matmul/spec.json`
- Create: `benches/matmul/fixtures/generate.ts`
- Create: `benches/matmul/README.md`
- Create: `benches/matmul/validate/reference.ts`

- [ ] **Step 1: Create `benches/matmul/spec.json`**

The expected checksums are filled in by Step 4 below; commit with `null` first, regenerate, commit again.

```json
{
  "id": "matmul",
  "version": 1,
  "description": "Naive O(n^3) dense matrix multiplication on f64. Both inputs and output live in pre-allocated wasm linear memory; modules read A, B from offsets and write C. No allocations on the hot path.",
  "inputSizes": {
    "S": { "n": 64, "fixtureBytes": 65536, "fixtureSha256": null, "expectedChecksum": null },
    "M": { "n": 256, "fixtureBytes": 1048576, "fixtureSha256": null, "expectedChecksum": null },
    "L": { "n": 1024, "fixtureBytes": 16777216, "fixtureSha256": null, "expectedChecksum": null }
  },
  "supported": {
    "languages": ["js", "rust", "cpp"],
    "toolchains": {
      "js": ["idiomatic", "typed-array"],
      "rust": ["raw", "bindgen"],
      "cpp": ["emscripten", "wasi-sdk"]
    },
    "profiles": ["speed", "size"]
  },
  "ioContract": {
    "fixtureLayout": "Two square f64 matrices A and B, row-major, concatenated. Total bytes = 2 * n * n * 8.",
    "outputLayout": "One square f64 matrix C, row-major. Bytes = n * n * 8."
  }
}
```

- [ ] **Step 2: Create `benches/matmul/fixtures/generate.ts`**

```ts
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Mulberry32 PRNG — simple, deterministic, no deps.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFixture(n: number, seed: number): Uint8Array {
  const rng = mulberry32(seed);
  const total = 2 * n * n;
  const f = new Float64Array(total);
  for (let i = 0; i < total; i++) f[i] = rng() * 2 - 1;
  return new Uint8Array(f.buffer);
}

const SIZES = { S: 64, M: 256, L: 1024 } as const;
const SEEDS = { S: 0xC0FFEE_01, M: 0xC0FFEE_02, L: 0xC0FFEE_03 } as const;

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  await mkdir(here, { recursive: true });

  const result: Record<string, { bytes: number; sha256: string }> = {};
  for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
    const buf = buildFixture(n, SEEDS[size]);
    const path = join(here, `${size.toLowerCase()}.bin`);
    await writeFile(path, buf);
    const sha = createHash("sha256").update(buf).digest("hex");
    result[size] = { bytes: buf.byteLength, sha256: sha };
    console.log(`${size}: n=${n} bytes=${buf.byteLength} sha256=${sha}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run the generator and verify output**

Run: `tsx benches/matmul/fixtures/generate.ts`
Expected: three files (`s.bin`, `m.bin`, `l.bin`) appear, prints sha256 for each. Note the values.

- [ ] **Step 4: Update `spec.json` with computed sha256 + fixture sizes**

Replace the three `fixtureSha256` values and verify `fixtureBytes` matches output. Leave `expectedChecksum` as `null` until Task 12.

- [ ] **Step 5: Create `benches/matmul/README.md`**

```markdown
# matmul workload

Naive `C = A * B` for square dense `f64` matrices, row-major. Sizes S=64, M=256, L=1024.

## I/O contract

The harness allocates one buffer in linear memory holding A then B (`2*n*n` f64s).
The bench module exposes:

- `alloc(size: i32) -> i32` — bump allocation; returns ptr
- `load_input(ptr: i32, len: i32) -> void` — receives fixture bytes
- `run(iters: i32) -> f64` — runs matmul `iters` times, returns `sum(abs(C))` of the LAST iteration
- `output_ptr() -> i32`, `output_len() -> i32` — point into linear memory at C
- `reset() -> void` — for stateful runs (no-op here)

For wasm-bindgen / Emscripten the same operations are exposed via their conventions (see `loaders/`).

## Determinism

Inputs are generated with a Mulberry32 PRNG seeded from `0xC0FFEE_0{1..3}`. Re-running `fixtures/generate.ts` reproduces them bit-for-bit.

The expected output checksum is `sum(|C[i,j]|)` over all `n*n` cells of the result.
```

- [ ] **Step 6: Create `benches/matmul/validate/reference.ts`**

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function matmul(n: number, A: Float64Array, B: Float64Array, C: Float64Array): void {
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const a = A[i * n + k]!;
      for (let j = 0; j < n; j++) C[i * n + j]! += a * B[k * n + j]!;
    }
  }
}

function sumAbs(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.abs(arr[i]!);
  return s;
}

const SIZES = { S: 64, M: 256, L: 1024 } as const;

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, "..", "fixtures");
  const out: Record<string, number> = {};
  for (const [size, n] of Object.entries(SIZES) as [keyof typeof SIZES, number][]) {
    const buf = await readFile(join(fixturesDir, `${size.toLowerCase()}.bin`));
    const f = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
    const A = f.subarray(0, n * n);
    const B = f.subarray(n * n, 2 * n * n);
    const C = new Float64Array(n * n);
    matmul(n, A, B, C);
    out[size] = sumAbs(C);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 7: Run reference and update `spec.json`**

Run: `tsx benches/matmul/validate/reference.ts`
Expected: prints `{ "S": <num>, "M": <num>, "L": <num> }`. Copy these into `spec.json`'s `expectedChecksum` fields.

- [ ] **Step 8: Commit**

```bash
git add benches/matmul/spec.json benches/matmul/fixtures/generate.ts benches/matmul/validate/reference.ts benches/matmul/README.md
git commit -m "feat(matmul): add spec, fixture generator, and reference checksums"
```

---

### Task 11: `matmul` JS — idiomatic baseline

**Files:**
- Create: `benches/matmul/js/idiomatic/package.json`
- Create: `benches/matmul/js/idiomatic/tsconfig.json`
- Create: `benches/matmul/js/idiomatic/src/index.ts`

- [ ] **Step 1: Create `benches/matmul/js/idiomatic/package.json`**

```json
{
  "name": "@bench-impl/matmul-js-idiomatic",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.6.3" }
}
```

- [ ] **Step 2: Create `benches/matmul/js/idiomatic/tsconfig.json`**

```json
{ "extends": "../../../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*"] }
```

- [ ] **Step 3: Create `benches/matmul/js/idiomatic/src/index.ts`**

```ts
// Idiomatic JS: native arrays of numbers, no TypedArray. This is the "honest"
// JS baseline for code that didn't pre-optimize for SIMD-style memory access.

interface BenchModule {
  loadInput(input: Uint8Array): void;
  run(iterations: number): { checksum: number };
  readOutput(): Float64Array;
  reset(): void;
}

export default function create(): BenchModule {
  let n = 0;
  let A: number[][] = [];
  let B: number[][] = [];
  let C: number[][] = [];

  return {
    loadInput(input: Uint8Array) {
      const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
      const totalF64 = input.byteLength / 8;
      const half = totalF64 / 2;
      n = Math.round(Math.sqrt(half));
      if (n * n !== half) throw new Error(`matmul: half=${half} not a perfect square`);
      A = []; B = []; C = [];
      let off = 0;
      for (let i = 0; i < n; i++) {
        const row = new Array(n);
        for (let j = 0; j < n; j++) { row[j] = view.getFloat64(off, true); off += 8; }
        A.push(row);
      }
      for (let i = 0; i < n; i++) {
        const row = new Array(n);
        for (let j = 0; j < n; j++) { row[j] = view.getFloat64(off, true); off += 8; }
        B.push(row);
      }
      for (let i = 0; i < n; i++) C.push(new Array(n).fill(0));
    },

    run(iterations: number): { checksum: number } {
      let last = 0;
      for (let it = 0; it < iterations; it++) {
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) C[i]![j] = 0;
        for (let i = 0; i < n; i++) {
          const Ai = A[i]!;
          const Ci = C[i]!;
          for (let k = 0; k < n; k++) {
            const a = Ai[k]!;
            const Bk = B[k]!;
            for (let j = 0; j < n; j++) Ci[j]! += a * Bk[j]!;
          }
        }
        last = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) last += Math.abs(C[i]![j]!);
      }
      return { checksum: last };
    },

    readOutput(): Float64Array {
      const out = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = C[i]![j]!;
      return out;
    },

    reset() {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) C[i]![j] = 0;
    },
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bench-impl/matmul-js-idiomatic typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add benches/matmul/js/idiomatic/
git commit -m "feat(matmul/js): add idiomatic JS baseline (native arrays)"
```

---

### Task 12: `matmul` JS — typed-array optimised

**Files:**
- Create: `benches/matmul/js/typed-array/package.json`
- Create: `benches/matmul/js/typed-array/tsconfig.json`
- Create: `benches/matmul/js/typed-array/src/index.ts`

- [ ] **Step 1: Create `benches/matmul/js/typed-array/package.json`**

```json
{
  "name": "@bench-impl/matmul-js-typed-array",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.6.3" }
}
```

- [ ] **Step 2: Create `benches/matmul/js/typed-array/tsconfig.json`**

```json
{ "extends": "../../../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*"] }
```

- [ ] **Step 3: Create `benches/matmul/js/typed-array/src/index.ts`**

```ts
// Typed-array optimised JS: views directly into f64 buffers. This is the
// strong baseline; matches what a Wasm port would do internally.

interface BenchModule {
  loadInput(input: Uint8Array): void;
  run(iterations: number): { checksum: number };
  readOutput(): Float64Array;
  reset(): void;
}

export default function create(): BenchModule {
  let n = 0;
  let A: Float64Array = new Float64Array();
  let B: Float64Array = new Float64Array();
  let C: Float64Array = new Float64Array();

  return {
    loadInput(input: Uint8Array) {
      const totalF64 = input.byteLength / 8;
      const half = totalF64 / 2;
      n = Math.round(Math.sqrt(half));
      if (n * n !== half) throw new Error(`matmul: half=${half} not a perfect square`);
      const f = new Float64Array(input.buffer.slice(
        input.byteOffset, input.byteOffset + input.byteLength,
      ));
      A = f.subarray(0, n * n);
      B = f.subarray(n * n, 2 * n * n);
      C = new Float64Array(n * n);
    },

    run(iterations: number): { checksum: number } {
      let last = 0;
      for (let it = 0; it < iterations; it++) {
        C.fill(0);
        for (let i = 0; i < n; i++) {
          const aRow = i * n;
          const cRow = i * n;
          for (let k = 0; k < n; k++) {
            const a = A[aRow + k]!;
            const bRow = k * n;
            for (let j = 0; j < n; j++) {
              C[cRow + j]! += a * B[bRow + j]!;
            }
          }
        }
        last = 0;
        for (let i = 0; i < C.length; i++) last += Math.abs(C[i]!);
      }
      return { checksum: last };
    },

    readOutput(): Float64Array { return C.slice(); },
    reset() { C.fill(0); },
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bench-impl/matmul-js-typed-array typecheck`
Expected: PASS.

- [ ] **Step 5: Verify checksum matches reference**

Quick adhoc verification: write a 5-line script that imports the typed-array module, loads `s.bin`, runs once, and compares against `spec.json`'s `S.expectedChecksum`. If matches, delete the script and continue.

```bash
node --experimental-strip-types -e '
import("./benches/matmul/js/typed-array/src/index.ts").then(async (m) => {
  const fs = await import("node:fs");
  const buf = fs.readFileSync("benches/matmul/fixtures/s.bin");
  const mod = m.default();
  mod.loadInput(new Uint8Array(buf));
  console.log(mod.run(1).checksum);
});
'
```

Expected: prints S.expectedChecksum from `spec.json` (within float tolerance).

- [ ] **Step 6: Commit**

```bash
git add benches/matmul/js/typed-array/
git commit -m "feat(matmul/js): add typed-array optimised JS baseline"
```

---

### Task 13: `matmul` Rust — raw (no wasm-bindgen)

**Files:**
- Create: `benches/matmul/rust/raw/Cargo.toml`
- Create: `benches/matmul/rust/raw/src/lib.rs`
- Modify: workspace `Cargo.toml` (root) — but we don't want a Rust workspace at root, since Rust crates are isolated per workload/toolchain. Each `Cargo.toml` is standalone.

- [ ] **Step 1: Create `benches/matmul/rust/raw/Cargo.toml`**

```toml
[package]
name = "matmul-rust-raw"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true

[profile.release-size]
inherits = "release"
opt-level = "z"
```

- [ ] **Step 2: Create `benches/matmul/rust/raw/src/lib.rs`**

```rust
#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn on_panic(_: &PanicInfo) -> ! { loop {} }

const HEAP_SIZE: usize = 32 * 1024 * 1024;
static mut HEAP: [u8; HEAP_SIZE] = [0; HEAP_SIZE];
static mut NEXT: usize = 0;

static mut N: usize = 0;
static mut A_PTR: usize = 0;
static mut B_PTR: usize = 0;
static mut C_PTR: usize = 0;

#[no_mangle]
pub extern "C" fn alloc(sz: u32) -> u32 {
    unsafe {
        let p = NEXT;
        NEXT = (NEXT + sz as usize + 7) & !7; // align 8
        if NEXT > HEAP_SIZE { return u32::MAX; }
        (HEAP.as_ptr() as usize + p) as u32
    }
}

#[no_mangle]
pub extern "C" fn load_input(ptr: u32, len: u32) {
    unsafe {
        let total_f64 = (len as usize) / 8;
        let half = total_f64 / 2;
        let n = (half as f64).sqrt() as usize;
        debug_assert!(n * n == half);
        N = n;
        A_PTR = ptr as usize;
        B_PTR = ptr as usize + n * n * 8;
        // C is allocated next to the inputs.
        let c_sz = (n * n * 8) as u32;
        C_PTR = alloc(c_sz) as usize;
    }
}

#[no_mangle]
pub extern "C" fn run(iters: u32) -> f64 {
    unsafe {
        let n = N;
        let a = core::slice::from_raw_parts(A_PTR as *const f64, n * n);
        let b = core::slice::from_raw_parts(B_PTR as *const f64, n * n);
        let c = core::slice::from_raw_parts_mut(C_PTR as *mut f64, n * n);
        let mut last_sum = 0.0_f64;
        for _ in 0..iters {
            for x in c.iter_mut() { *x = 0.0; }
            for i in 0..n {
                for k in 0..n {
                    let aik = a[i * n + k];
                    for j in 0..n {
                        c[i * n + j] += aik * b[k * n + j];
                    }
                }
            }
            let mut s = 0.0_f64;
            for &x in c.iter() { s += x.abs(); }
            last_sum = s;
        }
        last_sum
    }
}

#[no_mangle]
pub extern "C" fn output_ptr() -> u32 { unsafe { C_PTR as u32 } }

#[no_mangle]
pub extern "C" fn output_len() -> u32 { unsafe { (N * N * 8) as u32 } }

#[no_mangle]
pub extern "C" fn reset() {}
```

- [ ] **Step 3: Manually build to verify the crate compiles**

Run: `cd benches/matmul/rust/raw && cargo build --release --target wasm32-unknown-unknown && wc -c target/wasm32-unknown-unknown/release/matmul_rust_raw.wasm`
Expected: builds without errors. Note approximate byte size (sanity check, not validation).

- [ ] **Step 4: Commit**

```bash
git add benches/matmul/rust/raw/Cargo.toml benches/matmul/rust/raw/src/lib.rs
git commit -m "feat(matmul/rust): add raw wasm32 implementation (no_std, bump alloc)"
```

---

### Task 14: `matmul` Rust — wasm-bindgen

**Files:**
- Create: `benches/matmul/rust/bindgen/Cargo.toml`
- Create: `benches/matmul/rust/bindgen/src/lib.rs`

- [ ] **Step 1: Create `benches/matmul/rust/bindgen/Cargo.toml`**

```toml
[package]
name = "matmul-rust-bindgen"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"

[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true

[profile.release-size]
inherits = "release"
opt-level = "z"
```

- [ ] **Step 2: Create `benches/matmul/rust/bindgen/src/lib.rs`**

```rust
use wasm_bindgen::prelude::*;

static mut N: usize = 0;
static mut A: Vec<f64> = Vec::new();
static mut B: Vec<f64> = Vec::new();
static mut C: Vec<f64> = Vec::new();

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let total_f64 = buf.len() / 8;
    let half = total_f64 / 2;
    let n = (half as f64).sqrt() as usize;
    debug_assert!(n * n == half);
    let f64s: &[f64] = unsafe {
        core::slice::from_raw_parts(buf.as_ptr() as *const f64, total_f64)
    };
    unsafe {
        N = n;
        A = f64s[0..n*n].to_vec();
        B = f64s[n*n..2*n*n].to_vec();
        C = vec![0.0; n*n];
    }
}

#[wasm_bindgen]
pub fn run(iters: u32) -> f64 {
    let mut last = 0.0;
    unsafe {
        for _ in 0..iters {
            for x in C.iter_mut() { *x = 0.0; }
            let n = N;
            for i in 0..n {
                for k in 0..n {
                    let aik = A[i*n+k];
                    for j in 0..n { C[i*n+j] += aik * B[k*n+j]; }
                }
            }
            let mut s = 0.0_f64;
            for &x in C.iter() { s += x.abs(); }
            last = s;
        }
    }
    last
}

#[wasm_bindgen]
pub fn output_view() -> Vec<u8> {
    unsafe {
        let bytes = core::slice::from_raw_parts(
            C.as_ptr() as *const u8, C.len() * 8,
        );
        bytes.to_vec()
    }
}

#[wasm_bindgen]
pub fn reset() {
    unsafe { for x in C.iter_mut() { *x = 0.0; } }
}

#[wasm_bindgen]
pub fn memory() -> JsValue { wasm_bindgen::memory() }
```

- [ ] **Step 3: Verify it builds via wasm-pack**

Run: `cd benches/matmul/rust/bindgen && wasm-pack build --target web --release --out-dir pkg-tmp && ls pkg-tmp && rm -rf pkg-tmp`
Expected: builds; outputs `*.wasm` and `*.js` glue. Then clean up `pkg-tmp` (real builds happen via `scripts/build-rust.ts`).

- [ ] **Step 4: Commit**

```bash
git add benches/matmul/rust/bindgen/
git commit -m "feat(matmul/rust): add wasm-bindgen variant"
```

---

### Task 15: `matmul` C++ — shared source + Emscripten build

**Files:**
- Create: `benches/matmul/cpp/src/matmul.h`
- Create: `benches/matmul/cpp/src/matmul.cpp`
- Create: `benches/matmul/cpp/build-emscripten.sh`

- [ ] **Step 1: Create `benches/matmul/cpp/src/matmul.h`**

```cpp
#pragma once
#include <stdint.h>

extern "C" {
uint32_t alloc(uint32_t sz);
void load_input(uint32_t ptr, uint32_t len);
double run(uint32_t iters);
uint32_t output_ptr(void);
uint32_t output_len(void);
void reset(void);
}
```

- [ ] **Step 2: Create `benches/matmul/cpp/src/matmul.cpp`**

```cpp
#include "matmul.h"
#include <math.h>

static const uint32_t HEAP_SIZE = 32u * 1024u * 1024u;
static uint8_t heap[HEAP_SIZE];
static uint32_t next_off = 0;

static uint32_t N = 0;
static uint32_t A_OFF = 0;
static uint32_t B_OFF = 0;
static uint32_t C_OFF = 0;

extern "C" uint32_t alloc(uint32_t sz) {
    uint32_t p = next_off;
    next_off = (next_off + sz + 7u) & ~7u;
    if (next_off > HEAP_SIZE) return 0xFFFFFFFFu;
    return (uint32_t)((uintptr_t)&heap[p]);
}

extern "C" void load_input(uint32_t ptr, uint32_t len) {
    uint32_t total_f64 = len / 8u;
    uint32_t half = total_f64 / 2u;
    uint32_t n = (uint32_t)sqrt((double)half);
    N = n;
    A_OFF = ptr;
    B_OFF = ptr + n * n * 8u;
    C_OFF = alloc(n * n * 8u);
}

extern "C" double run(uint32_t iters) {
    const uint32_t n = N;
    const double* A = (const double*)(uintptr_t)A_OFF;
    const double* B = (const double*)(uintptr_t)B_OFF;
    double* C = (double*)(uintptr_t)C_OFF;
    double last = 0.0;
    for (uint32_t it = 0; it < iters; it++) {
        for (uint32_t i = 0; i < n*n; i++) C[i] = 0.0;
        for (uint32_t i = 0; i < n; i++) {
            for (uint32_t k = 0; k < n; k++) {
                const double aik = A[i*n + k];
                for (uint32_t j = 0; j < n; j++) C[i*n + j] += aik * B[k*n + j];
            }
        }
        double s = 0.0;
        for (uint32_t i = 0; i < n*n; i++) s += fabs(C[i]);
        last = s;
    }
    return last;
}

extern "C" uint32_t output_ptr() { return C_OFF; }
extern "C" uint32_t output_len() { return N * N * 8u; }
extern "C" void reset() {}
```

- [ ] **Step 3: Create `benches/matmul/cpp/build-emscripten.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Args: $1 = profile (speed|size), $2 = output dir
PROFILE="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "$0")" && pwd)"

EXPORTS='["_alloc","_load_input","_run","_output_ptr","_output_len","_reset"]'
RT_METHODS='["HEAPU8","HEAPF64","wasmMemory"]'

if [[ "$PROFILE" == "speed" ]]; then
  OPT="-O3 -flto"
elif [[ "$PROFILE" == "size" ]]; then
  OPT="-Oz -flto --closure 1"
else
  echo "unknown profile: $PROFILE" >&2; exit 1
fi

emcc \
  "$HERE/src/matmul.cpp" \
  $OPT \
  -fno-exceptions -fno-rtti \
  -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker,node \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s "EXPORTED_FUNCTIONS=$EXPORTS" \
  -s "EXPORTED_RUNTIME_METHODS=$RT_METHODS" \
  -o "$OUT_DIR/glue.mjs"

# emcc emits glue.mjs and glue.wasm side-by-side; rename for our convention.
mv "$OUT_DIR/glue.wasm" "$OUT_DIR/module.wasm" 2>/dev/null || true

# Apply wasm-opt -Oz on size profile (in addition to closure).
if [[ "$PROFILE" == "size" ]]; then
  wasm-opt -Oz "$OUT_DIR/module.wasm" -o "$OUT_DIR/module.wasm"
fi
```

- [ ] **Step 4: Make executable and verify build (manual smoke)**

Run: `chmod +x benches/matmul/cpp/build-emscripten.sh && benches/matmul/cpp/build-emscripten.sh speed /tmp/em-test && ls /tmp/em-test`
Expected: `glue.mjs` and `module.wasm` produced. (Emscripten must be on PATH; if not, install per https://emscripten.org/.)

- [ ] **Step 5: Commit**

```bash
git add benches/matmul/cpp/
git commit -m "feat(matmul/cpp): add shared source and emscripten build script"
```

---

### Task 16: `matmul` C++ — wasi-sdk freestanding build

**Files:**
- Create: `benches/matmul/cpp/build-wasi-sdk.sh`

- [ ] **Step 1: Create `benches/matmul/cpp/build-wasi-sdk.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Args: $1 = profile (speed|size), $2 = output dir
PROFILE="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"
HERE="$(cd "$(dirname "$0")" && pwd)"
WASI_SDK_PATH="${WASI_SDK_PATH:?WASI_SDK_PATH must point to wasi-sdk install root}"

if [[ "$PROFILE" == "speed" ]]; then
  OPT="-O3 -flto"
elif [[ "$PROFILE" == "size" ]]; then
  OPT="-Oz -flto"
else
  echo "unknown profile: $PROFILE" >&2; exit 1
fi

# Freestanding build: we don't link wasi-libc; matmul uses no heap and only
# computes math via libcalls (sqrt/fabs) which we provide via builtins.
"$WASI_SDK_PATH/bin/clang++" \
  --target=wasm32 \
  -nostdlib \
  $OPT \
  -fno-exceptions -fno-rtti \
  -fvisibility=hidden \
  -mbulk-memory \
  "$HERE/src/matmul.cpp" \
  -Wl,--no-entry \
  -Wl,--export=alloc -Wl,--export=load_input -Wl,--export=run \
  -Wl,--export=output_ptr -Wl,--export=output_len -Wl,--export=reset \
  -Wl,--export=memory \
  -Wl,--allow-undefined \
  -Wl,--strip-all \
  -o "$OUT_DIR/module.wasm"

if [[ "$PROFILE" == "size" ]]; then
  wasm-opt -Oz "$OUT_DIR/module.wasm" -o "$OUT_DIR/module.wasm"
fi
```

- [ ] **Step 2: Verify build (manual smoke)**

Run: `chmod +x benches/matmul/cpp/build-wasi-sdk.sh && WASI_SDK_PATH=$HOME/wasi-sdk-25 benches/matmul/cpp/build-wasi-sdk.sh speed /tmp/wasi-test && ls /tmp/wasi-test`
Expected: `module.wasm` produced.

If link fails because of missing `sqrt`/`fabs` symbols, replace usage in `matmul.cpp` with `__builtin_sqrt`/`__builtin_fabs` and rebuild.

- [ ] **Step 3: Commit**

```bash
git add benches/matmul/cpp/build-wasi-sdk.sh
git commit -m "feat(matmul/cpp): add wasi-sdk freestanding build script"
```

---

### Task 17: `scripts/lib` — matrix and exec helpers

**Files:**
- Create: `scripts/lib/exec.ts`
- Create: `scripts/lib/matrix.ts`
- Create: `scripts/lib/meta.ts`
- Create: `scripts/lib/tool-versions.ts`

- [ ] **Step 1: Create `scripts/lib/exec.ts`**

```ts
import { execa } from "execa";

export async function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<void> {
  const out = await execa(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: "inherit",
  });
  if (out.exitCode !== 0) throw new Error(`${cmd} ${args.join(" ")} -> exit ${out.exitCode}`);
}

export async function capture(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<string> {
  const out = await execa(cmd, args, { cwd: opts.cwd });
  return out.stdout;
}
```

- [ ] **Step 2: Create `scripts/lib/matrix.ts`**

```ts
import type { Language, Toolchain, Profile, InputSize } from "@bench/result-schema";

export interface Combination {
  benchmarkId: string;
  language: Language;
  toolchain: Toolchain;
  profile: Profile;
}

export interface RunCombination extends Combination {
  inputSize: InputSize;
  env: "node" | "browser-chromium" | "browser-firefox";
}

export const ALL_COMBINATIONS: Combination[] = [
  // JS
  { benchmarkId: "matmul", language: "js",   toolchain: "idiomatic",   profile: "speed" },
  { benchmarkId: "matmul", language: "js",   toolchain: "typed-array", profile: "speed" },
  // Rust
  { benchmarkId: "matmul", language: "rust", toolchain: "raw",        profile: "speed" },
  { benchmarkId: "matmul", language: "rust", toolchain: "raw",        profile: "size"  },
  { benchmarkId: "matmul", language: "rust", toolchain: "bindgen",    profile: "speed" },
  { benchmarkId: "matmul", language: "rust", toolchain: "bindgen",    profile: "size"  },
  // C++
  { benchmarkId: "matmul", language: "cpp",  toolchain: "emscripten", profile: "speed" },
  { benchmarkId: "matmul", language: "cpp",  toolchain: "emscripten", profile: "size"  },
  { benchmarkId: "matmul", language: "cpp",  toolchain: "wasi-sdk",   profile: "speed" },
  { benchmarkId: "matmul", language: "cpp",  toolchain: "wasi-sdk",   profile: "size"  },
];

export function distDir(c: Combination): string {
  return `dist/${c.benchmarkId}/${c.language}-${c.toolchain}-${c.profile}`;
}
```

- [ ] **Step 3: Create `scripts/lib/meta.ts`**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { join } from "node:path";

export interface ArtifactMeta {
  combination: { benchmarkId: string; language: string; toolchain: string; profile: string };
  wasm: { rawBytes: number; gzipBytes: number; brotliBytes: number; hashSha256: string } | null;
  jsGlue: { rawBytes: number; gzipBytes: number; brotliBytes: number; hashSha256: string } | null;
  jsModule: { rawBytes: number; gzipBytes: number; brotliBytes: number; hashSha256: string } | null;
  totalTransferGzipBytes: number;
  toolchainVersions: Record<string, string>;
}

export async function statArtifact(path: string) {
  const buf = await readFile(path);
  return {
    rawBytes: buf.byteLength,
    gzipBytes: gzipSync(buf, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(buf).byteLength,
    hashSha256: createHash("sha256").update(buf).digest("hex"),
  };
}

export async function writeMeta(distPath: string, meta: ArtifactMeta): Promise<void> {
  await writeFile(join(distPath, "meta.json"), JSON.stringify(meta, null, 2));
}
```

- [ ] **Step 4: Create `scripts/lib/tool-versions.ts`**

```ts
import { readFile } from "node:fs/promises";
import { capture } from "./exec.js";

export async function readPinned(): Promise<Record<string, string>> {
  const buf = await readFile("tool-versions.json", "utf8");
  const obj = JSON.parse(buf) as Record<string, string>;
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "comment"));
}

export async function detectActual(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try { out.rustc = (await capture("rustc", ["--version"])).trim(); } catch {}
  try { out["wasm-pack"] = (await capture("wasm-pack", ["--version"])).trim(); } catch {}
  try { out["wasm-opt"] = (await capture("wasm-opt", ["--version"])).trim(); } catch {}
  try { out.emcc = (await capture("emcc", ["--version"])).split("\n")[0]!.trim(); } catch {}
  try { out.node = process.version; } catch {}
  return out;
}
```

- [ ] **Step 5: Typecheck**

Add a top-level `tsconfig.json` for scripts:

```json
{ "extends": "./tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["scripts/**/*"] }
```

Run: `pnpm exec tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/ tsconfig.json
git commit -m "feat(scripts): add matrix, exec, meta, tool-versions helpers"
```

---

### Task 18: `scripts/build-js.ts` — bundle JS workloads

**Files:**
- Create: `scripts/build-js.ts`

- [ ] **Step 1: Create `scripts/build-js.ts`**

```ts
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build as esbuild } from "esbuild";
import { ALL_COMBINATIONS, distDir, type Combination } from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";

async function buildOne(c: Combination): Promise<void> {
  const out = distDir(c);
  await mkdir(out, { recursive: true });

  const entry = `benches/${c.benchmarkId}/js/${c.toolchain}/src/index.ts`;
  const outFile = join(out, "module.js");

  await esbuild({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    outfile: outFile,
    platform: "neutral",
    treeShaking: true,
  });

  const stat = await statArtifact(outFile);
  const versions = await detectActual();
  const meta: ArtifactMeta = {
    combination: c,
    wasm: null,
    jsGlue: null,
    jsModule: stat,
    totalTransferGzipBytes: stat.gzipBytes,
    toolchainVersions: versions,
  };
  await writeMeta(out, meta);
  console.log(`built ${entry} -> ${outFile} (${stat.rawBytes} B raw, ${stat.gzipBytes} B gz)`);
}

async function main() {
  const jsCombos = ALL_COMBINATIONS.filter((c) => c.language === "js");
  for (const c of jsCombos) await buildOne(c);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Add esbuild to root devDeps**

Run: `pnpm add -Dw esbuild@^0.24.0`

- [ ] **Step 3: Run and verify**

Run: `pnpm build:js && ls dist/matmul/`
Expected: `js-idiomatic-speed/` and `js-typed-array-speed/` present, each with `module.js` and `meta.json`.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-js.ts package.json pnpm-lock.yaml
git commit -m "feat(scripts): build JS variants with esbuild"
```

---

### Task 19: `scripts/build-rust.ts` — both rust toolchains

**Files:**
- Create: `scripts/build-rust.ts`

- [ ] **Step 1: Create `scripts/build-rust.ts`**

```ts
import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./lib/exec.js";
import { ALL_COMBINATIONS, distDir, type Combination } from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";

async function buildRaw(c: Combination): Promise<void> {
  const crateDir = `benches/${c.benchmarkId}/rust/raw`;
  const profile = c.profile === "speed" ? "release" : "release-size";
  const profileDir = c.profile === "speed" ? "release" : "release-size";
  const out = distDir(c);
  await mkdir(out, { recursive: true });

  await run("cargo", ["build", `--profile=${profile}`, "--target=wasm32-unknown-unknown"], { cwd: crateDir });
  const wasmName = `matmul_rust_raw.wasm`;
  const src = join(crateDir, "target", "wasm32-unknown-unknown", profileDir, wasmName);
  const dst = join(out, "module.wasm");
  await copyFile(src, dst);

  if (c.profile === "size") {
    await run("wasm-opt", ["-Oz", dst, "-o", dst]);
  }

  const wasmStat = await statArtifact(dst);
  const meta: ArtifactMeta = {
    combination: c,
    wasm: wasmStat,
    jsGlue: null,
    jsModule: null,
    totalTransferGzipBytes: wasmStat.gzipBytes,
    toolchainVersions: await detectActual(),
  };
  await writeMeta(out, meta);
  console.log(`built ${crateDir} (${profile}) -> ${dst} (${wasmStat.rawBytes} B)`);
}

async function buildBindgen(c: Combination): Promise<void> {
  const crateDir = `benches/${c.benchmarkId}/rust/bindgen`;
  const out = distDir(c);
  await mkdir(out, { recursive: true });

  // wasm-pack writes into <crateDir>/pkg-tmp; copy artifacts.
  const pkgDir = join(crateDir, "pkg-tmp");
  await rm(pkgDir, { recursive: true, force: true });
  const profileFlag = c.profile === "speed" ? "--release" : "--release";
  await run("wasm-pack", ["build", "--target=web", profileFlag, "--out-dir=pkg-tmp"], { cwd: crateDir });

  // Identify produced files.
  const files = await readdir(pkgDir);
  const wasmFile = files.find((f) => f.endsWith("_bg.wasm"))!;
  const jsFile = files.find((f) => f.endsWith(".js") && !f.endsWith(".d.ts"))!;
  const wasmDst = join(out, "module.wasm");
  const glueDst = join(out, "glue.js");
  await copyFile(join(pkgDir, wasmFile), wasmDst);
  await copyFile(join(pkgDir, jsFile), glueDst);

  if (c.profile === "size") {
    await run("wasm-opt", ["-Oz", wasmDst, "-o", wasmDst]);
  }

  const wasmStat = await statArtifact(wasmDst);
  const glueStat = await statArtifact(glueDst);
  const meta: ArtifactMeta = {
    combination: c,
    wasm: wasmStat,
    jsGlue: glueStat,
    jsModule: null,
    totalTransferGzipBytes: wasmStat.gzipBytes + glueStat.gzipBytes,
    toolchainVersions: await detectActual(),
  };
  await writeMeta(out, meta);
  console.log(`built ${crateDir} (${c.profile}) -> ${wasmDst} (${wasmStat.rawBytes} B + ${glueStat.rawBytes} B glue)`);
}

async function main() {
  for (const c of ALL_COMBINATIONS.filter((c) => c.language === "rust")) {
    if (c.toolchain === "raw") await buildRaw(c);
    else if (c.toolchain === "bindgen") await buildBindgen(c);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Run and verify**

Run: `pnpm build:rust && ls dist/matmul/`
Expected: four `rust-*` dirs each with `module.wasm` and `meta.json`. Bindgen variants also have `glue.js`.

If wasm-pack profile flag for size doesn't work as expected, post-process with `wasm-opt -Oz` is enough; size-vs-speed difference for bindgen comes from `wasm-opt`.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-rust.ts
git commit -m "feat(scripts): build Rust raw and bindgen variants"
```

---

### Task 20: `scripts/build-cpp.ts` — both C++ toolchains

**Files:**
- Create: `scripts/build-cpp.ts`

- [ ] **Step 1: Create `scripts/build-cpp.ts`**

```ts
import { mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { run } from "./lib/exec.js";
import { ALL_COMBINATIONS, distDir, type Combination } from "./lib/matrix.js";
import { statArtifact, writeMeta, type ArtifactMeta } from "./lib/meta.js";
import { detectActual } from "./lib/tool-versions.js";

async function buildEmscripten(c: Combination): Promise<void> {
  const out = distDir(c);
  await mkdir(out, { recursive: true });
  const script = resolve(`benches/${c.benchmarkId}/cpp/build-emscripten.sh`);
  await run("bash", [script, c.profile, resolve(out)]);

  const wasmStat = await statArtifact(join(out, "module.wasm"));
  const glueStat = await statArtifact(join(out, "glue.mjs"));
  const meta: ArtifactMeta = {
    combination: c,
    wasm: wasmStat,
    jsGlue: glueStat,
    jsModule: null,
    totalTransferGzipBytes: wasmStat.gzipBytes + glueStat.gzipBytes,
    toolchainVersions: await detectActual(),
  };
  await writeMeta(out, meta);
  console.log(`built emscripten (${c.profile}) -> ${out} (${wasmStat.rawBytes} B + ${glueStat.rawBytes} B glue)`);
}

async function buildWasiSdk(c: Combination): Promise<void> {
  const out = distDir(c);
  await mkdir(out, { recursive: true });
  const script = resolve(`benches/${c.benchmarkId}/cpp/build-wasi-sdk.sh`);
  await run("bash", [script, c.profile, resolve(out)]);

  const wasmStat = await statArtifact(join(out, "module.wasm"));
  const meta: ArtifactMeta = {
    combination: c,
    wasm: wasmStat,
    jsGlue: null,
    jsModule: null,
    totalTransferGzipBytes: wasmStat.gzipBytes,
    toolchainVersions: await detectActual(),
  };
  await writeMeta(out, meta);
  console.log(`built wasi-sdk (${c.profile}) -> ${out} (${wasmStat.rawBytes} B)`);
}

async function main() {
  for (const c of ALL_COMBINATIONS.filter((c) => c.language === "cpp")) {
    if (c.toolchain === "emscripten") await buildEmscripten(c);
    else if (c.toolchain === "wasi-sdk") await buildWasiSdk(c);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Run and verify**

Run: `pnpm build:cpp && ls dist/matmul/`
Expected: four `cpp-*` dirs (emscripten×2 + wasi-sdk×2), each with `module.wasm` and `meta.json`. Emscripten variants have `glue.mjs` as well.

Pre-requisite for first run: `emcc` on PATH and `WASI_SDK_PATH` env var pointing to wasi-sdk install root.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-cpp.ts
git commit -m "feat(scripts): build C++ Emscripten and wasi-sdk variants"
```

---

### Task 21: `scripts/build-all.ts` — orchestrate

**Files:**
- Create: `scripts/build-all.ts`

- [ ] **Step 1: Create `scripts/build-all.ts`**

```ts
import { run } from "./lib/exec.js";

async function main() {
  console.log("=== generating fixtures ===");
  await run("tsx", ["benches/matmul/fixtures/generate.ts"]);

  console.log("=== building JS ===");
  await run("tsx", ["scripts/build-js.ts"]);

  console.log("=== building Rust ===");
  await run("tsx", ["scripts/build-rust.ts"]);

  console.log("=== building C++ ===");
  await run("tsx", ["scripts/build-cpp.ts"]);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run end-to-end**

Run: `pnpm build:all`
Expected: 10 directories under `dist/matmul/`, each with `meta.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-all.ts
git commit -m "feat(scripts): orchestrate fixture + js + rust + cpp builds"
```

---

### Task 22: `apps/runner-node` — drive single case

**Files:**
- Create: `apps/runner-node/package.json`
- Create: `apps/runner-node/tsconfig.json`
- Create: `apps/runner-node/src/run-case.ts`
- Create: `apps/runner-node/src/main.ts`

- [ ] **Step 1: Create `apps/runner-node/package.json`**

```json
{
  "name": "@bench-app/runner-node",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "start": "tsx src/main.ts"
  },
  "dependencies": {
    "@bench/harness": "workspace:*",
    "@bench/loaders": "workspace:*",
    "@bench/result-schema": "workspace:*"
  },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.6.3" }
}
```

- [ ] **Step 2: Create `apps/runner-node/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*"] }
```

- [ ] **Step 3: Create `apps/runner-node/src/run-case.ts`**

```ts
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { computeStats, runMeasure, type MeasureConfig } from "@bench/harness";
import {
  plainJsLoader, rawWasmLoader, rustBindgenLoader, emscriptenLoader, type Loader,
} from "@bench/loaders";
import {
  BenchResultSchema, SCHEMA_VERSION,
  type BenchResult, type Toolchain, type Profile, type Language, type InputSize,
} from "@bench/result-schema";

interface RunCaseInput {
  benchmarkId: string;
  language: Language;
  toolchain: Toolchain;
  profile: Profile;
  inputSize: InputSize;
  measureConfig: MeasureConfig;
}

function pickLoader(lang: Language, tc: Toolchain): Loader {
  if (lang === "js") return plainJsLoader;
  if (lang === "rust" && tc === "raw") return rawWasmLoader;
  if (lang === "rust" && tc === "bindgen") return rustBindgenLoader;
  if (lang === "cpp" && tc === "emscripten") return emscriptenLoader;
  if (lang === "cpp" && tc === "wasi-sdk") return rawWasmLoader;
  throw new Error(`no loader for ${lang}/${tc}`);
}

export async function runCase(input: RunCaseInput): Promise<BenchResult> {
  const distRoot = resolve(`dist/${input.benchmarkId}/${input.language}-${input.toolchain}-${input.profile}`);
  const meta = JSON.parse(await readFile(join(distRoot, "meta.json"), "utf8"));

  const loader = pickLoader(input.language, input.toolchain);
  let artifactUrl: string;
  let glueUrl: string | undefined;
  if (input.language === "js") {
    artifactUrl = pathToFileURL(join(distRoot, "module.js")).href;
  } else if (input.toolchain === "bindgen") {
    artifactUrl = pathToFileURL(join(distRoot, "module.wasm")).href;
    glueUrl = pathToFileURL(join(distRoot, "glue.js")).href;
  } else if (input.toolchain === "emscripten") {
    artifactUrl = pathToFileURL(join(distRoot, "module.wasm")).href;
    glueUrl = pathToFileURL(join(distRoot, "glue.mjs")).href;
  } else {
    artifactUrl = join(distRoot, "module.wasm"); // raw-wasm reads via fs
  }

  const loaded = await loader.load({ artifactUrl, glueUrl });

  const specPath = resolve(`benches/${input.benchmarkId}/spec.json`);
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const sizeSpec = spec.inputSizes[input.inputSize];
  const fixturePath = resolve(`benches/${input.benchmarkId}/fixtures/${input.inputSize.toLowerCase()}.bin`);
  const fixture = new Uint8Array(await readFile(fixturePath));

  const memBefore = loaded.memoryRef?.buffer.byteLength ?? 0;
  const measure = await runMeasure({
    module: loaded.module,
    fixture,
    expectedChecksum: sizeSpec.expectedChecksum,
    config: input.measureConfig,
  });
  const memAfter = loaded.memoryRef?.buffer.byteLength ?? 0;

  const stats = measure.warmSamplesMs.length > 0 ? computeStats(measure.warmSamplesMs)
    : { median: 0, p95: 0, p99: 0, stddev: 0, min: 0, max: 0, mean: 0, cv: 0, n: 0 };

  const result: BenchResult = {
    schemaVersion: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    machine: {
      os: `${process.platform} ${process.arch}`,
      cpu: process.env.MACHINE_CPU ?? "unknown",
      memoryGb: Math.round(require("node:os").totalmem() / (1024 ** 3)),
    },
    env: { kind: "node", name: "node", version: process.version, engine: "V8" },
    benchmark: {
      id: input.benchmarkId,
      inputSize: input.inputSize,
      fixtureBytes: fixture.byteLength,
      fixtureSha256: sizeSpec.fixtureSha256,
      language: input.language,
      toolchain: input.toolchain,
      profile: input.profile,
      postprocess: meta.toolchainVersions["wasm-opt"] ? ["wasm-opt"] : [],
    },
    artifacts: {
      wasmRawBytes: meta.wasm?.rawBytes ?? 0,
      wasmGzipBytes: meta.wasm?.gzipBytes ?? 0,
      wasmBrotliBytes: meta.wasm?.brotliBytes ?? 0,
      jsGlueRawBytes: meta.jsGlue?.rawBytes ?? 0,
      jsGlueGzipBytes: meta.jsGlue?.gzipBytes ?? 0,
      totalTransferGzipBytes: meta.totalTransferGzipBytes ?? 0,
      artifactHash: meta.wasm?.hashSha256 ?? meta.jsModule?.hashSha256 ?? "",
    },
    timingsMs: {
      fetch: loaded.timings.fetchMs,
      compile: loaded.timings.compileMs,
      instantiate: loaded.timings.instantiateMs,
      initTotal: loaded.timings.initTotalMs,
      firstCall: measure.firstCallMs,
      warmMedian: stats.median,
      warmP95: stats.p95,
      warmP99: stats.p99,
      warmStddev: stats.stddev,
      warmMin: stats.min,
      warmMax: stats.max,
      endToEndMedian: loaded.timings.initTotalMs + measure.firstCallMs + stats.median,
    },
    memory: {
      wasmMemoryBytesPeak: memAfter,
      wasmMemoryDeltaBytes: memAfter - memBefore,
      jsHeapUsedAfter: process.memoryUsage().heapUsed,
    },
    stats: { nSamples: stats.n, cv: stats.cv, noisy: stats.cv > input.measureConfig.cvThreshold },
    quality: {
      checksum: measure.finalChecksum,
      validated: !measure.correctnessFailed,
      correctnessFailed: measure.correctnessFailed,
    },
    notes: { streamingInstantiation: false, worker: false, wasmFeatures: ["bulk-memory", "sign-ext"] },
  };

  return BenchResultSchema.parse(result);
}
```

- [ ] **Step 4: Create `apps/runner-node/src/main.ts`**

```ts
import { argv, exit } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCase } from "./run-case.js";
import type { Language, Toolchain, Profile, InputSize } from "@bench/result-schema";

interface CliArgs {
  benchmark: string;
  language: Language;
  toolchain: Toolchain;
  profile: Profile;
  size: InputSize;
  outDir: string;
  mode: "quick" | "eval";
}

function parse(argv: string[]): CliArgs {
  const get = (name: string) => {
    const v = argv.find((a) => a.startsWith(`--${name}=`));
    if (!v) throw new Error(`missing --${name}`);
    return v.slice(name.length + 3);
  };
  return {
    benchmark: get("benchmark"),
    language: get("language") as Language,
    toolchain: get("toolchain") as Toolchain,
    profile: get("profile") as Profile,
    size: get("size") as InputSize,
    outDir: get("out"),
    mode: get("mode") as "quick" | "eval",
  };
}

async function main() {
  const a = parse(argv.slice(2));
  const config = a.mode === "quick"
    ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 10, cvThreshold: 0.05 }
    : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 };
  const r = await runCase({
    benchmarkId: a.benchmark,
    language: a.language,
    toolchain: a.toolchain,
    profile: a.profile,
    inputSize: a.size,
    measureConfig: config,
  });
  await mkdir(a.outDir, { recursive: true });
  const fname = `${a.benchmark}__${a.language}-${a.toolchain}-${a.profile}__${a.size}__node.json`;
  await writeFile(join(a.outDir, fname), JSON.stringify(r, null, 2));
  console.log(`wrote ${join(a.outDir, fname)}`);
}

main().catch((e) => { console.error(e); exit(1); });
```

- [ ] **Step 5: Smoke-run on JS variant**

Run: `pnpm exec tsx apps/runner-node/src/main.ts --benchmark=matmul --language=js --toolchain=typed-array --profile=speed --size=S --out=results/raw/smoke --mode=quick`
Expected: writes `results/raw/smoke/matmul__js-typed-array-speed__S__node.json`. Open it: `validated: true`, non-zero `warmMedian`.

- [ ] **Step 6: Commit**

```bash
git add apps/runner-node/
git commit -m "feat(runner-node): drive a single (workload, lang, toolchain, profile, size) case"
```

---

### Task 23: `apps/runner-web` — Vite + Worker + Playwright driver

**Files:**
- Create: `apps/runner-web/package.json`
- Create: `apps/runner-web/tsconfig.json`
- Create: `apps/runner-web/vite.config.ts`
- Create: `apps/runner-web/playwright.config.ts`
- Create: `apps/runner-web/index.html`
- Create: `apps/runner-web/src/page.ts`
- Create: `apps/runner-web/src/worker.ts`
- Create: `apps/runner-web/src/driver.ts`
- Create: `apps/runner-web/public/.gitkeep`

- [ ] **Step 1: Create `apps/runner-web/package.json`**

```json
{
  "name": "@bench-app/runner-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "dev": "vite",
    "build": "vite build",
    "drive": "tsx src/driver.ts"
  },
  "dependencies": {
    "@bench/harness": "workspace:*",
    "@bench/loaders": "workspace:*",
    "@bench/result-schema": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.3",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/runner-web/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*"] }
```

- [ ] **Step 3: Create `apps/runner-web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, "../../dist"), // serve dist/ alongside the page so /matmul/<...>/module.wasm works
  server: { port: 5174, fs: { allow: [resolve(__dirname, "../..")] } },
  build: { target: "es2022" },
  worker: { format: "es" },
});
```

- [ ] **Step 4: Create `apps/runner-web/index.html`**

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>bench-runner</title></head>
<body>
<div id="status">idle</div>
<script type="module" src="/src/page.ts"></script>
</body>
</html>
```

- [ ] **Step 5: Create `apps/runner-web/src/worker.ts`**

```ts
import { runMeasure, computeStats, type MeasureConfig } from "@bench/harness";
import { plainJsLoader, rawWasmLoader, rustBindgenLoader, emscriptenLoader, type Loader } from "@bench/loaders";
import type { Language, Toolchain, InputSize, Profile, BenchResult } from "@bench/result-schema";
import { SCHEMA_VERSION } from "@bench/result-schema";

interface WorkerInput {
  benchmarkId: string;
  language: Language;
  toolchain: Toolchain;
  profile: Profile;
  inputSize: InputSize;
  measureConfig: MeasureConfig;
  fixture: Uint8Array;
  expectedChecksum: number | string;
  fixtureSha256: string;
  meta: any; // ArtifactMeta passthrough
  artifactUrl: string;
  glueUrl?: string;
  envName: string;
}

function pickLoader(lang: Language, tc: Toolchain): Loader {
  if (lang === "js") return plainJsLoader;
  if (lang === "rust" && tc === "raw") return rawWasmLoader;
  if (lang === "rust" && tc === "bindgen") return rustBindgenLoader;
  if (lang === "cpp" && tc === "emscripten") return emscriptenLoader;
  if (lang === "cpp" && tc === "wasi-sdk") return rawWasmLoader;
  throw new Error(`no loader for ${lang}/${tc}`);
}

self.addEventListener("message", async (e: MessageEvent<WorkerInput>) => {
  const i = e.data;
  try {
    const loader = pickLoader(i.language, i.toolchain);
    const loaded = await loader.load({ artifactUrl: i.artifactUrl, glueUrl: i.glueUrl });
    const memBefore = loaded.memoryRef?.buffer.byteLength ?? 0;
    const measure = await runMeasure({
      module: loaded.module,
      fixture: i.fixture,
      expectedChecksum: i.expectedChecksum,
      config: i.measureConfig,
    });
    const memAfter = loaded.memoryRef?.buffer.byteLength ?? 0;
    const stats = measure.warmSamplesMs.length > 0
      ? computeStats(measure.warmSamplesMs)
      : { median: 0, p95: 0, p99: 0, stddev: 0, min: 0, max: 0, mean: 0, cv: 0, n: 0 };

    const result: BenchResult = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      machine: { os: "browser", cpu: "browser", memoryGb: 0 }, // filled by driver
      env: { kind: "browser", name: i.envName, version: navigator.userAgent, engine: "?" },
      benchmark: {
        id: i.benchmarkId, inputSize: i.inputSize,
        fixtureBytes: i.fixture.byteLength, fixtureSha256: i.fixtureSha256,
        language: i.language, toolchain: i.toolchain, profile: i.profile,
        postprocess: i.meta.toolchainVersions["wasm-opt"] ? ["wasm-opt"] : [],
      },
      artifacts: {
        wasmRawBytes: i.meta.wasm?.rawBytes ?? 0,
        wasmGzipBytes: i.meta.wasm?.gzipBytes ?? 0,
        wasmBrotliBytes: i.meta.wasm?.brotliBytes ?? 0,
        jsGlueRawBytes: i.meta.jsGlue?.rawBytes ?? 0,
        jsGlueGzipBytes: i.meta.jsGlue?.gzipBytes ?? 0,
        totalTransferGzipBytes: i.meta.totalTransferGzipBytes ?? 0,
        artifactHash: i.meta.wasm?.hashSha256 ?? i.meta.jsModule?.hashSha256 ?? "",
      },
      timingsMs: {
        fetch: loaded.timings.fetchMs,
        compile: loaded.timings.compileMs,
        instantiate: loaded.timings.instantiateMs,
        initTotal: loaded.timings.initTotalMs,
        firstCall: measure.firstCallMs,
        warmMedian: stats.median, warmP95: stats.p95, warmP99: stats.p99,
        warmStddev: stats.stddev, warmMin: stats.min, warmMax: stats.max,
        endToEndMedian: loaded.timings.initTotalMs + measure.firstCallMs + stats.median,
      },
      memory: {
        wasmMemoryBytesPeak: memAfter,
        wasmMemoryDeltaBytes: memAfter - memBefore,
        jsHeapUsedAfter: null,
      },
      stats: { nSamples: stats.n, cv: stats.cv, noisy: stats.cv > i.measureConfig.cvThreshold },
      quality: {
        checksum: measure.finalChecksum, validated: !measure.correctnessFailed,
        correctnessFailed: measure.correctnessFailed,
      },
      notes: { streamingInstantiation: false, worker: true, wasmFeatures: ["bulk-memory", "sign-ext"] },
    };
    (self as any).postMessage({ ok: true, result });
  } catch (err) {
    (self as any).postMessage({ ok: false, error: String(err) });
  }
});
```

- [ ] **Step 6: Create `apps/runner-web/src/page.ts`**

```ts
const status = document.getElementById("status")!;
const url = new URL(location.href);
const params = url.searchParams;

async function main() {
  // Driver passes the case as a base64-encoded JSON in `?case=...`.
  const caseB64 = params.get("case");
  if (!caseB64) { status.textContent = "no case"; return; }
  const caseJson = JSON.parse(atob(caseB64));

  // Fetch fixture + meta from /dist (publicDir).
  const fixtureRes = await fetch(`/${caseJson.benchmarkId}/fixtures/${caseJson.inputSize.toLowerCase()}.bin`);
  // Note: fixtures live in benches/, not dist/. Use a separate /fixtures/ alias.
  // Vite config below maps /fixtures to benches/<id>/fixtures.
  const fixtureBuf = new Uint8Array(await fixtureRes.arrayBuffer());

  const distPrefix = `/${caseJson.benchmarkId}/${caseJson.language}-${caseJson.toolchain}-${caseJson.profile}`;
  const metaRes = await fetch(`${distPrefix}/meta.json`);
  const meta = await metaRes.json();

  let artifactUrl: string;
  let glueUrl: string | undefined;
  if (caseJson.language === "js") {
    artifactUrl = new URL(`${distPrefix}/module.js`, location.origin).href;
  } else if (caseJson.toolchain === "bindgen") {
    artifactUrl = new URL(`${distPrefix}/module.wasm`, location.origin).href;
    glueUrl = new URL(`${distPrefix}/glue.js`, location.origin).href;
  } else if (caseJson.toolchain === "emscripten") {
    artifactUrl = new URL(`${distPrefix}/module.wasm`, location.origin).href;
    glueUrl = new URL(`${distPrefix}/glue.mjs`, location.origin).href;
  } else {
    artifactUrl = new URL(`${distPrefix}/module.wasm`, location.origin).href;
  }

  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.postMessage({
    ...caseJson,
    fixture: fixtureBuf,
    meta,
    artifactUrl,
    glueUrl,
  });
  w.onmessage = (e) => {
    status.textContent = "done";
    (window as any).__BENCH_RESULT = e.data;
  };
}

main().catch((e) => { status.textContent = `error: ${e.message}`; });
```

- [ ] **Step 7: Update `vite.config.ts` with the `/fixtures/` alias**

Replace the file with:

```ts
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, "../../dist"),
  server: {
    port: 5174,
    fs: { allow: [resolve(__dirname, "../..")] },
    middlewareMode: false,
  },
  build: { target: "es2022" },
  worker: { format: "es" },
  resolve: { alias: {} },
});
```

Then add a small custom plugin to map `/fixtures/<id>/*` to `benches/<id>/fixtures/*`. For Phase 1 simpler: copy `benches/<id>/fixtures/*.bin` into `dist/<id>/fixtures/` during build orchestration.

Update `scripts/build-all.ts` to add a step after fixtures generation:

```ts
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";

// After generate.ts:
const benches = ["matmul"];
for (const id of benches) {
  const src = `benches/${id}/fixtures`;
  const dst = `dist/${id}/fixtures`;
  await mkdir(dst, { recursive: true });
  for (const sz of ["s", "m", "l"]) {
    await copyFile(join(src, `${sz}.bin`), join(dst, `${sz}.bin`));
  }
}
```

And in `page.ts` change the fixture fetch to `${distPrefix}/../fixtures/${caseJson.inputSize.toLowerCase()}.bin` — i.e., `/matmul/fixtures/s.bin`.

- [ ] **Step 8: Create `apps/runner-web/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "src",
  use: { headless: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox",  use: { browserName: "firefox" } },
  ],
  webServer: {
    command: "pnpm dev",
    port: 5174,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 9: Create `apps/runner-web/src/driver.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { argv } from "node:process";
import { join } from "node:path";
import { chromium, firefox, type Browser } from "playwright";
import type { Language, Toolchain, Profile, InputSize, BenchResult } from "@bench/result-schema";

interface CliArgs {
  benchmark: string;
  language: Language;
  toolchain: Toolchain;
  profile: Profile;
  size: InputSize;
  browser: "chromium" | "firefox";
  outDir: string;
  mode: "quick" | "eval";
}

function parse(argv: string[]): CliArgs {
  const get = (name: string) => {
    const v = argv.find((a) => a.startsWith(`--${name}=`));
    if (!v) throw new Error(`missing --${name}`);
    return v.slice(name.length + 3);
  };
  return {
    benchmark: get("benchmark"),
    language: get("language") as Language,
    toolchain: get("toolchain") as Toolchain,
    profile: get("profile") as Profile,
    size: get("size") as InputSize,
    browser: get("browser") as "chromium" | "firefox",
    outDir: get("out"),
    mode: get("mode") as "quick" | "eval",
  };
}

async function main() {
  const a = parse(argv.slice(2));
  const config = a.mode === "quick"
    ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 10, cvThreshold: 0.05 }
    : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 };

  const caseObj = {
    benchmarkId: a.benchmark,
    language: a.language,
    toolchain: a.toolchain,
    profile: a.profile,
    inputSize: a.size,
    measureConfig: config,
    fixtureSha256: "", // page.ts can read from meta if needed
    expectedChecksum: 0, // overridden via spec.json on page side; for now pass via URL
    envName: a.browser,
  };
  // Driver should also pre-load expectedChecksum from spec.json.
  // For simplicity in Phase 1: page.ts reads spec.json from dist.

  const launcher = a.browser === "chromium" ? chromium : firefox;
  const browser: Browser = await launcher.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const url = `http://localhost:5174/?case=${btoa(JSON.stringify(caseObj))}`;
  await page.goto(url);
  await page.waitForFunction("(window as any).__BENCH_RESULT !== undefined", null, { timeout: 5 * 60 * 1000 });
  const wire = await page.evaluate("(window as any).__BENCH_RESULT") as { ok: boolean; result?: BenchResult; error?: string };

  await browser.close();

  if (!wire.ok || !wire.result) throw new Error(`browser run failed: ${wire.error}`);

  // Patch machine info from process side.
  const result = {
    ...wire.result,
    machine: {
      os: `${process.platform} ${process.arch}`,
      cpu: process.env.MACHINE_CPU ?? "unknown",
      memoryGb: Math.round(require("node:os").totalmem() / (1024 ** 3)),
    },
  };

  await mkdir(a.outDir, { recursive: true });
  const fname = `${a.benchmark}__${a.language}-${a.toolchain}-${a.profile}__${a.size}__${a.browser}.json`;
  await writeFile(join(a.outDir, fname), JSON.stringify(result, null, 2));
  console.log(`wrote ${join(a.outDir, fname)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 10: Update `page.ts` to load spec.json for `expectedChecksum`**

Replace the lines around the worker.postMessage:

```ts
const specRes = await fetch(`/${caseJson.benchmarkId}/spec.json`);
const spec = await specRes.json();
const expectedChecksum = spec.inputSizes[caseJson.inputSize].expectedChecksum;
const fixtureSha256 = spec.inputSizes[caseJson.inputSize].fixtureSha256;
// ...
w.postMessage({ ...caseJson, fixture: fixtureBuf, meta, artifactUrl, glueUrl,
  expectedChecksum, fixtureSha256 });
```

And copy `benches/<id>/spec.json` into `dist/<id>/spec.json` during `build-all.ts`.

- [ ] **Step 11: Install playwright browsers**

Run: `pnpm exec playwright install chromium firefox`
Expected: downloads browsers (~200MB).

- [ ] **Step 12: Smoke-run a single browser case**

Run: `pnpm --filter @bench-app/runner-web dev` (in another terminal)
Then: `pnpm --filter @bench-app/runner-web drive -- --benchmark=matmul --language=js --toolchain=typed-array --profile=speed --size=S --browser=chromium --out=results/raw/smoke --mode=quick`
Expected: writes JSON, `validated: true`.

- [ ] **Step 13: Commit**

```bash
git add apps/runner-web/
git commit -m "feat(runner-web): vite page + worker + playwright driver for browser cases"
```

---

### Task 24: `scripts/run-matrix.ts` — drive the full matrix

**Files:**
- Create: `scripts/run-matrix.ts`

- [ ] **Step 1: Create `scripts/run-matrix.ts`**

```ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ALL_COMBINATIONS } from "./lib/matrix.js";
import { run } from "./lib/exec.js";

interface CliArgs {
  envs: ("node" | "chromium" | "firefox")[];
  sizes: ("S" | "M" | "L")[];
  mode: "quick" | "eval";
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string, def?: string) => {
    const v = argv.find((a) => a.startsWith(`--${name}=`));
    return v ? v.slice(name.length + 3) : def;
  };
  return {
    envs: (get("envs", "node,chromium,firefox") as string).split(",") as any,
    sizes: (get("sizes", "S,M") as string).split(",") as any,
    mode: (get("mode", "eval") as string) as "quick" | "eval",
    out: get("out", `results/raw/${new Date().toISOString().replace(/[:.]/g, "-")}`)!,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });

  let needWebServer = args.envs.some((e) => e !== "node");
  let serverProc: any = null;
  if (needWebServer) {
    const { execa } = await import("execa");
    serverProc = execa("pnpm", ["--filter", "@bench-app/runner-web", "dev"], { stdio: "inherit", detached: false });
    // Wait until port 5174 is up.
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch("http://localhost:5174/");
        if (r.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  try {
    for (const c of ALL_COMBINATIONS) {
      for (const sz of args.sizes) {
        for (const env of args.envs) {
          if (env === "node") {
            await run("tsx", [
              "apps/runner-node/src/main.ts",
              `--benchmark=${c.benchmarkId}`,
              `--language=${c.language}`,
              `--toolchain=${c.toolchain}`,
              `--profile=${c.profile}`,
              `--size=${sz}`,
              `--out=${args.out}`,
              `--mode=${args.mode}`,
            ]);
          } else {
            await run("tsx", [
              "apps/runner-web/src/driver.ts",
              `--benchmark=${c.benchmarkId}`,
              `--language=${c.language}`,
              `--toolchain=${c.toolchain}`,
              `--profile=${c.profile}`,
              `--size=${sz}`,
              `--browser=${env}`,
              `--out=${args.out}`,
              `--mode=${args.mode}`,
            ]);
          }
        }
      }
    }
  } finally {
    if (serverProc) serverProc.kill("SIGTERM");
  }

  console.log(`results in ${args.out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the matrix in `quick` mode**

Run: `pnpm bench --envs=node --sizes=S --mode=quick --out=results/raw/quick`
Expected: 10 JSON files (one per combination, S only, node only).

- [ ] **Step 3: Run a single browser smoke**

Run: `pnpm bench --envs=chromium --sizes=S --mode=quick --out=results/raw/quick-chromium`
Expected: 10 JSON files for chromium.

- [ ] **Step 4: Commit**

```bash
git add scripts/run-matrix.ts
git commit -m "feat(scripts): orchestrate full matrix across node + browsers"
```

---

### Task 25: `reporter` package — aggregate JSONs

**Files:**
- Create: `packages/reporter/package.json`
- Create: `packages/reporter/tsconfig.json`
- Create: `packages/reporter/src/aggregate.ts`
- Create: `packages/reporter/src/index.ts`
- Create: `packages/reporter/tests/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reporter/tests/aggregate.test.ts
import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(over: Partial<BenchResult["benchmark"]>, warmMedian: number, wasmRaw: number): BenchResult {
  return {
    schemaVersion: 1, timestamp: "2026-05-01T00:00:00.000Z",
    machine: { os: "linux", cpu: "x", memoryGb: 32 },
    env: { kind: "node", name: "node", version: "v22.0.0", engine: "V8" },
    benchmark: { id: "matmul", inputSize: "S", fixtureBytes: 0, fixtureSha256: "x".repeat(64),
                 language: "js", toolchain: "idiomatic", profile: "speed", postprocess: [], ...over },
    artifacts: { wasmRawBytes: wasmRaw, wasmGzipBytes: 0, wasmBrotliBytes: 0,
                 jsGlueRawBytes: 0, jsGlueGzipBytes: 0, totalTransferGzipBytes: 0, artifactHash: "" },
    timingsMs: { fetch: 0, compile: 0, instantiate: 0, initTotal: 0, firstCall: 0,
                 warmMedian, warmP95: warmMedian, warmP99: warmMedian, warmStddev: 0,
                 warmMin: warmMedian, warmMax: warmMedian, endToEndMedian: warmMedian },
    memory: { wasmMemoryBytesPeak: 0, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
    stats: { nSamples: 30, cv: 0.01, noisy: false },
    quality: { checksum: 0, validated: true, correctnessFailed: false },
    notes: { streamingInstantiation: false, worker: true, wasmFeatures: [] },
  };
}

describe("aggregate", () => {
  it("groups results by benchmark and indexes by env+lang+toolchain+profile+size", () => {
    const results = [
      fakeResult({ language: "js", toolchain: "idiomatic" }, 10, 0),
      fakeResult({ language: "rust", toolchain: "raw", profile: "size" }, 5, 1234),
    ];
    const agg = aggregate(results);
    expect(Object.keys(agg.benchmarks)).toEqual(["matmul"]);
    const m = agg.benchmarks.matmul!;
    expect(m.cases.length).toBe(2);
  });
});
```

- [ ] **Step 2: Create `packages/reporter/package.json`**

```json
{
  "name": "@bench/reporter",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@bench/result-schema": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^3.0.0" }
}
```

- [ ] **Step 3: Create `packages/reporter/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*", "tests/**/*"] }
```

- [ ] **Step 4: Create `packages/reporter/src/aggregate.ts`**

```ts
import type { BenchResult } from "@bench/result-schema";

export interface AggregatedCase {
  result: BenchResult;
  key: string; // env|lang|toolchain|profile|size
}

export interface AggregatedBenchmark {
  id: string;
  cases: AggregatedCase[];
}

export interface Aggregated {
  generatedAt: string;
  benchmarks: Record<string, AggregatedBenchmark>;
}

export function aggregate(results: readonly BenchResult[]): Aggregated {
  const out: Aggregated = { generatedAt: new Date().toISOString(), benchmarks: {} };
  for (const r of results) {
    const id = r.benchmark.id;
    const b = out.benchmarks[id] ??= { id, cases: [] };
    const key = [r.env.name, r.benchmark.language, r.benchmark.toolchain, r.benchmark.profile, r.benchmark.inputSize].join("|");
    b.cases.push({ result: r, key });
  }
  return out;
}
```

- [ ] **Step 5: Create `packages/reporter/src/index.ts`**

```ts
export * from "./aggregate.js";
export * from "./render.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @bench/reporter test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/reporter/
git commit -m "feat(reporter): aggregate raw JSONs by benchmark"
```

---

### Task 26: `reporter` — render to HTML

**Files:**
- Create: `packages/reporter/src/render.ts`
- Create: `packages/reporter/tests/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/reporter/tests/render.test.ts
import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import { renderHtml } from "../src/render.js";
import type { BenchResult } from "@bench/result-schema";

function fakeResult(): BenchResult {
  return {
    schemaVersion: 1, timestamp: "2026-05-01T00:00:00.000Z",
    machine: { os: "linux", cpu: "x", memoryGb: 32 },
    env: { kind: "node", name: "node", version: "v22.0.0", engine: "V8" },
    benchmark: { id: "matmul", inputSize: "S", fixtureBytes: 0, fixtureSha256: "x".repeat(64),
                 language: "js", toolchain: "idiomatic", profile: "speed", postprocess: [] },
    artifacts: { wasmRawBytes: 0, wasmGzipBytes: 0, wasmBrotliBytes: 0,
                 jsGlueRawBytes: 0, jsGlueGzipBytes: 0, totalTransferGzipBytes: 1234, artifactHash: "" },
    timingsMs: { fetch: 0, compile: 0, instantiate: 0, initTotal: 0, firstCall: 0,
                 warmMedian: 1.2345, warmP95: 1.5, warmP99: 1.7, warmStddev: 0.05,
                 warmMin: 1.1, warmMax: 1.7, endToEndMedian: 1.2345 },
    memory: { wasmMemoryBytesPeak: 0, wasmMemoryDeltaBytes: 0, jsHeapUsedAfter: null },
    stats: { nSamples: 30, cv: 0.01, noisy: false },
    quality: { checksum: 0, validated: true, correctnessFailed: false },
    notes: { streamingInstantiation: false, worker: true, wasmFeatures: [] },
  };
}

describe("renderHtml", () => {
  it("produces non-empty HTML containing the benchmark id and warmMedian", () => {
    const html = renderHtml(aggregate([fakeResult()]));
    expect(html).toContain("matmul");
    expect(html).toContain("1.235"); // warmMedian to 3 decimals
    expect(html).toContain("1234");  // totalTransferGzipBytes
  });
});
```

- [ ] **Step 2: Create `packages/reporter/src/render.ts`**

```ts
import type { Aggregated, AggregatedBenchmark } from "./aggregate.js";
import type { BenchResult } from "@bench/result-schema";

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderRow(r: BenchResult): string {
  const noisyClass = r.stats.noisy ? "noisy" : "";
  const failClass = r.quality.correctnessFailed ? "fail" : "";
  const cls = [noisyClass, failClass].filter(Boolean).join(" ");
  return `<tr class="${cls}">
    <td>${escape(r.env.name)}</td>
    <td>${escape(r.benchmark.language)}/${escape(r.benchmark.toolchain)}/${escape(r.benchmark.profile)}</td>
    <td>${escape(r.benchmark.inputSize)}</td>
    <td>${r.artifacts.wasmRawBytes || "—"}</td>
    <td>${r.artifacts.wasmGzipBytes || "—"}</td>
    <td>${r.artifacts.totalTransferGzipBytes}</td>
    <td>${r.timingsMs.initTotal.toFixed(3)}</td>
    <td>${r.timingsMs.firstCall.toFixed(3)}</td>
    <td>${r.timingsMs.warmMedian.toFixed(3)}</td>
    <td>${r.timingsMs.warmP95.toFixed(3)}</td>
    <td>${r.stats.cv.toFixed(3)}</td>
    <td>${r.quality.validated ? "✓" : "✗"}</td>
  </tr>`;
}

function renderBenchmark(b: AggregatedBenchmark): string {
  const rows = b.cases.map((c) => renderRow(c.result)).join("\n");
  return `<section>
    <h2>${escape(b.id)}</h2>
    <table>
      <thead><tr>
        <th>env</th><th>impl</th><th>size</th>
        <th>wasm raw</th><th>wasm gz</th><th>total gz</th>
        <th>init</th><th>first</th>
        <th>warm med (ms)</th><th>warm p95 (ms)</th><th>cv</th><th>ok</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

export function renderHtml(agg: Aggregated): string {
  const sections = Object.values(agg.benchmarks).map(renderBenchmark).join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>bench results</title>
<style>
  body { font-family: ui-monospace, monospace; max-width: 1400px; margin: 1em auto; padding: 0 1em; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: right; }
  th { background: #f0f0f0; }
  tr.noisy { background: #fff8d0; }
  tr.fail  { background: #ffd0d0; }
  td:first-child, td:nth-child(2), td:nth-child(3) { text-align: left; }
</style></head>
<body>
<h1>wasm-rust-cpp-js results</h1>
<p>Generated ${escape(agg.generatedAt)}.</p>
${sections}
</body></html>`;
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @bench/reporter test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/reporter/
git commit -m "feat(reporter): render aggregated results to static HTML"
```

---

### Task 27: `scripts/report.ts` — read raw, write summarized

**Files:**
- Create: `scripts/report.ts`
- Modify: root `package.json` to add `"report"` script

- [ ] **Step 1: Create `scripts/report.ts`**

```ts
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { aggregate, renderHtml } from "@bench/reporter";
import { BenchResultSchema } from "@bench/result-schema";

async function newest(dir: string): Promise<string> {
  const entries = await readdir(dir);
  let best: { name: string; mtimeMs: number } | null = null;
  for (const e of entries) {
    const s = await stat(join(dir, e));
    if (s.isDirectory() && (!best || s.mtimeMs > best.mtimeMs)) best = { name: e, mtimeMs: s.mtimeMs };
  }
  if (!best) throw new Error(`no result dirs in ${dir}`);
  return join(dir, best.name);
}

async function main() {
  const inDir = process.argv.find((a) => a.startsWith("--in="))?.slice(5) ?? await newest("results/raw");
  const outDir = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ??
    `results/summarized/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(inDir)).filter((f) => f.endsWith(".json"));
  const results = await Promise.all(files.map(async (f) => {
    const buf = await readFile(join(inDir, f), "utf8");
    return BenchResultSchema.parse(JSON.parse(buf));
  }));
  const html = renderHtml(aggregate(results));
  const outFile = join(outDir, "index.html");
  await writeFile(outFile, html);
  console.log(`report -> ${outFile} (${results.length} results)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add `report` to root `package.json` scripts**

In `scripts` section add:

```json
"report": "tsx scripts/report.ts"
```

Also add `@bench/reporter` and `@bench/result-schema` as devDeps:

Run: `pnpm add -Dw @bench/reporter@workspace:* @bench/result-schema@workspace:*`

- [ ] **Step 3: Run end-to-end and verify**

```bash
pnpm bench --envs=node --sizes=S --mode=quick --out=results/raw/quick
pnpm report --in=results/raw/quick
```

Expected: a fresh dir under `results/summarized/...` containing `index.html`. Open it in a browser; table has 10 rows.

- [ ] **Step 4: Commit**

```bash
git add scripts/report.ts package.json pnpm-lock.yaml
git commit -m "feat(scripts): generate HTML report from raw JSONs"
```

---

### Task 28: `scripts/smoke.ts` — pre-flight check

**Files:**
- Create: `scripts/smoke.ts`

- [ ] **Step 1: Create `scripts/smoke.ts`**

```ts
import { run } from "./lib/exec.js";

async function main() {
  const out = "results/raw/_smoke";
  await run("tsx", ["scripts/run-matrix.ts", "--envs=node", "--sizes=S", "--mode=quick", `--out=${out}`]);
  await run("tsx", ["scripts/report.ts", `--in=${out}`, "--out=results/summarized/_smoke"]);
  console.log("smoke OK");
}

main().catch((e) => { console.error("smoke FAILED:", e); process.exit(1); });
```

- [ ] **Step 2: Run smoke**

Run: `pnpm smoke`
Expected: builds `results/summarized/_smoke/index.html`, prints "smoke OK".

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.ts
git commit -m "feat(scripts): add smoke target (S-size matmul, node only)"
```

---

### Task 29: End-to-end run on full Phase 1.0 matrix

This is integration verification, not new code.

- [ ] **Step 1: Clean previous artifacts**

Run: `rm -rf dist results`
Expected: clean state.

- [ ] **Step 2: Build everything**

Run: `pnpm build:all`
Expected: 10 directories under `dist/matmul/`, each with `meta.json`. Sizes look reasonable:
- JS: ~2-5 KB minified
- Rust raw speed: 5-15 KB; size: smaller
- Rust bindgen speed: 20-100 KB wasm + 10-30 KB glue
- C++ Emscripten speed: 30-100 KB wasm + ~30 KB glue
- C++ wasi-sdk freestanding: 5-15 KB; size profile smaller still

Numbers depend heavily on toolchain versions; the exact values aren't validated, just reviewed for sanity.

- [ ] **Step 3: Run quick mode on full matrix**

Run: `pnpm bench --envs=node,chromium,firefox --sizes=S,M --mode=quick --out=results/raw/phase-1-0-quick`
Expected: ~60 JSON files (10 combos × 2 sizes × 3 envs).

- [ ] **Step 4: Generate report**

Run: `pnpm report --in=results/raw/phase-1-0-quick`
Expected: HTML with all rows. No row should have `correctnessFailed`. Yellow `noisy` rows are acceptable in `quick` mode.

- [ ] **Step 5: Eyeball the report**

Open `results/summarized/<latest>/index.html` in a browser. Check:
- All 60 rows present.
- All `validated: ✓`.
- `warmMedian` increases monotonically with size (S < M).
- `wasmRawBytes` differs across toolchains.
- Browser results not wildly different from node (within ~30% for compute, more variation for `firstCall`).

- [ ] **Step 6: Commit any small fixes from the eyeball pass**

If everything is fine: no commit needed.

If a build script needs tweaking, fix and commit:

```bash
git add <whatever>
git commit -m "fix(<area>): <what>"
```

- [ ] **Step 7: Tag the milestone**

```bash
git tag phase-1-0
```

---

## Phase 1.1 — deferred

The spec describes Phase 1.1 (interop_calls, hashmap_workload, shape_dispatch). It is intentionally **not** included in this plan because:

1. The real interfaces from Phase 1.0 (`BenchModule`, `Loader`, `meta.json` shape, runner contracts) may need adjustment based on what we learned. Hard-coding Phase 1.1 task details now bakes in incorrect assumptions.
2. Each Phase 1.1 workload is structurally similar to matmul — most work is per-implementation, not per-infrastructure. Adding workloads becomes routine after Phase 1.0.

Once Phase 1.0 is tagged, run brainstorming → writing-plans for Phase 1.1, reusing the now-stable infrastructure.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| Repo / monorepo / pnpm workspaces | Task 1 |
| `BenchModule` contract | Task 3, 4 (types + measure) |
| `init` 4-phase split (fetch/compile/instantiate/firstCall) | Task 6, 7, 8, 9 (Loader interface + per-toolchain implementations) |
| Sample loop with CV-based early stop | Task 4 |
| Checksum validation | Task 5 |
| Result JSON schema | Task 2 |
| Size measurement (raw/gzip/brotli) | Task 17 (statArtifact), filled by Tasks 18-20 |
| Tool version pinning | Task 1 (tool-versions.json), Task 17 (detect-actual) |
| Build matrix (Rust × 2 × 2, C++ × 2 × 2, JS × 2) | Tasks 13-16 (bench source) + Tasks 18-20 (build scripts) + Task 17 matrix.ts |
| `wasm-opt -Oz` for size profile | Tasks 19, 20 |
| wasi-sdk freestanding I/O contract (pre-allocated buffers) | Task 10 (spec.json), Task 15 (cpp source uses static heap) |
| Browser runner with Web Worker | Task 23 (vite + worker + playwright) |
| Node runner | Task 22 |
| Reporter (JSON → HTML) | Tasks 25, 26, 27 |
| Smoke test | Task 28 |
| End-to-end Phase 1.0 milestone | Task 29 |
| Phase 1.0 critical-path: `pnpm bench:all` produces HTML | Task 27 + 29 |
| Embind not used in Phase 1 | Task 15 (Emscripten exports plain C, not Embind) |
| `wasm_memory_delta_bytes` (not grow_count) | Task 22 (memBefore/memAfter), Task 23 (worker) |
| MVP wasm features (bulk-memory, sign-ext, non-trapping-fp-to-int) | Task 16 (wasi-sdk uses `-mbulk-memory`); other toolchains default-MVP |

**Placeholder scan:** None remaining.

**Type consistency:**

- `BenchModule.run(iterations)` returns `RunResult` ({checksum, logicalOps?}) — used consistently across measure.ts, all loaders, all impls.
- `eqChecksum` integrated in measure.ts (Task 5 step 5).
- `Loader.load(input: LoaderInput)` returns `LoadedModule` — consistent across all four loaders.
- `meta.json` shape defined in Task 17 (`ArtifactMeta`); read in Tasks 22 and 23.
- Toolchain enum (`idiomatic`, `typed-array`, `raw`, `bindgen`, `emscripten`, `wasi-sdk`) defined in Task 2 schema, used everywhere.
- File path `dist/<benchmarkId>/<lang>-<toolchain>-<profile>/` defined in `distDir()` (Task 17), used by all build scripts.

No mismatches found.
