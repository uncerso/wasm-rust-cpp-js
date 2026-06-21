# Size Differential + Close-out — Implementation Plan (Plan 3/3, Phase 1.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Закрыть фазу 1.3: production-точный дифференциал на `-Oz` для трёх headline-фактов (цена allocator; «map paid-once» через 1-vs-N use-site; премия мономорфизации), `math-table:<fn>`-категория, донастройка facility-правил для high-unattr бинарей, и grounded `docs/guidelines.md` / `README.md` / `docs/roadmap.md` (graduate фазы).

**Architecture:** Дифференциал — слоистые синтетические rust/raw-крейты (`empty → +allocator → +HashMap → ×N use-sites`), собранные тем же production-пайплайном (`release-size` + `wasm-opt -Oz`), их дельты = production-точные маржинальные числа; премия мономорфизации читается из существующих production-бинарей `shape_dispatch_homo_{static,dyn}`. Дельты кросс-валидируют per-facility композицию (Plan 1). `math-table` отщепляется от `data`-facility по имени символа (cpp musl `__log_data`) или по content-ID через `wasm-tools print` (rust isqrt, если анонимна). Donastройка правил — twiggy-зонд по name-bearing `target/attr/` + правило + unit-тест. Docs замыкают north-star (grounded guidelines).

**Tech Stack:** Rust (cdylib, edition 2024, `release-size` профиль), `wasm-opt -Oz` (binaryen 129), `twiggy 0.8.0`, `wasm-tools` (новый пин, cargo-install), TypeScript (tsx-скрипт + vitest).

**Это Plan 3/3 фазы 1.3.** Plan 1 = attribution engine (исполнен); Plan 2 = reporter-shell + Size-вид (исполнен). Спека: [`2026-06-21-wasm-size-floor-vs-marginal-design.md`](../specs/2026-06-21-wasm-size-floor-vs-marginal-design.md), § Метод (слой 4 — дифференциал) / § Faceted taxonomy (`math-table`, `monomorphized`) / § Выход.

**Scope-решение (этой сессии):** «Фокусный close-out». Bindgen/emscripten-атрибуция и расследование cpp/wasi-sdk name-section heisenbug — **отложены в roadmap** (graceful degradation `composition: null` уже на месте, Plan 1); их добавляет Task 4.3 как новый roadmap-пункт, НЕ исполняет.

## Global Constraints

- **Commits:** `--no-gpg-sign` (CLAUDE.md § Commits). Push/PR — действие пользователя.
- **Sandbox:** `cargo build` / `wasm-opt` / любой `tsx` / `pnpm build:*` / `smoke` биндят pipe → запускать с `dangerouslyDisableSandbox: true` (CLAUDE.md § Tooling gotchas). Чистые `pnpm typecheck` / `test` / `lint:*` работают в sandbox.
- **Cargo workspace target** — артефакты в workspace-root `target/`, НЕ per-crate (`docs/pitfalls/2026-05-22-phase-1-1-1-w1.md`).
- **wasm-opt флаги (production, копировать дословно):** `wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int <in> -o <out>` (`scripts/build-rust.ts:36`).
- **Rust lints:** workspace `Cargo.toml` — `warnings = "deny"`, `clippy::all = "deny"` (pedantic/nursery = warn). Новые крейты ДОЛЖНЫ проходить `cargo clippy`.
- **Production-бинари НЕ меняются** — дифференциал строит изолированные синтетические крейты; correctness/perf не затрагиваются.
- **Retry budget:** ≤2 попытки на подход; затем STOP + rethink.

---

## File Structure

- `benches/_diff/rust/{d_bare,d_alloc,d_map1,d_map8}/` — 4 синтетических cdylib-крейта (новые). `_diff` без `spec.json` → `build:all` (`glob("benches/*/spec.json")`) их игнорирует; только `scripts/size-diff.ts` их собирает.
- `Cargo.toml` (workspace `members`) — +4 записи.
- `scripts/size-diff.ts` — оркестратор дифференциала (новый): собирает diff-крейты + `shape_dispatch_homo_{static,dyn}/rust/raw` production-пайплайном, печатает таблицу дельт.
- `packages/size-attr/src/facilities.ts` (+ `tests/facilities.test.ts`) — `math-table:<fn>`-правило + правила для high-unattr кластеров.
- `tool-versions.json`, `scripts/lib/tool-paths.ts`, `scripts/lib/setup-tools.ts` — пин `wasm-tools`.
- `docs/guidelines.md`, `README.md`, `docs/roadmap.md` — close-out docs.

---

## Wave 1 — дифференциальный harness + 3 headline-числа

### Task 1.1: Синтетические diff-крейты (`benches/_diff/rust/`)

**Files:**
- Create: `benches/_diff/rust/d_bare/Cargo.toml`, `benches/_diff/rust/d_bare/src/lib.rs`
- Create: `benches/_diff/rust/d_alloc/Cargo.toml`, `benches/_diff/rust/d_alloc/src/lib.rs`
- Create: `benches/_diff/rust/d_map1/Cargo.toml`, `benches/_diff/rust/d_map1/src/lib.rs`
- Create: `benches/_diff/rust/d_map8/Cargo.toml`, `benches/_diff/rust/d_map8/src/lib.rs`
- Modify: `Cargo.toml` (workspace `members`)

**Interfaces:**
- Produces: 4 cdylib-крейта с именами пакетов `d-bare`/`d-alloc`/`d-map1`/`d-map8` (артефакты `d_bare.wasm` и т.д.), каждый экспортирует `extern "C" fn run(u32) -> u32`. Потребляются `scripts/size-diff.ts` (Task 1.2).

- [ ] **Step 1: `Cargo.toml` каждого крейта** (зеркалит `benches/hashmap_int/rust/raw/Cargo.toml`)

`benches/_diff/rust/d_bare/Cargo.toml` (остальные три — то же, меняя `name`: `d-alloc`, `d-map1`, `d-map8`):
```toml
[package]
name = "d-bare"
version.workspace = true
edition.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]

[lints]
workspace = true
```

- [ ] **Step 2: `src/lib.rs` каждого крейта** (слоистый: baseline → +allocator → +HashMap → ×8 use-sites)

`d_bare/src/lib.rs` — std линкуется, ноль heap (allocator DCE-ится на `-Oz`); floor-референс:
```rust
//! Differential baseline: std linked, zero heap allocation. On `-Oz` the
//! allocator is dead-code-eliminated, so this is the structural+observed floor.

#[unsafe(no_mangle)]
pub extern "C" fn run(x: u32) -> u32 {
    x.wrapping_mul(2_654_435_761).rotate_left(15)
}
```

`d_alloc/src/lib.rs` — `+allocator`: heap-Vec, утечка через `forget` гарантирует, что аллокация материализуется (оптимизатор не свернёт в fold-без-Vec):
```rust
//! Differential: +allocator. A heap Vec whose backing allocation must
//! materialise (leaked via mem::forget) forces the global allocator (dlmalloc)
//! to link. Delta vs d_bare ≈ the allocator floor on -Oz.

#[unsafe(no_mangle)]
pub extern "C" fn run(n: u32) -> u32 {
    let mut v: Vec<u32> = Vec::with_capacity(n as usize);
    for i in 0..n {
        v.push(i.wrapping_mul(2_654_435_761));
    }
    let acc = v.iter().fold(0u32, |a, &b| a ^ b);
    core::mem::forget(v); // keep the allocation observable to the optimizer
    acc
}
```

`d_map1/src/lib.rs` — `+HashMap` на ОДНОМ use-site:
```rust
//! Differential: +HashMap at ONE use-site. Pulls HashMap + RandomState + hash
//! + panic machinery on top of the allocator. Delta vs d_alloc ≈ hash-map cost.

use std::collections::HashMap;

#[unsafe(no_mangle)]
pub extern "C" fn run(n: u32) -> u32 {
    let mut m: HashMap<u32, u32> = HashMap::new();
    for i in 0..n {
        m.insert(i, i.wrapping_mul(2_654_435_761));
    }
    m.values().fold(0u32, |a, &b| a ^ b)
}
```

`d_map8/src/lib.rs` — `+HashMap` на ВОСЬМИ различных use-site'ах; `#[inline(never)]` держит 8 различных мест инстанцирования, но монроморфизованный код `HashMap<u32,u32>` в бинаре ОДИН. Delta vs d_map1 ≈ 0 → paid-once:
```rust
//! Differential: +HashMap at EIGHT use-sites. Each `site` is a distinct
//! instantiation point (inline(never)), but HashMap<u32,u32>'s monomorphised
//! code appears ONCE. Delta vs d_map1 ≈ 0 demonstrates "paid once, not per use-site".

use std::collections::HashMap;

#[inline(never)]
fn site(seed: u32, n: u32) -> u32 {
    let mut m: HashMap<u32, u32> = HashMap::new();
    for i in 0..n {
        m.insert(i ^ seed, i.wrapping_mul(2_654_435_761));
    }
    m.values().fold(0u32, |a, &b| a ^ b)
}

#[unsafe(no_mangle)]
pub extern "C" fn run(n: u32) -> u32 {
    let mut acc = 0u32;
    for seed in 0..8u32 {
        acc ^= site(seed, n);
    }
    acc
}
```

- [ ] **Step 3: Добавить 4 крейта в workspace `members`**

В `Cargo.toml`, в массив `members` (после shape_dispatch-записей):
```toml
    "benches/_diff/rust/d_bare",
    "benches/_diff/rust/d_alloc",
    "benches/_diff/rust/d_map1",
    "benches/_diff/rust/d_map8",
```

- [ ] **Step 4: Сборка + clippy-чистота** (`dangerouslyDisableSandbox: true`)

```bash
cargo build --workspace --target=wasm32-unknown-unknown 2>&1 | tail -5
cargo clippy --workspace --target=wasm32-unknown-unknown 2>&1 | tail -5
```
Expected: build + clippy зелёные (нет `warnings = "deny"`-падений). Если clippy жалуется на конкретный крейт — поправить точечно (idiomatic-форма), НЕ ослаблять lints.

- [ ] **Step 5: Commit**

```bash
git add benches/_diff Cargo.toml Cargo.lock
git commit --no-gpg-sign -m "feat(size-diff): layered synthetic diff crates (empty/+alloc/+map/×8) (P3 W1)"
```

### Task 1.2: `scripts/size-diff.ts` — сборка production-пайплайном + дельты

**Files:**
- Create: `scripts/size-diff.ts`

**Interfaces:**
- Consumes: `statArtifact` из `scripts/lib/meta.ts` (`(path) => Promise<{rawBytes, gzipBytes, brotliBytes, ...}>`); `run` из `scripts/lib/exec.ts`; `wasmOptPath` из `scripts/lib/tool-paths.ts`; production-крейты `benches/shape_dispatch_homo_{static,dyn}/rust/raw` (артефакт `shape_dispatch_homo_{static,dyn}_rust_raw.wasm`).

- [ ] **Step 1: Реализовать скрипт**

`scripts/size-diff.ts`:
```typescript
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./lib/exec.js";
import { statArtifact } from "./lib/meta.js";
import { wasmOptPath } from "./lib/tool-paths.js";

const DIFF_TARGET = "target/diff"; // isolated; never clobbers production target/
const PROFILE = "release-size";    // matches `pnpm build:rust` size profile

interface Sized { rawBytes: number; gzipBytes: number; brotliBytes: number; }

/** Build a workspace crate for wasm32, run the production wasm-opt -Oz pipeline, measure. */
async function buildAndMeasure(crateDir: string, artifactStem: string): Promise<Sized> {
    await run("cargo", ["build", `--profile=${PROFILE}`, "--target=wasm32-unknown-unknown"], {
        cwd: crateDir,
        env: { CARGO_TARGET_DIR: join(process.cwd(), DIFF_TARGET) },
    });
    const built = join(DIFF_TARGET, "wasm32-unknown-unknown", PROFILE, `${artifactStem}.wasm`);
    const opt = join(DIFF_TARGET, `${artifactStem}.opt.wasm`);
    await copyFile(built, opt);
    await run(wasmOptPath(), ["-Oz", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", opt, "-o", opt]);
    return statArtifact(opt);
}

function row(label: string, s: Sized): string {
    return `${label.padEnd(34)} raw=${String(s.rawBytes).padStart(6)}  gz=${String(s.gzipBytes).padStart(6)}  br=${String(s.brotliBytes).padStart(6)}`;
}

function delta(label: string, hi: Sized, lo: Sized): string {
    const d = (a: number, b: number) => String(a - b).padStart(6);
    return `${label.padEnd(34)} raw=${d(hi.rawBytes, lo.rawBytes)}  gz=${d(hi.gzipBytes, lo.gzipBytes)}  br=${d(hi.brotliBytes, lo.brotliBytes)}`;
}

async function main(): Promise<void> {
    await mkdir(DIFF_TARGET, { recursive: true });

    const bare = await buildAndMeasure("benches/_diff/rust/d_bare", "d_bare");
    const alloc = await buildAndMeasure("benches/_diff/rust/d_alloc", "d_alloc");
    const map1 = await buildAndMeasure("benches/_diff/rust/d_map1", "d_map1");
    const map8 = await buildAndMeasure("benches/_diff/rust/d_map8", "d_map8");

    // Monomorphisation premium: existing production crates (static = N monomorphised copies, dyn = vtable).
    const stat = await buildAndMeasure("benches/shape_dispatch_homo_static/rust/raw", "shape_dispatch_homo_static_rust_raw");
    const dyn = await buildAndMeasure("benches/shape_dispatch_homo_dyn/rust/raw", "shape_dispatch_homo_dyn_rust_raw");

    console.log("\n=== absolute (rust/raw, -Oz) ===");
    console.log(row("d_bare (std, no heap)", bare));
    console.log(row("d_alloc (+allocator)", alloc));
    console.log(row("d_map1 (+HashMap, 1 use-site)", map1));
    console.log(row("d_map8 (+HashMap, 8 use-sites)", map8));
    console.log(row("shape_dispatch_homo_static", stat));
    console.log(row("shape_dispatch_homo_dyn", dyn));

    console.log("\n=== headline deltas ===");
    console.log(delta("allocator floor   (alloc-bare)", alloc, bare));
    console.log(delta("hash-map machinery (map1-alloc)", map1, alloc));
    console.log(delta("map paid-once     (map8-map1≈0)", map8, map1));
    console.log(delta("monomorph premium (static-dyn)", stat, dyn));
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
```

- [ ] **Step 2: typecheck** (sandbox ок)

Run: `pnpm typecheck`
Expected: PASS (skip-проверка: `statArtifact` действительно возвращает `{rawBytes,gzipBytes,brotliBytes}` — подтверждено в `scripts/lib/meta.ts`; если сигнатура иная — взять реальные имена полей, НЕ выдумывать).

- [ ] **Step 3: Прогон + зафиксировать числа** (`dangerouslyDisableSandbox: true`)

Run: `pnpm tsx scripts/size-diff.ts 2>&1 | tail -20`
Expected: таблица абсолютов + 4 дельты. Ожидания (порядок величины):
- `allocator floor` > 0 (dlmalloc — сотни B–~1.5K raw);
- `hash-map machinery` > 0 (SipHash/RandomState/panic — крупная, ~ единицы KB raw);
- `map paid-once` ≈ 0 (|Δ| мал относительно `map1` — несколько сотен B на 8 wrapper-тел `site`, НЕ ×8 map-кода);
- `monomorph premium` > 0 (static > dyn).

- [ ] **Step 4: Per-task break-check (surface planned risks).**
  - Если `allocator floor` ≈ 0 → оптимизатор свернул аллокацию в `d_alloc`: добавить `core::hint::black_box` вокруг `v.as_ptr()` перед `forget`, пере-прогнать (≤2 итерации). Подтвердить через `twiggy top -n 30 target/diff/.../d_alloc.opt.wasm`, что dlmalloc присутствует в `d_alloc` и отсутствует в `d_bare`.
  - Если `map paid-once` НЕ ≈0 (растёт пропорционально 8) → `#[inline(never)]` не сработал или 8 копий монроморфизуются: проверить `twiggy`, зафиксировать как находку (по дизайну должно быть paid-once — расхождение эскалировать пользователю, не подгонять).
  - Если `monomorph premium` ≤ 0 → static не крупнее dyn: зафиксировать (это само по себе находка про `-Oz` dedup); сверить с composition `observed`-долями.

- [ ] **Step 5: Commit**

```bash
git add scripts/size-diff.ts
git commit --no-gpg-sign -m "feat(size-diff): differential orchestrator + 3 headline deltas (P3 W1)"
```

- [ ] **GATE (W1):** `size-diff.ts` печатает 4 дельты; числа осмысленны (allocator>0, hash-map>0, paid-once≈0, premium>0 или задокументированное отклонение). Доложить таблицу + per-facility кросс-проверку (доля×тотал из Plan 1 composition ≈ дифференциал-дельта по порядку). Break-point.

---

## Wave 2 — донастройка facility-правил (tech-debt `size-attr-nonexemplar-unattr`)

> Цель: снизить `unattributedShare` на не-exemplar rust/raw-бинарях (interop_calls ~28%; shape_dispatch_homo_dyn ~13–27%; shape_dispatch_mixed_dyn ~22–26%) добавлением facility-правил, обоснованных twiggy-зондом. Процедура (НЕ pre-written regex — правила выводятся из реального вывода twiggy, как Plan 1 Task 1.8): зонд → гипотеза-правило + unit-тест → верификация падения unattr. ≤2 итерации на бинарь.

### Task 2.1: Зонд high-unattr бинарей

**Files:** (read-only на этом шаге)

- [ ] **Step 1: Собрать exemplar'ы (пишет name-bearing `target/attr/`)** (`dangerouslyDisableSandbox: true`)

```bash
pnpm build:rust interop_calls shape_dispatch_homo_dyn shape_dispatch_mixed_dyn 2>&1 | tail -5
```

- [ ] **Step 2: Топ unattributed-символов каждого бинаря**

Для каждого из `{interop_calls,shape_dispatch_homo_dyn,shape_dispatch_mixed_dyn}` (артефакт `<bench>_rust_raw.wasm`, профиль `release-size`):
```bash
twiggy top -f json -n 60 target/attr/wasm32-unknown-unknown/release-size/<bench>_rust_raw.wasm \
  | python3 -c "import json,sys; [print(r['shallow_size'], r['name']) for r in json.load(sys.stdin)]" | head -40
```
Записать кластеры символов, которые НЕ матчатся текущим реестром (`packages/size-attr/src/facilities.ts`) и НЕ являются `observed` (workload-namespace). Гипотезы (проверить против реального вывода, не принимать на веру):
- **dyn-dispatch:** trait-object/vtable-инфра — `dyn `, `vtable`, `core::ops::function::Fn`, `drop_in_place`, `<dyn ...>` → кандидат-категория `trait-object` (paid-once) или расширить `observed`-prefix'ы workload'а.
- **interop_calls:** f64-форматирование / trivial-арифметика, не попавшая в `observed`-prefix → расширить `workloadPrefixes` (Plan 1 `rustObservedCtx`) ИЛИ новое правило, если это runtime-инфра.

- [ ] **Step 3: Per-task break-check.** Если топ-unattributed — это РЕАЛЬНО observed workload-код (просто не покрыт prefix'ом) → это правка `rustObservedCtx` в `scripts/lib/size-attr-build.ts`, а не нового facility-правила. Различить: символ в namespace workload'а → observed; общая runtime-инфра → facility. Зафиксировать решение по каждому кластеру.

### Task 2.2: Правило(а) + unit-тест + верификация

**Files:**
- Modify: `packages/size-attr/src/facilities.ts` (новое правило ИЛИ расширение существующего regex)
- Modify: `packages/size-attr/tests/facilities.test.ts` (unit-кейс на каждый добавленный паттерн)
- Possibly Modify: `scripts/lib/size-attr-build.ts` (`rustObservedCtx` prefix'ы, если кластер = observed)

- [ ] **Step 1: Падающий unit-тест на найденный кластер**

В `packages/size-attr/tests/facilities.test.ts` добавить кейс(ы) с РЕАЛЬНЫМИ именами символов из зонда (Task 2.1). Пример формы (подставить фактические имена):
```typescript
it("buckets dyn-dispatch vtable infra", () => {
    expect(categorize("core::ptr::drop_in_place<...>", ctx).facility).toBe("trait-object");
    // ...реальные символы из twiggy-зонда
});
```

- [ ] **Step 2: Run — fail.** `pnpm --filter @bench/size-attr test` → FAIL (правило ещё нет).

- [ ] **Step 3: Добавить правило в `RULES`** (`packages/size-attr/src/facilities.ts`)

Вставить упорядоченное правило (first-match-wins; позиция важна — до `observed`-fallthrough). Форма (паттерны — из зонда):
```typescript
{ facility: "trait-object", scaling: "paid-once", re: /drop_in_place|<dyn |__rust_drop_in_place|core::ops::function/ },
```
(Если кластер = observed — вместо правила расширить `workloadPrefixes` в `rustObservedCtx`.)

- [ ] **Step 4: Run — pass.** `pnpm --filter @bench/size-attr test` → PASS.

- [ ] **Step 5: Пере-собрать + верифицировать падение unattr** (`dangerouslyDisableSandbox: true`)

```bash
pnpm build:rust interop_calls shape_dispatch_homo_dyn shape_dispatch_mixed_dyn 2>&1 | tail -3
for b in interop_calls shape_dispatch_homo_dyn shape_dispatch_mixed_dyn; do
  echo -n "$b unattr: "; cat dist/$b/rust-raw-size/meta.json | python3 -c "import json,sys; print(round(json.load(sys.stdin)['composition']['unattributedShare'],3))"
done
```
Expected: `unattributedShare` заметно ниже (цель < ~0.10; если остаётся выше — задокументировать остаточный кластер как известный, ≤2 итерации, НЕ хаммерить).

- [ ] **Step 6: Resolve tech-debt + commit**

Удалить `docs/tech_debt/size-attr-nonexemplar-unattr.md` (resolved) ИЛИ дописать в него остаточные числа, если residual осознанно оставлен.
```bash
git add packages/size-attr/src/facilities.ts packages/size-attr/tests/facilities.test.ts scripts/lib/size-attr-build.ts docs/tech_debt/size-attr-nonexemplar-unattr.md
git commit --no-gpg-sign -m "refine(size-attr): rules for dyn-dispatch/interop unattr (resolve tech-debt) (P3 W2)"
```

- [ ] **GATE (W2):** unattr на трёх бинарях снижен (или residual задокументирован); unit-тесты зелёные. Доложить before/after числа. Break-point.

---

## Wave 3 — `math-table:<fn>`-категория (пин wasm-tools + content-ID при нужде)

### Task 3.1: Запинить `wasm-tools` (cargo-install, зеркалит twiggy)

**Files:**
- Modify: `tool-versions.json` (запись `wasm-tools`)
- Modify: `scripts/lib/tool-paths.ts` (`wasmToolsPath()`)
- Modify: `scripts/lib/setup-tools.ts` (`ensureWasmToolsViaCargo` + symlink + `ToolVersionsTools`)

- [ ] **Step 1: Запись в `tool-versions.json`** (в объект `tools`, рядом с `twiggy`)

```json
    "wasm-tools": {
      "version": "1.249.0",
      "installVia": "cargo",
      "_note": "WebAssembly toolkit. `wasm-tools print` для content-ID data-сегментов (math-table fingerprint, когда символ анонимен). cargo install --locked --version 1.249.0 wasm-tools --root .tools/wasm-tools-1.249.0."
    }
```

- [ ] **Step 2: `wasmToolsPath()` в `tool-paths.ts`** (после `twiggyPath()`)

```typescript
export function wasmToolsPath(): string {
    return preferLocal("wasm-tools");
}
```

- [ ] **Step 3: `ensureWasmToolsViaCargo` в `setup-tools.ts`** (зеркалит `ensureTwiggyViaCargo`, строки 197–220)

```typescript
export async function ensureWasmToolsViaCargo(version: string): Promise<void> {
    const state = await readState();
    const installRoot = join(TOOLS_DIR, `wasm-tools-${version}`);
    const binary = join(installRoot, "bin", "wasm-tools");

    if (state["wasm-tools"] === version && await pathExists(binary)) {
        console.log(`[setup] wasm-tools ${version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing wasm-tools ${version} via cargo`);
    await mkdir(TOOLS_DIR, { recursive: true });
    await run("cargo", ["install", "--locked", "--version", version, "--root", resolve(installRoot), "wasm-tools"]);

    state["wasm-tools"] = version;
    await writeState(state);
    console.log(`[setup] wasm-tools ${version} installed`);
}
```
И: (а) в `interface ToolVersionsTools` (строка ~351) добавить `"wasm-tools": { version: string };`; (б) в `createSymlinks()` (строка ~366) добавить `const wasmToolsVersion = tv.tools["wasm-tools"].version;` и в массив `links` — `["wasm-tools", \`../wasm-tools-${wasmToolsVersion}/bin/wasm-tools\`];`; (в) найти место вызова `ensureTwiggyViaCargo` в основной install-последовательности (тот же файл) и добавить рядом `await ensureWasmToolsViaCargo(tv.tools["wasm-tools"].version);`.

- [ ] **Step 4: Verify** (wasm-tools уже стоял глобально с Phase 1.2 по спеке § Тулинг — `preferLocal` упадёт на PATH)

```bash
wasm-tools --version
```
Expected: `wasm-tools 1.249.0` (или близкая). Если не на PATH — `pnpm setup` / cargo-install по записи; per-task break-check.

- [ ] **Step 5: typecheck + commit** (`pnpm typecheck` — sandbox ок)

```bash
git add tool-versions.json scripts/lib/tool-paths.ts scripts/lib/setup-tools.ts
git commit --no-gpg-sign -m "build(tools): pin wasm-tools 1.249.0 for math-table content ID (P3 W3)"
```

### Task 3.2: `math-table:<fn>`-правило + content-ID при анонимной таблице

**Files:**
- Modify: `packages/size-attr/src/facilities.ts` (+ `math-table:*`-правило ДО `data`-правила)
- Modify: `packages/size-attr/tests/facilities.test.ts`

> Текущий `data`-facility (`/^data segment|\.rodata|\.data/`) поглощает примитив-таблицы. Цель: отщепить именованные математические таблицы (cpp musl `__log_data` ~4247 B; rust isqrt-lookup ~520 B) в `math-table:<fn>` (paid-once). Reporter (Plan 2) рендерит facility по имени автоматически → доп. правок рендера НЕ требуется (math-table → floor-band, paid-once).

- [ ] **Step 1: Установить имена таблиц зондом**

```bash
# cpp musl log-таблица (named): уже подтверждена зондом Phase 1.2 как `__log_data`.
twiggy top -f json -n 80 dist/shape_dispatch_homo_static/cpp-wasi-sdk-size/module.attr.wasm 2>/dev/null \
  | python3 -c "import json,sys; [print(r['shallow_size'], r['name']) for r in json.load(sys.stdin) if 'log' in r['name'].lower() or 'data' in r['name'].lower()]" | head
# rust isqrt-таблица: имя из name-bearing matmul-сборки
pnpm build:rust matmul >/dev/null 2>&1
twiggy top -f json -n 80 target/attr/wasm32-unknown-unknown/release-size/matmul_rust_raw.wasm \
  | python3 -c "import json,sys; [print(r['shallow_size'], r['name']) for r in json.load(sys.stdin) if r['shallow_size']>=200]" | head
```
Зафиксировать: имена/паттерны таблиц.

- [ ] **Step 2: Per-task break-check — именованная vs анонимная.**
  - Если rust isqrt-таблица **именованная** (twiggy дал распознаваемое имя) → правило по имени (Step 3), `wasm-tools` для неё не нужен (но пин из 3.1 остаётся — он в спеке).
  - Если **анонимна** (`data[N]` / generic `data segment`) → нужен content-ID: `wasm-tools print -p target/attr/.../matmul_rust_raw.wasm` → найти `(data ...)` крупный сегмент ~520 B, взять его константный префикс как fingerprint, матчить по нему. Это требует протащить `wasm-tools print`-проход в `attributeRustRaw`/`buildComposition` (передавать опц. `dataContentId`-map в `CategorizeCtx`). Если так — STOP, доложить пользователю (это расширяет scope Task 3.2 за рамки name-based-правила; решить inline-объём).

- [ ] **Step 3: Падающий unit-тест + правило (name-based ветка)**

`tests/facilities.test.ts` (паттерны из Step 1):
```typescript
it("buckets math primitive tables as math-table:<fn>", () => {
    expect(categorize("__log_data", ctx).facility).toBe("math-table:log");
    // rust isqrt — реальное имя/паттерн из зонда:
    expect(categorize("<isqrt-symbol-from-probe>", ctx).facility).toBe("math-table:isqrt");
});
```
`facilities.ts` — правило ДО `data` и ДО `compiler-rt`:
```typescript
{ facility: "math-table:log", scaling: "paid-once", re: /__log_data|__log2_data|__exp_data|__pow_log_data/ },
{ facility: "math-table:isqrt", scaling: "paid-once", re: /<isqrt-pattern-from-probe>/ },
```
(`categorize` уже возвращает `facility`-строку как есть; `math-table:log` — валидное имя facility, схема `FacilityShareSchema.facility = z.string().min(1)` его принимает.)

- [ ] **Step 4: Run — pass.** `pnpm --filter @bench/size-attr test` → PASS.

- [ ] **Step 5: Пере-собрать + проверить отщепление** (`dangerouslyDisableSandbox: true`)

```bash
pnpm build:rust matmul >/dev/null 2>&1 && pnpm build:cpp shape_dispatch_homo_static >/dev/null 2>&1
cat dist/matmul/rust-raw-size/meta.json | python3 -c "import json,sys; [print(f['facility'],f['approxBytes']) for f in json.load(sys.stdin)['composition']['facilities'] if 'math-table' in f['facility'] or f['facility']=='data']"
```
Expected: `math-table:isqrt` присутствует как отдельный сегмент; `data`-facility уменьшился на величину таблицы.

- [ ] **Step 6: Commit**

```bash
git add packages/size-attr/src/facilities.ts packages/size-attr/tests/facilities.test.ts
git commit --no-gpg-sign -m "feat(size-attr): math-table:<fn> facility split (isqrt/log) (P3 W3)"
```

- [ ] **GATE (W3):** `math-table:*` отщеплён в composition exemplar'ов; reporter показывает его в floor-band; тесты зелёные. Доложить. Break-point.

---

## Wave 4 — close-out docs + gates (graduate фазы)

### Task 4.1: `docs/guidelines.md` § Artifact size — grounded refine

**Files:**
- Modify: `docs/guidelines.md` (§ Artifact size: 2-й claim → confirmed; новый floor-vs-marginal claim; 3-й claim — обновить roadmap-ref + premium-число)

> Формат claim'а — заголовок файла (`### <claim>` + `**Status/Evidence/Phase/Caveats**` + опц. body). Числа — из W1 дифференциала + Plan 1 composition + W2/W3 уточнений. НЕ выдумывать — подставлять фактические измеренные значения.

- [ ] **Step 1: Refine «std-container floor» claim (tentative → confirmed)**

В subsection «Подтягивание stdlib-hashmap…» заменить workload-confounded таблицу/caveat на чистый дифференциал из W1:
- `**Status:** confirmed` (был `tentative`).
- `**Evidence:**` добавить `scripts/size-diff.ts` (слоистый дифференциал `d_bare→d_alloc→d_map1→d_map8`, `-Oz`) + точные дельты raw/gz: allocator floor = N B; hash-map machinery = N B; **map paid-once: Δ(map8−map1) ≈ 0 → floor не масштабируется с числом use-site'ов**.
- `**Phase:** introduced 1.2 / refined 1.3`.
- Caveat: убрать «workload-confounded» (дифференциал устранил confound); добавить per-facility breakdown из composition (allocator dominant; rust panic/fmt-floor крупный vs cpp ~0.4%; string-facility мал).

- [ ] **Step 2: Новый claim — floor-vs-marginal декомпозиция first-class**

Добавить `###`-subsection под § Artifact size:
```markdown
### Размер микро-wasm = floor (paid-once) + observed; observed сопоставим кросс-языково в абсолюте, тоталы расходятся из-за floor — сравнивай within-toolchain или декомпозируй
**Status:** confirmed
**Evidence:** Phase 1.3, `dist/*/meta.json` `composition` (twiggy pre-opt × калибровка к точному production-тоталу), отчёт вкладка Size (`pnpm report`). <observed-абсолюты ~1.2–2.5K из composition; тоталы 1.2K↔16K>.
**Phase:** introduced 1.3
**Caveats:** per-facility абсолют приближённый (`≈`, pre-opt доля × тотал; wasm-opt сжимает неравномерно) — порядок величины надёжен, production-тотал точен. JS: floor≈0 (весь bundle observed).
```
Подставить фактические observed-абсолюты/тоталы из composition.

- [ ] **Step 3: Refine «примитив тянет таблицу» claim**

В subsection «Один примитив…»: (а) обновить ссылку `см. roadmap wasm-size-floor-vs-marginal` → `см. отчёт вкладка Size (`composition`) / `docs/guidelines.md` floor-vs-marginal claim` (пункт graduated в W4 Task 4.3); (б) добавить premium-число мономорфизации из W1 (`shape_dispatch_homo_static − dyn` = N B на `-Oz`); (в) если W3 дал `math-table:isqrt`/`:log` — отметить, что таблицы теперь видны как отдельные facility в отчёте.

- [ ] **Step 4: Commit**

```bash
git add docs/guidelines.md
git commit --no-gpg-sign -m "docs(guidelines): grounded floor-vs-marginal claims from differential + composition (P3 W4)"
```

### Task 4.2: `README.md` — «почему размеры приближённые»

**Files:**
- Modify: `README.md` (раздел в § Отчёт или § про size)

- [ ] **Step 1: Добавить подраздел** (явный запрос пользователя — спека § Выход)

Краткий (анти-fluff, `docs/writing-standard.md`) подраздел: per-facility размеры **приближённые** = pre-opt twiggy-композиция (доли) × калибровка к **точному** production-тоталу. **Почему не байт-точно:** name/debug-секции во время `wasm-opt` меняют оптимизацию (binaryen `-g` глушит merge-functions/dedup) → нельзя одновременно иметь production-байты И post-opt имена (W0-находка 3 спеки). **Почему ок:** production-тотал точен (якорь); доли устойчивы; порядок величины per-facility надёжен; headline-факты кросс-проверены production-точным дифференциалом (`scripts/size-diff.ts`).

- [ ] **Step 2: Сверить с реальным разделом README** (grep перед правкой — `feedback_grep_before_scope`)

```bash
grep -n "размер\|composition\|Size\|twiggy\|приближ" README.md | head
```
Вставить в логически близкий раздел; не дублировать существующие size-упоминания.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit --no-gpg-sign -m "docs(readme): why per-facility sizes are approximate (and why it's ok) (P3 W4)"
```

### Task 4.3: `docs/roadmap.md` — graduate + преемники

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Grep roadmap на все упоминания** (`feedback_grep_before_scope`)

```bash
grep -n "wasm-size-floor-vs-marginal\|perf-view-redesign\|size-attr\|heisenbug\|bindgen\|emscripten" docs/roadmap.md
```

- [ ] **Step 2: Удалить graduated-пункт + добавить преемников**

- Удалить запись `wasm-size-floor-vs-marginal` из TBD (graduated — фаза 1.3 исполнила; история в git).
- Добавить `perf-view-redesign` (богатый perf-вид: init-фазы, CV-heatmap, сравнение env) — формат как соседние записи (`- **<name>** — <описание> ([→ <source>](path))`).
- Добавить отложенное этой сессией (scope-решение): `size-attr-toolchain-coverage` — bindgen/emscripten facility-атрибуция + расследование cpp/wasi-sdk name-section heisenbug (`docs/superpowers/bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md`); сейчас `composition: null` (graceful degradation).
- `size-bar-per-facility-color` (TBD) — оставить как есть.

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md
git commit --no-gpg-sign -m "docs(roadmap): graduate wasm-size-floor-vs-marginal; +perf-view-redesign, +size-attr-toolchain-coverage (P3 W4)"
```

### Task 4.4: Полный прогон гейтов

- [ ] **Step 1: All-gates pre-flight** (build/smoke — `dangerouslyDisableSandbox: true`; typecheck/lint/test — sandbox)

```bash
pnpm build:all 2>&1 | tail -8
pnpm typecheck && pnpm lint:all && pnpm test 2>&1 | tail -15
pnpm smoke 2>&1 | tail -5
```
Expected: всё зелёное; 0 correctness failures (production-бинари не менялись); composition в meta rust/raw + cpp/wasi-sdk; bindgen/emscripten — `composition: null` (вне scope, не ломает).

- [ ] **Step 2: Отчёт — ручной чек** (`dangerouslyDisableSandbox: true`)

```bash
pnpm report 2>&1 | tail -2
out=$(ls -td results/summarized/*/ | head -1); echo "open $out/index.html"
```
Открыть Size-вкладку: `math-table:*` виден в floor-band (если W3 дал); unattr-бары dyn/interop меньше (W2); кросс-языковая таблица консистентна.

- [ ] **Step 3: Commit (если осталось)**

```bash
git add -A && git commit --no-gpg-sign -m "chore(size): build:all + report green; phase 1.3 closed (P3 W4)" || echo "nothing to commit"
```

- [ ] **Break-point (конец W4 = конец Plan 3 = конец фазы 1.3):** дифференциал + math-table + правила + grounded guidelines/README/roadmap; гейты зелёные; ручной чек пройден. Доложить сводку. Рекомендовать `/finish-session` (НЕ авто-инвокать — `feedback_no_auto_finish_session`). Push/PR — пользователь (Plan 1+2+3 вместе).

---

## Execution Protocol

**Routing (hybrid inline/subagent):** этот план — преимущественно `[I]` inline (эмпирические замеры, кросс-файловая интеграция, прозу, гейты — нужен `dangerouslyDisableSandbox` + judgment).
- **W1 Task 1.1** (diff-крейты) — `[I]` inline: маленькие, но требуют cargo/clippy-прогона + break-check на DCE аллокации.
- **W1 Task 1.2** (size-diff.ts) — `[I]` inline: кросс-файловый, `dangerouslyDisableSandbox`, judgment на дельтах.
- **W2** (донастройка правил) — `[I]` inline: эмпирический зонд + judgment (observed vs facility); сборки под `dangerouslyDisableSandbox`. Каждый unit-тест-кейс сам по себе `[S]`-able, но зонд+правило связаны → вести inline.
- **W3 Task 3.1** (пин wasm-tools) — `[I]` inline: правки конфигов + verify.
- **W3 Task 3.2** (math-table) — `[I]` inline: зонд имён + break-check на анонимную таблицу (возможный STOP/эскалация).
- **W4** (docs + gates) — `[I]` inline: проза + полный прогон.

**Static break-points (4):**
1. **Конец W1** — 4 дельты, кросс-проверка с composition. Доложить таблицу.
2. **Конец W2** — unattr снижен (before/after). Доложить.
3. **Конец W3** — math-table отщеплён. Доложить.
4. **Конец W4** — гейты зелёные, фаза закрыта. Доложить; рекомендовать `/finish-session`.

**Per-task break-check:** после каждой задачи — результат соответствует ожиданию шага? Surface planned risks (НЕ обходить молча — `feedback_surface_planned_risks`):
- (W1) аллокация свёрнута оптимизатором (allocator floor≈0) → black_box, ≤2 итерации; paid-once НЕ≈0 или premium≤0 → зафиксировать как находку, эскалировать если против дизайна.
- (W2) unattr не падает в ≤2 итерации → задокументировать остаточный кластер, не хаммерить.
- (W3) isqrt-таблица анонимна → content-ID через wasm-tools расширяет scope Task 3.2 → STOP, эскалировать объём.
- (всё) bindgen/emscripten/heisenbug — ВНЕ scope этой сессии; не дрейфовать в них (Task 4.3 только заносит в roadmap).

**Retry budget:** ≤2 попытки на подход; затем STOP + rethink.

---

## Self-Review

**1. Spec coverage (Plan 3 scope = спека § Выход + W4):**
- Дифференциал production-точный для headline-фактов (§ Метод слой 4; § Scope «точечный дифференциал») = W1 (allocator/hash/paid-once/premium). ✓
- `math-table:<fn>` (§ Faceted taxonomy) = W3. ✓
- Донастройка правил high-unattr (tech-debt) = W2. ✓
- `twiggy` пин — сделан Plan 1; `wasm-tools` пин (§ Тулинг) = W3 Task 3.1. ✓
- `docs/guidelines.md` grounded floor-vs-marginal (§ Выход) = W4 Task 4.1. ✓
- `README.md` «почему приближённые» (§ Выход, явный запрос) = W4 Task 4.2. ✓
- `docs/roadmap.md` removal + `perf-view-redesign` (§ Выход) = W4 Task 4.3. ✓
- **Отложено (scope-решение, в roadmap):** bindgen/emscripten атрибуция + cpp/wasi-sdk heisenbug (спека § Scope v1 «verify when reached / fallback section-only» санкционирует) = Task 4.3 roadmap-запись `size-attr-toolchain-coverage`. ✓

**2. Placeholder-scan:** code-шаги несут полный код. Эмпирические waves (W2 правила, W3 math-table паттерны) дают РЕАЛЬНЫЕ имена из зонда (`<...-from-probe>` — явные плейсхолдеры, заполняются на Step «зонд» ПЕРЕД правилом; это процедура «выведи из twiggy», как Plan 1 Task 1.8, не скрытый TODO). W4 docs дают точные поля/секции + «подставить фактические числа из W1».

**3. Type consistency:** `Sized {rawBytes,gzipBytes,brotliBytes}` (size-diff.ts) ↔ `statArtifact` возврат (meta.ts) — Step 1.2.2 верифицирует. `categorize(name, ctx) → {facility, scaling}` (Plan 1) — `math-table:log` валиден как `facility: string` (схема `z.string().min(1)`); правила вставляются в `RULES` ДО `data`/`observed`-fallthrough (порядок = first-match). `ensureWasmToolsViaCargo`/`wasmToolsPath`/`ToolVersionsTools["wasm-tools"]` — зеркалят twiggy-тройку (3.1). ✓
