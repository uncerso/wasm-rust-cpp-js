# Phase 1.1 — Design

**Status:** draft (pending plan & implementation)
**Created:** 2026-05-20
**Scope locked:** 2026-05-15 (см. `docs/roadmap.md` § Phase 1.1)
**Predecessor:** Phase 1.0.6 (web pipeline finalized)
**Source of scope:** `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` § Phase 1.1
+ tech-debt triage 2026-05-15.

## Цель Phase 1.1

Расширить evidence base за пределы единственного workload'а (matmul, Phase 1.0)
тремя новыми workloads из разных категорий и закрыть 8 tech-debt items, накопившихся
по результатам Phase 1.0 / 1.0.5 / 1.0.6. На выходе — материал для первых
**confirmed** claims в `docs/guidelines.md`.

Phase 1.1 — **не один merge**. Он разбит на 4 последовательно-shippable sub-phases:
1.1.0 (hardening preamble) → 1.1.1 (interop_calls) → 1.1.2 (hashmap) → 1.1.3
(shape_dispatch + close). Каждая sub-phase получает собственный plan-файл и закрывается
отдельным merge'ом.

## Workloads после Phase 1.1

12 benchmark IDs всего:

| Benchmark ID | Source binary | Group |
|---|---|---|
| `matmul` | `benches/matmul/` (existing) | Compute |
| `interop_calls_noop` | `benches/interop_calls/` | Interop |
| `interop_calls_add_i32` | `benches/interop_calls/` | Interop |
| `interop_calls_add_f64` | `benches/interop_calls/` | Interop |
| `hashmap_string_insert` | `benches/hashmap_string/` | Container |
| `hashmap_string_lookup` | `benches/hashmap_string/` | Container |
| `hashmap_string_delete` | `benches/hashmap_string/` | Container |
| `hashmap_int_insert` | `benches/hashmap_int/` | Container |
| `hashmap_int_lookup` | `benches/hashmap_int/` | Container |
| `hashmap_int_delete` | `benches/hashmap_int/` | Container |
| `shape_dispatch_static` | `benches/shape_dispatch_static/` | Dispatch |
| `shape_dispatch_dynamic` | `benches/shape_dispatch_dynamic/` | Dispatch |

«Source binary» обозначает binary artifact: один binary на (lang, toolchain, profile),
обслуживающий 1+ benchmark IDs через **multi-entry-point pattern** (см. § 1.1.1).

## Sub-phase breakdown

### Phase 1.1.0 — Hardening preamble

**Цель:** закрыть 8 tech-debt items и зафиксировать size baseline до того, как multiple
new artifacts размоют его. Workload'ы не трогаются.

**Waves:**

| Wave | Items | Подход |
|---|---|---|
| W1 Docs | `bench-debug-timings-docs` | README sub-section «Debug timings» с links на code locations. Standalone. |
| W2 Rust-raw hardening | `rust-raw-heap-ptr-repr-rust`, `rust-raw-get-slices-ergonomics` | `addr_of!` для HEAP base derivation; CPS-style `with_slices(f)` API. Byte-identical wasm output verify через `wasm2wat` diff. |
| W3 C++ alignas fix | `matmul-cpp-heap-alignas-latent` | `alignas(8) static double heap_d[HEAP_SIZE/8]` (type-aligned storage). Re-bench matmul cpp — size/runtime delta ≈ 0 ожидается. |
| W4 Runner-web cleanup | `worker-importscripts-detection` | Grep usage; либо удалить (если context известен статически), либо заменить на `typeof DedicatedWorkerGlobalScope !== "undefined"`. |
| W5 Bindgen size deep-dive | `bindgen-output-view-force-copy` → `bindgen-thread-local-init-shim-overhead` → `bindgen-size-regression-investigation` | Dead-API cleanup (удалить `readOutput` + `output_view`), затем `OnceLock` замена `thread_local!`, затем root-cause investigation оставшегося drift'а. |

**Wave ordering rationale.** W1 (docs) — independent, может идти parallel. W2-W3 —
internal refactors, API не меняют. W4 — runtime-layer cleanup, не зависит от Rust/C++.
W5 идёт последним: первые два items могут частично resolve'ить investigation сами по
себе («оставшийся drift» — узкая проблема для расследования).

**Exit criteria:**

- Все 8 tech_debt files deleted (per `resolved → delete file` policy).
- matmul re-bench на M-size: bindgen size = pre-Wave-3 baseline (или drift root-caused
  и зафиксирован в guidelines/spec как accepted).
- `pnpm smoke` зелёный.
- `pnpm typecheck && pnpm lint:all && pnpm test` зелёный.

**Out of scope:**
- Schema changes (никаких в 1.1.0).
- Multi-entry pattern (он в 1.1.1).
- Toolchain version bumps вне scope investigation.

### Phase 1.1.1 — interop_calls

**Цель:** первый non-matmul workload; ввести multi-entry-point pattern и
auto-discovery в build infra.

**Workload mechanics:**

Один binary на (lang, toolchain, profile) экспортирует **3 функции**, обслуживающие
3 benchmark IDs:

| Benchmark ID | Wasm export | DCE-defense |
|---|---|---|
| `interop_calls_noop` | `noop(): void` (инкрементирует wasm-side counter) | JS читает final counter в checksum |
| `interop_calls_add_i32` | `add_i32(a, b): i32` | JS аккумулирует sum возвращаемых значений |
| `interop_calls_add_f64` | `add_f64(a, b): f64` | JS аккумулирует sum |

**Sizes:** S/M/L → innerIterations 100k / 1M / 10M. Inputs deterministic from index
(i ∈ [0..N)).

**Fixture:** `fixtureBytes = 0`, `fixtureSha256` = SHA256 пустой строки
(`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). Schema не
меняется.

**Supported toolchains:** все 6 (`js/{idiomatic,typed-array}`, `rust/{raw,bindgen}`,
`cpp/{emscripten,wasi-sdk}`).

**Новая инфра (cross-cutting в этой sub-phase):**

1. **Multi-entry-point pattern.** `spec.json` получает поле `entries: string[]` — список
   benchmark IDs, обслуживаемых binary. `scripts/lib/matrix.ts` enumerate'ит cases per
   entry, не per binary. Loader factory: `createBenchModule(spec, entry?: string)`
   биндит `BenchModule.run` к нужному export'у. `BenchModule` interface не меняется.
2. **Auto-discovery в build-all.ts.** Заменить hardcoded `const benches = ["matmul"]`
   на `glob("benches/*/spec.json")`.
3. **`pnpm fixtures [--bench=<id>]`** — standalone fixture regenerator. interop_calls
   fixture-less, но команда нужна для следующих sub-phases.
4. **Reporter v0 cross-workload page.** Простая таблица «benchmark × toolchain ×
   profile», лидеры по size + warmMedian. Включает matmul + interop_calls.

**Waves:**

- **W1 Scaffolding:** loader factory refactor, spec.json `entries` field, auto-discovery,
  tests на mock multi-entry binary, `pnpm fixtures` command.
- **W2 Implementations:** 6 toolchain impl (js/idiomatic, js/typed-array, rust/raw,
  rust/bindgen, cpp/emscripten, cpp/wasi-sdk). По одному build script per language
  переиспользуется.
- **W3 Bench + reporter v0:** прогон полной матрицы; reporter integration; первые
  tentative claims в `guidelines.md`.

**Exit criteria:**
- 3 benchmark IDs × 6 toolchains × 2 profiles × 3 sizes = до 108 cases в `results/raw/`.
- `pnpm bench:all` зелёный, включает interop_calls.
- Reporter cross-workload page показывает matmul + interop_calls.
- ≥1 tentative claim в `guidelines.md`.

**Out of scope:**
- hashmap (1.1.2).
- shape_dispatch (1.1.3).
- Финализация reporter layout.

### Phase 1.1.2 — hashmap

**Цель:** stdlib container workload; первая возможность для **confirmed** claims через
bundle-size signal cross-language.

**Workload mechanics:**

**2 binaries × per-toolchain matrix** (string keys vs int keys раздельно — keep size
signal truthful per impl):

| Binary | Entry points → benchmark IDs |
|---|---|
| `hashmap_string` (16-байт ASCII keys, e.g. SHA256 prefixes) | `insert(N)` → `hashmap_string_insert`, `lookup(N)` → `hashmap_string_lookup`, `delete(N)` → `hashmap_string_delete` |
| `hashmap_int` (u64 keys) | `insert(N)` → `hashmap_int_insert`, `lookup(N)` → `hashmap_int_lookup`, `delete(N)` → `hashmap_int_delete` |

**Per entry semantics:**

- `insert(N)`: на свежую map добавить N пар `(key_i, value_i)` из fixture. Checksum =
  `map.size()` после операции.
- `lookup(N)`: pre-fill map at `reset()`/`loadInput`, затем сделать N lookup'ов по N
  разным keys, аккумулировать sum возвращаемых values → checksum.
- `delete(N)`: pre-fill map at `reset()`, удалить N keys, checksum = финальный
  `map.size()`.

`reset()` (existing optional BenchModule метод) — для lookup/delete pre-fill state
перед каждым sample'ом.

**Sizes:** S=1k pairs, M=10k, L=100k. Меньше matmul'а — hashmap memory-bound иначе.

**Fixture format:**

- `hashmap_string`: layout `(key_16, value_8)` × N, packed (24N bytes).
- `hashmap_int`: layout `(key_8, value_8)` × N, packed (16N bytes).
- Generated через **shared `benches/common/fixtures.ts`** (см. ниже).

**Checksums:** per-entry, fixed in spec.json. Source of truth — JS impl.

**Supported toolchains (initial Phase 1.1.2):**

| Toolchain | hashmap_string | hashmap_int | Reason |
|---|---|---|---|
| `js/idiomatic` (Map) | ✓ | ✓ | Native Map. |
| `js/typed-array` | ✗ | ✗ | Не применимо. |
| `rust/raw` | ✗ | ✗ | no_std, нет HashMap. Punt → roadmap. |
| `rust/bindgen` | ✓ | ✓ | std HashMap. |
| `cpp/emscripten` | ✓ | ✓ | std::unordered_map (libc++). |
| `cpp/wasi-sdk` | ✗ | ✗ | Текущий freestanding setup без libc++. Punt → roadmap. |

Итого: 3 toolchains × 2 profiles × 2 binaries = 12 binaries; × 3 entry points × 3
sizes = до 108 measurement cases.

> **Deferred to roadmap:** запись `hashmap-stdlib-no-glue` добавляется в
> `docs/roadmap.md` § Phase 1.2 — расширение hashmap на rust/raw + cpp/wasi-sdk
> через stdlib (std HashMap / std::unordered_map) без bindgen/emscripten glue
> overhead. Bundle-size delta «std-only inclusion» — отдельный исследовательский
> вопрос для Phase 1.2.

**Новая инфра (cross-cutting в этой sub-phase):**

**`benches/common/fixtures.ts`** (rule-of-three refactor). При 3 consumers
(matmul + hashmap_string + hashmap_int) извлекается shared toolkit:
- Seeded RNG (xorshift / PCG, deterministic).
- Generators: `genBytes(n, seed)`, `genAsciiStrings(n, len, seed)`,
  `genIntPairs(n, seed)`, `genF64Array(n, seed)`.
- Per-workload `fixtures/generate.ts` становится thin wrapper, импортирующим
  из `benches/common/fixtures.ts`.
- Local utility (не workspace package); promote'нём, если позже понадобится из
  runtime кода.

**Waves:**

- **W1 Fixtures + spec:** shared `benches/common/fixtures.ts`; spec.json для 2 binaries;
  fixture generators; expectedChecksums from JS reference impl.
- **W2 Implementations:** 3 toolchains × 2 binaries = 6 wasm impl + 2 JS reference
  impl (`hashmap_string` и `hashmap_int` JS — оба `js/idiomatic`).
- **W3 Bench + guidelines pass:** прогон, reporter v1 (hashmap rows в cross-workload),
  извлечение bundle-size claims (≥2 sizes × ≥2 key types — потенциал для confirmed
  per format в `guidelines.md`).

**Exit criteria:**
- 12 binaries в dist/ (2 binaries × 3 toolchains × 2 profiles).
- Bench results включают 6 workload IDs × 3 toolchains × 2 profiles × 3 sizes.
- Reporter cross-workload page показывает hashmap (string+int) рядом с matmul +
  interop_calls.
- ≥1 confirmed claim в `guidelines.md` (bundle-size category).

**Out of scope:**
- rust/raw hashmap (roadmap → Phase 1.2+).
- cpp/wasi-sdk hashmap hosted mode (roadmap → Phase 1.2+).
- shape_dispatch (1.1.3).

### Phase 1.1.3 — shape_dispatch + Phase 1.1 close

**Цель:** static-vs-dynamic dispatch comparison; финальная reporter layout;
guidelines harvest pass; closure Phase 1.1.

**Workload mechanics:**

**2 binaries per (lang, toolchain, profile):**

| Benchmark ID | Dispatch model |
|---|---|
| `shape_dispatch_static` | C++ templates / Rust generics + monomorphization / JS single concrete struct |
| `shape_dispatch_dynamic` | C++ `virtual` + class hierarchy / Rust `dyn Trait` boxed / JS property-based polymorphism |

Один entry point per binary: `run(N)` итерирует через коллекцию shapes, вычисляет
total area cumulative across iterations, returns checksum.

**Shape mix:**
- 3 типа: `Circle{radius: f64}`, `Square{side: f64}`, `Triangle{base: f64, height: f64}`.
- Pre-allocated массив N shapes; распределение ~33%/33%/33% deterministic через seeded
  RNG (`benches/common/fixtures.ts::genShapes(n, seed)` — новый generator в toolkit).

**Sizes:** S=100 shapes, M=1k, L=10k. Покрывает L1/L2/выше cache pressure.

**Fixture format:** `(tag_u8, padding_u8 × 7, data_f64 × 2)` packed per shape. Точные
параметры — в spec.json.

**Supported toolchains:** все 6.

> **JS «static vs dynamic» note:** V8/SpiderMonkey оптимизируют monomorphic call sites
> через inline caches. Если static и dynamic JS impl показывают одинаковый perf — это
> сам по себе finding (tentative claim про IC behavior). Полезный signal для
> guidelines.

Итого: 2 binaries × 6 toolchains × 2 profiles = 24 артефакта; × 3 sizes = до 72
measurement cases.

**Waves:**

- **W1 Fixtures + spec:** `genShapes` generator extension в toolkit; 2 binaries'
  spec.json; reference checksums.
- **W2 Implementations:** 12 impl combos (6 toolchains × 2 dispatch types).
- **W3 Bench:** прогон полной матрицы.
- **W4 Reporter v2 (final):** cross-workload page получает финальный layout —
  таблица «(workload × language × toolchain × profile) → leaders», группировка по
  category (compute, interop, container, dispatch). Заголовок «Phase 1.1 summary».
- **W5 Guidelines harvest:** systematic review всех Phase 1.1 results. Apply formal
  rules:
  - **Confirmed:** ≥2 sizes OR ≥2 workloads показывают consistent signal.
  - **Tentative:** single-workload или single-size observation.
  - Update existing claims со status changes (`refined 1.1`).
  - Target categories: bundle-size (от hashmap), interop cost (от interop_calls),
    dispatch cost (от shape_dispatch).

**Exit criteria (= Phase 1.1 close):**

- 12 benchmark IDs full coverage в `results/raw/<run>/*.json`.
- `pnpm bench:all` зелёный — reproducible single-command full matrix.
- Reporter cross-workload page показывает все 4 categories.
- `docs/guidelines.md` имеет ≥3 claims (confirmed или tentative), ссылающиеся на
  Phase 1.1 results.
- `docs/tech_debt/` не содержит Phase 1.1-targeted items.
- All 4 sub-phase plans закрыты (handoff в master).
- `/backlog-review` sanity-pass пройден (orphan candidates check, format audit).

**Out of scope:**
- Items в Phase 1.2 / Phase 2+ bucket'ах roadmap.md.
- Migration `docs/guidelines.md` на per-claim files (триггер — >30 claims или ~500
  lines).

## Cross-cutting concerns

### Result-schema changes

**План: никаких структурных изменений schema в Phase 1.1.** `BenchmarkMetaSchema.id`
остаётся свободной строкой, `inputSize` остаётся `enum [S, M, L]`,
`fixtureSha256` остаётся required `length(64)` (interop_calls использует SHA256 пустой
строки как sentinel).

**Caveat:** если в 1.1.1 W1 окажется, что multi-entry pattern требует schema-уровневую
поддержку (например, поле `entryPoint` в `BenchmarkMetaSchema`) — это **отдельное
планируемое изменение** в plan'е, с bump'ом `SCHEMA_VERSION` и invalidation старых
`results/raw/*.json`. Будет рассмотрено при writing-plans, не зафиксировано здесь.

### Loader / BenchModule changes

`BenchModule` interface (`packages/harness/src/types.ts`) **не меняется**.
Multi-entry поддерживается на уровне loader factory:

```ts
function createBenchModule(spec: WorkloadSpec, entry?: string): Promise<BenchModule>
```

Loader знает, какой export bind'ить к `module.run` исходя из `entry`. `BenchModule.run`
остаётся `(iterations: number) => RunResult`.

### Fixture toolkit (introduced 1.1.2)

`benches/common/fixtures.ts` — shared utilities для воспроизводимой generation:
- Seeded RNG (deterministic, bit-identical across runs).
- Primitive generators: bytes, ASCII strings, int pairs, f64 arrays, shape mixes.
- Per-workload `fixtures/generate.ts` — thin wrapper.

**Standalone command:** `pnpm fixtures [--bench=<id>]` (introduced 1.1.1 W1) —
regenerate fixtures без full `build:all`. Quality-of-life during workload development.

### Reporter evolution

| Sub-phase | Reporter state |
|---|---|
| 1.1.0 | Без изменений (только matmul). |
| 1.1.1 | Cross-workload v0: matmul + interop_calls в таблице; leaders по size + warmMedian. |
| 1.1.2 | Cross-workload v1: добавляются hashmap rows; category grouping (compute/interop/container). |
| 1.1.3 | Cross-workload v2 (final): 4 categories; «Phase 1.1 summary» заголовок. |

Per-workload pages (детальный view) — extension matmul'овой страницы, mechanically
reused для новых benchmark IDs.

### Guidelines artifact cadence

- **1.1.0:** не trigger'ит claims по умолчанию. Bindgen investigation может trigger'ить
  tentative claim про toolchain choice — записать если применимо.
- **1.1.1:** tentative claim — interop boundary cost (bindgen vs raw vs emscripten).
- **1.1.2:** первая возможность для **confirmed** — bundle-size signal через 2 key
  types × 3 sizes даёт ≥2 sub-workload evidence per `guidelines.md` format.
- **1.1.3 W5:** systematic harvest всех Phase 1.1 results; final status transitions.

### Roadmap & tech-debt hygiene

- **1.1.0:** удалить resolved 8 tech_debt files.
- **1.1.1:** capture protocol per CLAUDE.md при tech-debt-level discovery — не блокирует
  sub-phase.
- **1.1.2:** добавить `hashmap-stdlib-no-glue` в `docs/roadmap.md` § Phase 1.2.
- **1.1.3:** `/backlog-review` sanity-pass перед closure — orphan candidates check,
  format audit.

### Testing & validation strategy

- Per sub-phase: `pnpm typecheck && pnpm lint:all && pnpm test` зелёный gate перед
  merge.
- Per workload: `pnpm smoke` (S-size, все combos, Node) — fast regression catcher.
  После auto-discovery (1.1.1 W1) `smoke` iterates по `benches/*/spec.json` автоматически.
- Per workload: `pnpm bench --envs=node --sizes=S,M --mode=quick` — sanity на real
  bench infra перед full matrix.

## Workflow notes

- Каждая sub-phase получает **отдельный plan-файл**
  `docs/superpowers/plans/2026-XX-XX-phase-1-1-N-<topic>.md`.
- Каждая sub-phase закрывается отдельным merge'ом в master.
- Capture protocol'ы (CLAUDE.md § Tech-debt capture, § Roadmap capture) активны.
- `--no-gpg-sign` обязателен на коммитах (existing project convention).
- При длительной sessии — `/finish-session` skill решает, нужен ли session-state
  snapshot. Phase exit ≠ session exit; session-state не входит в exit criteria.

## Открытые вопросы для writing-plans

Эти решения отложены до plan-уровня:

- **inputSize ↔ iterations mapping per workload.** Для matmul `iterations=1` (один
  matmul per sample), `inputSize` варьирует matrix dimensions. Для interop_calls и
  hashmap `iterations` per sample корреспондирует размеру (например,
  iterations=innerIterations=100k для S). Механизм декларации этого mapping'а (config
  override per spec.json, или per-size `iterationsHint`) решается при 1.1.1 W1.
- Точное layout fixture формата для `hashmap_string` (24-byte packed vs alignment-padded).
- Bindgen W5 investigation — depth of root-cause: сколько времени budget'ить, при
  какой evidence quality выходим в «documented as accepted» если root cause не
  finder'ится.
- Структура `benches/common/fixtures.ts` — flat module vs sub-files per generator type.
  Решать при extraction (1.1.2 W1).
- Reporter HTML structure при category grouping — table per category vs unified
  table с category column. Решать при 1.1.2 W3.
- shape mix payload encoding — packed vs SoA. Решать при 1.1.3 W1.
- JS toolchain variants в interop_calls и shape_dispatch: `js/idiomatic` и
  `js/typed-array` могут быть identical в этих workloads (нет матриц/буферов).
  Включить оба для consistency или один — решить на per-workload basis в W2 каждой
  sub-phase.

Эти вопросы — внутри-sub-phase implementation details; design level не нужен.
