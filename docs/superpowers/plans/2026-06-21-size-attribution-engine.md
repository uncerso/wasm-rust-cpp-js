# Size Attribution Engine — Implementation Plan (Plan 1/3, Phase 1.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Построить движок, который раскладывает размер каждого wasm-бинаря на facility-категории (allocator / hash-map / string / panic-fmt / observed / …) и пишет это разложение в `meta.json` — на rust-экземплярах (matmul → hashmap_int → hashmap_string), затем cpp/wasi-sdk.

**Architecture:** Новый пакет `packages/size-attr` (чистая логика: facility-реестр + twiggy-JSON-парсер + сборка композиции, TDD-тестируемо). Zod-схема `SizeComposition` в `packages/result-schema` (единый источник схем). Build-скрипты получают name-bearing pre-opt атрибуционный проход (twiggy на STRIP=false-сборке), результат калибруется к точному production-тоталу и пишется в `meta.json`. См. спеку [`2026-06-21-wasm-size-floor-vs-marginal-design.md`](../specs/2026-06-21-wasm-size-floor-vs-marginal-design.md), § Метод / § Faceted taxonomy / § Schema.

**Tech Stack:** TypeScript (vitest, zod, tsx-скрипты), twiggy 0.8.0 (`top -f json`, пинится), cargo (STRIP=false name-bearing сборки в изолированный target-dir), wasi-sdk clang (`-g`).

**Это Plan 1/3 фазы.** Plan 2 = reporter-shell + Size-визуализация; Plan 3 = дифференциал headline-claims + guidelines + README + roadmap. Outline — внизу.

---

## Pre-flight notes (read once)

- **Sandbox:** `pnpm build:*` / любой `tsx` / `cargo build` биндят pipe → запускать с `dangerouslyDisableSandbox: true` (CLAUDE.md § Tooling gotchas). Чистые `pnpm typecheck` / `test` / `lint:*` работают в sandbox.
- **twiggy уже стоит глобально** (0.8.0, `~/.cargo/bin`, с Phase 1.2) → `preferLocal("twiggy")` упадёт на PATH, пайплайн работает сразу; W0 формализует пин.
- **Cargo workspace target** — артефакты в workspace-root `target/`, не per-crate. Name-bearing сборка пишется в **изолированный** `target/attr/` (env `CARGO_TARGET_DIR`), чтобы не затирать production-выход.
- **twiggy = pre-opt композиция, НЕ production-байты** (W0-находка: name-секции меняют wasm-opt). Поэтому доли калибруются к точному production-тоталу; per-facility абсолют помечается приближённым.
- **Commits:** `--no-gpg-sign`. Push/PR — действие пользователя.

---

## Wave 0 — пин twiggy

### Task 0.1: Запинить twiggy + `twiggyPath()` + verify

**Files:**
- Modify: `tool-versions.json` (добавить запись `twiggy` в `tools`)
- Modify: `scripts/lib/tool-paths.ts:25` (добавить `twiggyPath()`)
- Modify: `scripts/lib/setup-tools.ts` (cargo-install twiggy, по образцу wasm-pack)

- [ ] **Step 1: Добавить запись в `tool-versions.json`**

В объект `tools` (рядом с `wasm-pack`) добавить:
```json
    "twiggy": {
      "version": "0.8.0",
      "installVia": "cargo",
      "_note": "Code-size profiler. rustwasm org sunset (2025) → repo AlexEne/twiggy, read-only с 2026-03; core wasm-формат стабилен, при нужде форкаем (MIT/Apache). Pre-opt символьная атрибуция (имена срезаются wasm-opt). cargo install --locked --version 0.8.0 twiggy --root .tools/twiggy-0.8.0."
    }
```

- [ ] **Step 2: Добавить `twiggyPath()` в `tool-paths.ts`**

После `wasmPackPath()` (строка ~27):
```typescript
export function twiggyPath(): string {
    return preferLocal("twiggy");
}
```

- [ ] **Step 3: Интегрировать установку в `setup-tools.ts`**

Открыть `scripts/lib/setup-tools.ts`, найти блок установки `wasm-pack` (поиск `wasm-pack` / `installVia` / `cargo install`). Добавить аналогичный блок для twiggy: `cargo install --locked --version 0.8.0 twiggy --root .tools/twiggy-0.8.0`, затем symlink бинаря в `.tools/bin/twiggy` (тем же helper'ом, что wasm-pack). Вызвать его из основной install-последовательности рядом с wasm-pack.

- [ ] **Step 4: Verify**

```bash
twiggy --version
twiggy top -f json -n 1 packages/result-schema/package.json 2>&1 | head -c 80 || echo "(ok: twiggy reachable; needs a real wasm)"
```
Expected: `twiggy-opt 0.8.0` (или `twiggy 0.8.0`). Второй вызов лишь подтверждает, что бинарь запускается.

- [ ] **Step 5: Commit**

```bash
git add tool-versions.json scripts/lib/tool-paths.ts scripts/lib/setup-tools.ts
git commit --no-gpg-sign -m "build(tools): pin twiggy 0.8.0 for size attribution (W0)"
```

- [ ] **GATE (W0):** `twiggy --version` отвечает. Break-point — доложить.

---

## Wave 1 — движок атрибуции + схема (rust, затем cpp/wasi-sdk)

### Task 1.1: Scaffold пакета `packages/size-attr`

**Files:**
- Create: `packages/size-attr/package.json`
- Create: `packages/size-attr/tsconfig.json`
- Create: `packages/size-attr/src/index.ts`

- [ ] **Step 1: `package.json`** (зеркалит `packages/reporter/package.json`)

```json
{
  "name": "@bench/size-attr",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@bench/result-schema": "workspace:*", "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^3.0.0" }
}
```

- [ ] **Step 2: `tsconfig.json`** (как у result-schema)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: `src/index.ts`** (re-export, заполняется по мере добавления модулей)

```typescript
export * from "./facilities.js";
export * from "./twiggy.js";
export * from "./attribute.js";
```

- [ ] **Step 4: Установить workspace + typecheck**

```bash
pnpm install
pnpm --filter @bench/size-attr typecheck
```
Expected: install ок; typecheck упадёт на отсутствии `./facilities.js` и т.д. — это норма до Task 1.3+ (index.ts заполняем по факту; временно можно закомментировать строки re-export, раскомментируя по мере создания файлов).

- [ ] **Step 5: Commit**

```bash
git add packages/size-attr/package.json packages/size-attr/tsconfig.json packages/size-attr/src/index.ts pnpm-lock.yaml
git commit --no-gpg-sign -m "feat(size-attr): scaffold package (W1)"
```

### Task 1.2: `SizeCompositionSchema` в result-schema

**Files:**
- Create: `packages/result-schema/src/size-composition.ts`
- Modify: `packages/result-schema/src/index.ts` (re-export)
- Test: `packages/result-schema/tests/size-composition.test.ts`

- [ ] **Step 1: Написать падающий тест**

`packages/result-schema/tests/size-composition.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { SizeCompositionSchema } from "../src/index.js";

describe("SizeCompositionSchema", () => {
    it("accepts a valid composition", () => {
        const sample = {
            source: "pre-opt-twiggy",
            productionTotal: { rawBytes: 1639, gzipBytes: 900, brotliBytes: 820 },
            preOptTotalBytes: 1988,
            calibrationFactor: 1639 / 1988,
            unattributedShare: 0.0,
            facilities: [
                { facility: "observed", scaling: "observed", share: 0.52, approxBytes: 852 },
                { facility: "allocator", scaling: "paid-once", share: 0.42, approxBytes: 688 },
            ],
        };
        expect(() => SizeCompositionSchema.parse(sample)).not.toThrow();
    });

    it("rejects a share outside [0,1]", () => {
        const bad = {
            source: "pre-opt-twiggy",
            productionTotal: { rawBytes: 1, gzipBytes: 1, brotliBytes: 1 },
            preOptTotalBytes: 1, calibrationFactor: 1, unattributedShare: 0,
            facilities: [{ facility: "x", scaling: "paid-once", share: 2, approxBytes: 1 }],
        };
        expect(() => SizeCompositionSchema.parse(bad)).toThrow();
    });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm --filter @bench/result-schema test`
Expected: FAIL — `SizeCompositionSchema` не экспортирован.

- [ ] **Step 3: Реализовать схему**

`packages/result-schema/src/size-composition.ts`:
```typescript
import { z } from "zod";

export const ScalingKindSchema = z.enum(["paid-once", "per-type", "observed"]);

export const FacilityShareSchema = z.object({
    facility: z.string().min(1),
    scaling: ScalingKindSchema,
    share: z.number().min(0).max(1),
    approxBytes: z.number().int().nonnegative(),
});

export const SizeCompositionSchema = z.object({
    source: z.literal("pre-opt-twiggy"),
    productionTotal: z.object({
        rawBytes: z.number().int().nonnegative(),
        gzipBytes: z.number().int().nonnegative(),
        brotliBytes: z.number().int().nonnegative(),
    }),
    preOptTotalBytes: z.number().int().nonnegative(),
    calibrationFactor: z.number().positive(),
    unattributedShare: z.number().min(0).max(1),
    facilities: z.array(FacilityShareSchema),
});

export type ScalingKind = z.infer<typeof ScalingKindSchema>;
export type FacilityShare = z.infer<typeof FacilityShareSchema>;
export type SizeComposition = z.infer<typeof SizeCompositionSchema>;
```

- [ ] **Step 4: Re-export в `src/index.ts`**

Добавить строку: `export * from "./size-composition.js";`

- [ ] **Step 5: Run — pass**

Run: `pnpm --filter @bench/result-schema test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/result-schema/src/size-composition.ts packages/result-schema/src/index.ts packages/result-schema/tests/size-composition.test.ts
git commit --no-gpg-sign -m "feat(result-schema): SizeComposition schema (W1)"
```

### Task 1.3: Facility-реестр + `categorize()`

**Files:**
- Create: `packages/size-attr/src/facilities.ts`
- Test: `packages/size-attr/tests/facilities.test.ts`

- [ ] **Step 1: Написать падающий тест** (кейсы из W0-зонда)

`packages/size-attr/tests/facilities.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { categorize, type CategorizeCtx } from "../src/facilities.js";

const ctx: CategorizeCtx = { exportNames: new Set(["matmul", "load_input"]), workloadPrefixes: ["matmul_shared::"] };

describe("categorize", () => {
    it("buckets allocator symbols", () => {
        expect(categorize("dlmalloc", ctx).facility).toBe("allocator");
        expect(categorize("__rust_alloc", ctx).facility).toBe("allocator");
        expect(categorize("operator new(unsigned long)", ctx).facility).toBe("allocator");
    });
    it("buckets hash-map (SipHash/RandomState/libc++)", () => {
        expect(categorize("std::collections::hash::map::RandomState::new", ctx).facility).toBe("hash-map");
        expect(categorize("std::__2::__hash_table<...>::__rehash", ctx).facility).toBe("hash-map");
    });
    it("buckets string separately from hash-map", () => {
        expect(categorize("alloc::string::String::from_utf8", ctx).facility).toBe("string");
        expect(categorize("std::__2::basic_string<...>::__init", ctx).facility).toBe("string");
    });
    it("buckets panic/fmt", () => {
        expect(categorize("core::panicking::panic", ctx).facility).toBe("panic-fmt");
        expect(categorize("__cxa_throw", ctx).facility).toBe("panic-fmt");
    });
    it("buckets toolchain-runtime (RandomState lazy init)", () => {
        expect(categorize("std::thread::local::LocalKey<T>::with", ctx).facility).toBe("toolchain-runtime");
        expect(categorize("<std::sync::LazyLock<T,F> as Deref>::deref", ctx).facility).toBe("toolchain-runtime");
    });
    it("marks observed by export name / workload prefix", () => {
        expect(categorize("matmul", ctx)).toEqual({ facility: "observed", scaling: "observed" });
        expect(categorize("matmul_shared::matmul_naive", ctx).facility).toBe("observed");
    });
    it("falls through to unattributed", () => {
        expect(categorize("something::totally::unknown", ctx).facility).toBe("unattributed");
    });
    it("excludes non-prod meta rows", () => {
        expect(categorize('custom section ".debug_info"', ctx).facility).toBe("__excluded");
        expect(categorize('"function names" subsection', ctx).facility).toBe("__excluded");
        expect(categorize("producers", ctx).facility).toBe("__excluded");
        expect(categorize("target_features", ctx).facility).toBe("__excluded");
    });
});
```

- [ ] **Step 2: Run — fail**

Run: `pnpm --filter @bench/size-attr test`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать реестр**

`packages/size-attr/src/facilities.ts`:
```typescript
import type { ScalingKind } from "@bench/result-schema";

export interface CategorizeCtx {
    exportNames: Set<string>;
    workloadPrefixes: string[];
}

export interface FacilityResult {
    facility: string;
    scaling: ScalingKind;
}

interface Rule {
    facility: string;
    scaling: ScalingKind | "__meta";
    re: RegExp;
}

// Non-prod rows wasm-opt strips: excluded from the denominator entirely.
const EXCLUDE_RE = /^custom section|names" subsection|^producers$|^target_features$|\.debug/i;

// Ordered: first match wins. Patterns grounded in W0 probe symbol listings.
const RULES: Rule[] = [
    { facility: "panic-fmt", scaling: "paid-once", re: /panic|core::fmt|::fmt::|begin_panic|__rust_start_panic|slice_index|panicking|__cxa_throw|__cxa_allocate_exception|__throw_/ },
    { facility: "toolchain-runtime", scaling: "paid-once", re: /LazyLock|thread::local|LocalKey|FnOnce::call_once|core::cell::.*borrow|RefCell<.*borrow/ },
    { facility: "allocator", scaling: "paid-once", re: /dlmalloc|dlfree|dlrealloc|dlcalloc|__rust_alloc|__rust_realloc|__rust_dealloc|sbrk|prepend_alloc|operator new|operator delete|^malloc$|^free$|get_new_handler/ },
    { facility: "hash-map", scaling: "paid-once", re: /HashMap|RandomState|SipHash|sip::|hashbrown|__hash_table|__hash_node|unordered_map|__next_prime|u8to64/ },
    { facility: "string", scaling: "paid-once", re: /alloc::string|::String|str::|from_utf8|basic_string|char_traits|__init_copy_ctor/ },
    { facility: "dynamic-array", scaling: "paid-once", re: /RawVec|alloc::vec|::Vec<|__split_buffer|::vector/ },
    { facility: "compiler-rt", scaling: "paid-once", re: /__multi3|__udiv|__umod|__div|memcpy|memmove|memset|memcmp|compiler_builtins/ },
    { facility: "data", scaling: "paid-once", re: /^data segment|\.rodata|\.data/ },
    { facility: "structural", scaling: "paid-once", re: /^export |^elem|^table|^type |code section|^magic|function table/ },
];

export function categorize(name: string, ctx: CategorizeCtx): FacilityResult {
    if (EXCLUDE_RE.test(name)) {
        return { facility: "__excluded", scaling: "paid-once" };
    }
    for (const r of RULES) {
        if (r.re.test(name)) {
            return { facility: r.facility, scaling: r.scaling === "__meta" ? "paid-once" : r.scaling };
        }
    }
    const bare = name.replace(/^export "?|"?$/g, "");
    if (ctx.exportNames.has(bare) || ctx.workloadPrefixes.some((p) => name.includes(p))) {
        return { facility: "observed", scaling: "observed" };
    }
    return { facility: "unattributed", scaling: "paid-once" };
}
```

- [ ] **Step 4: Run — pass**

Run: `pnpm --filter @bench/size-attr test`
Expected: PASS (все кейсы).

- [ ] **Step 5: Commit**

```bash
git add packages/size-attr/src/facilities.ts packages/size-attr/tests/facilities.test.ts
git commit --no-gpg-sign -m "feat(size-attr): facility registry + categorize (W1)"
```

### Task 1.4: twiggy-JSON парсер

**Files:**
- Create: `packages/size-attr/src/twiggy.ts`
- Test: `packages/size-attr/tests/twiggy.test.ts`

- [ ] **Step 1: Падающий тест**

`packages/size-attr/tests/twiggy.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { parseTwiggyJson } from "../src/twiggy.js";

describe("parseTwiggyJson", () => {
    it("parses twiggy top -f json output", () => {
        const json = JSON.stringify([
            { name: "matmul", shallow_size: 480, shallow_size_percent: 16.41 },
            { name: "data segment \".rodata\"", shallow_size: 521, shallow_size_percent: 17.81 },
        ]);
        const rows = parseTwiggyJson(json);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ name: "matmul", shallowSize: 480 });
    });
    it("throws on non-array", () => {
        expect(() => parseTwiggyJson("{}")).toThrow();
    });
});
```

- [ ] **Step 2: Run — fail.** `pnpm --filter @bench/size-attr test` → FAIL.

- [ ] **Step 3: Реализовать**

`packages/size-attr/src/twiggy.ts`:
```typescript
import { z } from "zod";

const RowSchema = z.object({
    name: z.string(),
    shallow_size: z.number().int().nonnegative(),
    shallow_size_percent: z.number(),
});
const OutputSchema = z.array(RowSchema);

export interface TwiggyRow { name: string; shallowSize: number; }

export function parseTwiggyJson(json: string): TwiggyRow[] {
    const rows = OutputSchema.parse(JSON.parse(json));
    return rows.map((r) => ({ name: r.name, shallowSize: r.shallow_size }));
}
```

- [ ] **Step 4: Run — pass.** `pnpm --filter @bench/size-attr test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/size-attr/src/twiggy.ts packages/size-attr/tests/twiggy.test.ts
git commit --no-gpg-sign -m "feat(size-attr): twiggy JSON parser (W1)"
```

### Task 1.5: `buildComposition()` — группировка + доли + калибровка

**Files:**
- Create: `packages/size-attr/src/attribute.ts`
- Test: `packages/size-attr/tests/attribute.test.ts`

- [ ] **Step 1: Падающий тест**

`packages/size-attr/tests/attribute.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { buildComposition } from "../src/attribute.js";
import type { CategorizeCtx } from "../src/facilities.js";

const ctx: CategorizeCtx = { exportNames: new Set(["matmul"]), workloadPrefixes: [] };

describe("buildComposition", () => {
    const rows = [
        { name: "matmul", shallowSize: 520 },
        { name: "dlmalloc", shallowSize: 400 },
        { name: 'custom section ".debug_info"', shallowSize: 700 }, // excluded
        { name: "mystery::sym", shallowSize: 80 },                  // unattributed
    ];
    const prod = { rawBytes: 800, gzipBytes: 400, brotliBytes: 360 };

    it("excludes meta rows from the denominator", () => {
        const c = buildComposition(rows, ctx, prod);
        expect(c.preOptTotalBytes).toBe(1000); // 520 + 400 + 80, NOT 1700
    });
    it("shares sum to 1 (incl unattributed)", () => {
        const c = buildComposition(rows, ctx, prod);
        const sum = c.facilities.reduce((a, f) => a + f.share, 0) + c.unattributedShare;
        expect(sum).toBeCloseTo(1, 6);
    });
    it("calibrates approxBytes to production raw total", () => {
        const c = buildComposition(rows, ctx, prod);
        const sum = c.facilities.reduce((a, f) => a + f.approxBytes, 0);
        expect(sum).toBeLessThanOrEqual(prod.rawBytes);          // rounding never overshoots total
        expect(c.calibrationFactor).toBeCloseTo(800 / 1000, 6);
        const observed = c.facilities.find((f) => f.facility === "observed");
        expect(observed?.approxBytes).toBe(Math.round(0.52 * 800)); // 520/1000 * 800
    });
    it("surfaces unattributed as its own share", () => {
        const c = buildComposition(rows, ctx, prod);
        expect(c.unattributedShare).toBeCloseTo(80 / 1000, 6);
    });
});
```

- [ ] **Step 2: Run — fail.** `pnpm --filter @bench/size-attr test` → FAIL.

- [ ] **Step 3: Реализовать**

`packages/size-attr/src/attribute.ts`:
```typescript
import type { SizeComposition, FacilityShare } from "@bench/result-schema";
import { categorize, type CategorizeCtx } from "./facilities.js";
import type { TwiggyRow } from "./twiggy.js";

export interface ProductionTotal { rawBytes: number; gzipBytes: number; brotliBytes: number; }

export function buildComposition(
    rows: readonly TwiggyRow[],
    ctx: CategorizeCtx,
    productionTotal: ProductionTotal,
): SizeComposition {
    const byFacility = new Map<string, { bytes: number; scaling: FacilityShare["scaling"] }>();
    let preOptTotal = 0;
    let unattributedBytes = 0;
    for (const row of rows) {
        const { facility, scaling } = categorize(row.name, ctx);
        if (facility === "__excluded") {
            continue;
        }
        preOptTotal += row.shallowSize;
        if (facility === "unattributed") {
            unattributedBytes += row.shallowSize;
            continue;
        }
        const cur = byFacility.get(facility) ?? { bytes: 0, scaling };
        cur.bytes += row.shallowSize;
        byFacility.set(facility, cur);
    }
    const factor = preOptTotal === 0 ? 1 : productionTotal.rawBytes / preOptTotal;
    const facilities: FacilityShare[] = [...byFacility.entries()]
        .map(([facility, v]) => ({
            facility,
            scaling: v.scaling,
            share: preOptTotal === 0 ? 0 : v.bytes / preOptTotal,
            approxBytes: Math.round(v.bytes * factor),
        }))
        .sort((a, b) => b.approxBytes - a.approxBytes);
    return {
        source: "pre-opt-twiggy",
        productionTotal,
        preOptTotalBytes: preOptTotal,
        calibrationFactor: factor,
        unattributedShare: preOptTotal === 0 ? 0 : unattributedBytes / preOptTotal,
        facilities,
    };
}
```

- [ ] **Step 4: Run — pass.** `pnpm --filter @bench/size-attr test` → PASS.

- [ ] **Step 5: typecheck весь пакет + раскомментировать index.ts re-exports**

Убедиться, что `packages/size-attr/src/index.ts` экспортирует facilities/twiggy/attribute. Run:
```bash
pnpm --filter @bench/size-attr typecheck && pnpm --filter @bench/size-attr test
```
Expected: оба зелёные.

- [ ] **Step 6: Commit**

```bash
git add packages/size-attr/src/attribute.ts packages/size-attr/src/index.ts packages/size-attr/tests/attribute.test.ts
git commit --no-gpg-sign -m "feat(size-attr): buildComposition with calibration to prod total (W1)"
```

### Task 1.6: Движок — name-bearing rust-сборка + twiggy → composition

**Files:**
- Create: `scripts/lib/size-attr-build.ts`

- [ ] **Step 1: Реализовать движок для rust/raw**

`scripts/lib/size-attr-build.ts`:
```typescript
import { resolve, join } from "node:path";
import { buildComposition, parseTwiggyJson, type CategorizeCtx } from "@bench/size-attr";
import type { SizeComposition } from "@bench/result-schema";
import { run, capture } from "./exec.js";
import { twiggyPath } from "./tool-paths.js";
import type { BinaryCombination } from "./matrix.js";
import type { ProductionTotal } from "@bench/size-attr";

const ATTR_TARGET = "target/attr"; // isolated; never clobbers production target/

// Cargo profile env key: release | release-size -> CARGO_PROFILE_RELEASE_STRIP / _RELEASE_SIZE_STRIP
function stripEnvKey(profile: "release" | "release-size"): string {
    return `CARGO_PROFILE_${profile.toUpperCase().replace(/-/g, "_")}_STRIP`;
}

/** Exported symbol names that count as "observed" for rust/raw (extern "C" surface). */
function rustObservedCtx(c: BinaryCombination): CategorizeCtx {
    return {
        exportNames: new Set([
            "alloc", "load_input", "reset",
            `${c.sourceBench}`, "matmul", "output_ptr", "output_len",
            `${c.sourceBench}_insert`, `${c.sourceBench}_lookup`, `${c.sourceBench}_delete`,
            `${c.sourceBench}_insert_reset`, `${c.sourceBench}_lookup_reset`, `${c.sourceBench}_delete_reset`,
        ]),
        workloadPrefixes: [`${c.sourceBench}::`, "matmul_shared::", "parse_pairs", "with_slices"],
    };
}

export async function attributeRustRaw(
    c: BinaryCombination,
    productionTotal: ProductionTotal,
): Promise<SizeComposition> {
    const crateDir = `benches/${c.sourceBench}/rust/raw`;
    const profile = c.profile === "speed" ? "release" : "release-size";
    // Name-bearing build into isolated target dir (STRIP=false keeps the name section).
    await run("cargo", ["build", `--profile=${profile}`, "--target=wasm32-unknown-unknown"], {
        cwd: crateDir,
        env: { [stripEnvKey(profile)]: "false", CARGO_TARGET_DIR: resolve(ATTR_TARGET) },
    });
    const wasm = join(ATTR_TARGET, "wasm32-unknown-unknown", profile, `${c.sourceBench}_rust_raw.wasm`);
    const json = await capture(twiggyPath(), ["top", "-f", "json", "-n", "1000", wasm]);
    const rows = parseTwiggyJson(json);
    return buildComposition(rows, rustObservedCtx(c), productionTotal);
}
```

- [ ] **Step 2: typecheck scripts**

Run (sandbox ok): `pnpm typecheck`
Expected: PASS (size-attr-build.ts компилируется; пока никем не импортируется — допустимо).

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/size-attr-build.ts
git commit --no-gpg-sign -m "feat(size-attr): rust/raw attribution engine (name-bearing build + twiggy) (W1)"
```

### Task 1.7: Интеграция в `build-rust.ts` + meta — валидация на matmul

**Files:**
- Modify: `scripts/lib/meta.ts:13-20` (поле `composition`)
- Modify: `scripts/build-rust.ts:1-48` (import + вызов в `buildRaw`)

- [ ] **Step 1: Добавить `composition` в `ArtifactMeta`**

В `scripts/lib/meta.ts` импорт типа и поле:
```typescript
import type { SizeComposition } from "@bench/result-schema";
```
В интерфейс `ArtifactMeta` добавить (после `toolchainVersions`):
```typescript
    composition: SizeComposition | null;
```

- [ ] **Step 2: Вызвать движок в `buildRaw`**

В `scripts/build-rust.ts`: импорт `import { attributeRustRaw } from "./lib/size-attr-build.js";`. В `buildRaw`, после `const wasmStat = await statArtifact(dst);` и перед сборкой `meta`:
```typescript
    const composition = await attributeRustRaw(c, {
        rawBytes: wasmStat.rawBytes, gzipBytes: wasmStat.gzipBytes, brotliBytes: wasmStat.brotliBytes,
    });
```
В объект `meta` добавить поле `composition,`. (В `buildBindgen` пока поставить `composition: null,` — bindgen-атрибуция вне Plan 1.)

- [ ] **Step 3: Собрать matmul + проверить meta**

`dangerouslyDisableSandbox: true`:
```bash
pnpm build:rust matmul 2>&1 | tail -5
cat dist/matmul/rust-raw-size/meta.json | python3 -m json.tool | sed -n '/composition/,/}/p' | head -40
```
Expected: `composition` присутствует; `facilities` включает `observed` (доминирует на matmul), `data` (~520 B isqrt-таблица), мелкие panic-fmt/allocator; `unattributedShare` мал (< ~0.05). Бары приближённых байт суммируются ≤ `productionTotal.rawBytes`.

- [ ] **Step 4: Per-task break-check.** Если `unattributedShare` высок (> ~0.1) или `observed` не доминирует matmul — НЕ хаммерить: посмотреть `twiggy top -n 60 target/attr/.../matmul_rust_raw.wasm`, добавить недостающие правила в `facilities.ts` (≤2 итерации), пере-прогнать unit-тесты Task 1.3. Зафиксировать решение.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/meta.ts scripts/build-rust.ts
git commit --no-gpg-sign -m "feat(size-attr): write composition into rust/raw meta.json; validated on matmul (W1)"
```

### Task 1.8: Последовательная валидация hashmap_int → hashmap_string

**Files:** возможно `packages/size-attr/src/facilities.ts` (+ его тест) — донастройка правил.

- [ ] **Step 1: hashmap_int**

`dangerouslyDisableSandbox: true`:
```bash
pnpm build:rust hashmap_int 2>&1 | tail -3
cat dist/hashmap_int/rust-raw-size/meta.json | python3 -c "import json,sys; c=json.load(sys.stdin)['composition']; print('unattr', round(c['unattributedShare'],3)); [print(f['facility'], f['approxBytes'], round(f['share'],3)) for f in c['facilities']]"
```
Expected: floor доминирует (~85%): `allocator` крупнейший (~dlmalloc), `hash-map`, `panic-fmt`; `observed` ~15%; `toolchain-runtime` ненулевой (LazyLock/RandomState); `unattributedShare` < ~0.05.

- [ ] **Step 2: hashmap_string**

```bash
pnpm build:rust hashmap_string 2>&1 | tail -3
cat dist/hashmap_string/rust-raw-size/meta.json | python3 -c "import json,sys; c=json.load(sys.stdin)['composition']; print('unattr', round(c['unattributedShare'],3)); [print(f['facility'], f['approxBytes'], round(f['share'],3)) for f in c['facilities']]"
```
Expected: появляется `string`-категория (мелкая, ~0.37K pre-opt по зонду); `panic-fmt` крупный; `unattributedShare` < ~0.05.

- [ ] **Step 3: Per-task break-check + донастройка.** Если для любого появился новый крупный unattributed-кластер — `twiggy top -n 60` на name-bearing бинаре (`target/attr/...`), добавить правило в `facilities.ts`, дописать unit-кейс в `facilities.test.ts`, пере-прогнать `pnpm --filter @bench/size-attr test`. ≤2 итерации на бинарь.

- [ ] **Step 4: Commit (если правила менялись)**

```bash
git add packages/size-attr/src/facilities.ts packages/size-attr/tests/facilities.test.ts
git commit --no-gpg-sign -m "refine(size-attr): facility rules tuned on hashmap_{int,string} (W1)"
```

### Task 1.9: cpp/wasi-sdk атрибуция

**Files:**
- Modify: `benches/*/cpp/build-wasi-sdk.sh` (name-bearing режим по env-флагу) — паттерн общий, начать с `benches/hashmap_string/cpp/build-wasi-sdk.sh`
- Modify: `scripts/lib/size-attr-build.ts` (добавить `attributeWasiSdk`)
- Modify: `scripts/build-cpp.ts:52-73` (вызов в `buildWasiSdk`)

- [ ] **Step 1: Name-bearing режим в build-wasi-sdk.sh**

Прочитать `benches/hashmap_string/cpp/build-wasi-sdk.sh`. Добавить: при `SIZE_ATTR=1` собирать **дополнительный** name-bearing выход `module.attr.wasm` рядом с `module.wasm` — те же флаги, но добавить `-g` и убрать любой `-Wl,--strip-all` / `wasm-opt`-strip из этой ветки (по образцу W0-зонда). Не менять обычный production-выход.

- [ ] **Step 2: `attributeWasiSdk` в `size-attr-build.ts`**

Добавить:
```typescript
import { existsSync } from "node:fs";

function cppObservedCtx(c: BinaryCombination): CategorizeCtx {
    return {
        exportNames: new Set([
            "alloc", "load_input", "reset",
            `${c.sourceBench}`, "matmul", "output_ptr", "output_len",
            `${c.sourceBench}_insert`, `${c.sourceBench}_lookup`, `${c.sourceBench}_delete`,
            `${c.sourceBench}_insert_reset`, `${c.sourceBench}_lookup_reset`, `${c.sourceBench}_delete_reset`,
        ]),
        workloadPrefixes: ["parse_pairs", "(anonymous namespace)", "::state(", "::State"],
    };
}

export async function attributeWasiSdk(
    c: BinaryCombination,
    distDir: string,
    productionTotal: ProductionTotal,
): Promise<SizeComposition | null> {
    const named = join(distDir, "module.attr.wasm");
    if (!existsSync(named)) {
        return null; // name-bearing output absent (e.g. build script not yet SIZE_ATTR-aware)
    }
    const json = await capture(twiggyPath(), ["top", "-f", "json", "-n", "1000", named]);
    const rows = parseTwiggyJson(json);
    return buildComposition(rows, cppObservedCtx(c), productionTotal);
}
```
(twiggy авто-демangлит C++ — подтверждено зондом.)

- [ ] **Step 3: Вызвать в `build-cpp.ts buildWasiSdk`** с `SIZE_ATTR=1`

В `buildWasiSdk`: добавить `SIZE_ATTR: "1"` в env при вызове bash-скрипта; после `statArtifact` вычислить `composition = await attributeWasiSdk(c, out, {...wasmStat})`; добавить `composition` в meta. В `buildEmscripten` — `composition: null` (emscripten вне Plan 1; проверка name-survival отложена per спека).

- [ ] **Step 4: Собрать + проверить hashmap_string cpp**

`dangerouslyDisableSandbox: true`:
```bash
pnpm build:cpp hashmap_string 2>&1 | tail -5
cat dist/hashmap_string/cpp-wasi-sdk-size/meta.json | python3 -c "import json,sys; c=json.load(sys.stdin)['composition']; print('unattr', round(c['unattributedShare'],3)); [print(f['facility'], f['approxBytes'], round(f['share'],3)) for f in c['facilities']]"
```
Expected: `allocator` крупнейший (~44%), `hash-map` (~22%), `string` (~3.8%), `panic-fmt` мал (~0.4% — cpp), `observed` ~18%; `unattributedShare` очень мал (зонд: 0.2%).

- [ ] **Step 5: Per-task break-check.** Если cpp-имена не демangлены (`code[N]`) или unattributed высок — добавить cpp-правила в `facilities.ts` (+ тест) ≤2 итерации; если name-секция вообще отсутствует — STOP, эскалировать (зонд показал, что для wasi-sdk должны быть; расхождение = находка).

- [ ] **Step 6: Commit**

```bash
git add benches/hashmap_string/cpp/build-wasi-sdk.sh scripts/lib/size-attr-build.ts scripts/build-cpp.ts packages/size-attr/src/facilities.ts packages/size-attr/tests/facilities.test.ts
git commit --no-gpg-sign -m "feat(size-attr): cpp/wasi-sdk attribution; validated on hashmap_string (W1)"
```

### Task 1.10: build:all + гейты

- [ ] **Step 1: Полный прогон гейтов**

`dangerouslyDisableSandbox: true` для build/smoke; чистые — в sandbox:
```bash
pnpm build:all 2>&1 | tail -8
pnpm typecheck && pnpm lint:all && pnpm test
```
Expected: всё зелёное; `meta.json` rust/raw + cpp/wasi-sdk бинарей несут `composition`; bindgen/emscripten — `composition: null` (вне Plan 1, не ломает).

- [ ] **Step 2: Подтвердить корректность не затронута**

```bash
pnpm smoke 2>&1 | tail -5
```
Expected: 0 correctness failures (production-бинари не менялись — атрибуция читает изолированный `target/attr`).

- [ ] **Step 3: Commit (если что-то осталось)**

```bash
git add -A && git commit --no-gpg-sign -m "chore(size-attr): build:all green with composition in meta (W1)" || echo "nothing to commit"
```

- [ ] **Break-point (конец W1):** движок валидирован на rust matmul/hashmap_int/hashmap_string + cpp/wasi-sdk hashmap_string; `meta.json` несёт `composition`; гейты зелёные. Доложить сводку (per-facility числа экземпляров). Рекомендовать `/finish-session` ИЛИ продолжить в Plan 2.

---

## Execution Protocol

**Routing (hybrid inline/subagent):**
- **W0** — `[I]` inline (мелкие правки конфигов + verify).
- **W1 Tasks 1.1–1.5** (scaffold, schema, ruleset, parser, buildComposition) — `[S]` subagent-friendly: каждая self-contained TDD-юнита с полным кодом и тестом, fresh subagent на задачу, two-stage review. Чистые `pnpm test`/`typecheck` (sandbox ок).
- **W1 Tasks 1.6–1.10** (движок, build-интеграция, последовательная валидация, гейты) — `[I]` inline: кросс-файловые, требуют `dangerouslyDisableSandbox` для сборок + judgment на unattributed/донастройку правил. НЕ параллелить (общий `target/attr` + dist/).

**Static break-points (2):**
1. **Конец W0** — `twiggy --version` отвечает. Доложить.
2. **Конец W1** — движок зелёный на 4 экземплярах, гейты зелёные, composition в meta. Доложить per-facility сводку; решить Plan 2 vs `/finish-session`.

**Per-task break-check:** после каждой задачи — результат соответствует ожиданию шага? Если unattributed высок или категория не совпала — ≤2 итерации донастройки правил (с unit-тестом), затем зафиксировать как находку и идти дальше. Surface planned risks: если cpp name-секция отсутствует или twiggy-JSON-формат изменился — эскалировать, не обходить молча.

**Retry budget:** ≤2 попытки на подход; затем STOP + rethink.

---

## Follow-on plans (фаза 1.3, outline — расширяются в свои доки перед исполнением)

- **Plan 2/3 — Reporter shell + Size-визуализация.** Общий shell (`packages/reporter`): одна страница, вкладки `Size`/`Perf` + клиентские фильтры (raw/gz/brotli, profile, toolchains, тумблер «только наблюдаемое»). Size-вид: композиционные bars на общей байтовой шкале (floor-band + observed-band + разделитель), within-toolchain «вычесть floor», кросс-языковой вид (выравнивание по категориям + таблица). Reporter читает `composition` из `dist/*/meta.json` (валидируя `SizeCompositionSchema`). Perf-вкладка = перенос существующей таблицы + 2×2 grid, минус size-колонки. JS = один observed-бар. (`scripts/report.ts` грузит meta.json и передаёт в renderer.)
- **Plan 3/3 — Дифференциал + guidelines + README + roadmap.** Дифференциальные minimal-сборки на `-Oz` для headline-фактов (реальная цена allocator; «map<int,int> paid-once» 1-vs-N use-site; премия мономорфизации shape_dispatch static vs dyn); ID math-таблиц (`wasm-tools print` → `math-table:isqrt`/`:log`). Обновить `docs/guidelines.md` (grounded floor-vs-marginal claims, заменяя handwave); `README.md` раздел «почему размеры приближённые и почему это ок»; bindgen/emscripten атрибуция; roadmap removal `wasm-size-floor-vs-marginal` + добавить `perf-view-redesign`.

---

## Self-review notes

- **Spec coverage (Plan 1 scope):** § Метод (composition + калибровка) = Tasks 1.5–1.7; § Faceted taxonomy = Task 1.3 (+ donastройка 1.8/1.9); § Schema (meta) = Tasks 1.2, 1.7; § Тулинг (twiggy pin) = Task 0.1; § Scope v1 sequential exemplars = Tasks 1.7→1.8→1.9 (matmul→hashmap_int→hashmap_string→cpp). Reporter/differential/docs = Plans 2–3 (outlined). ✓
- **Placeholders:** Task 0.1 Step 3 (setup-tools) и Task 1.9 Step 1 (build-wasi-sdk.sh) — «прочитать существующий блок X и добавить аналог»; это локализованные «следуй паттерну репо» инструкции (точный код установлен в репо), не TODO. Все code-шаги несут полный код.
- **Type consistency:** `SizeComposition`/`FacilityShare`/`ScalingKind` определены в Task 1.2, используются в 1.3/1.5/1.6 одинаково. `CategorizeCtx {exportNames, workloadPrefixes}` — 1.3, потребляется 1.5/1.6/1.9. `buildComposition(rows, ctx, productionTotal)` сигнатура единообразна. `attributeRustRaw`/`attributeWasiSdk` → `SizeComposition`. `ArtifactMeta.composition` — 1.1(тип)/1.7(поле). ✓
