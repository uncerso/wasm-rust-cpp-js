# Pitfalls — Phase 1.1.1 execution (interop_calls + multi-entry infra)

Сессия 2026-05-22..23. Wave 2 (Tasks 15-22) + Wave 3 (Tasks 23-26). Merge to master
как `a7d4d5a`, tag `phase-1-1-1` на `9fdc63d`.

## P1 — Iter-dependent workload checksum protocol

### What happened

После полной реализации Wave 2 первый `pnpm smoke` показал **все 30 interop_calls cases
с `validated: false, correctnessFailed: true`**. Matmul зелёный. Sample debug:
`interop_calls_noop__rust-raw-speed__S__node.json` имел `checksum: 1` (spec ожидал
100000 для S). Cmd-line путь к зелёному smoke потребовал три отдельных fix'а:

- `b381c70` fix(harness,loaders,interop_calls/js): iter-dependent checksum protocol
- `94baeb3` feat(result-schema,runners): plumb spec.inputSizes[size].innerIterations
- (`acd4e06` chore: dev-infra generalize — несвязанный с P1, см. P2)

### Root cause

**Три причины, каждая sufficient для падения**:

1. **Harness'овая hidden invariant assumption.** `packages/harness/src/measure.ts`
   валидировал `firstResult = module.run(1)` checksum против spec'а expectedChecksum
   и bailout'ил при mismatch. Это работало для matmul, потому что matmul'овский
   `run(N)` reset'ит `C[]` каждую итерацию и checksum (`abs_sum(C)`) **invariant к N**.
   Для interop_calls — workload **специально мерит JS↔Wasm crossing cost**, поэтому
   `run(N) === N` маленьких calls в JS-loop, checksum accumulative → `run(1).checksum
   ≠ run(innerIterations).checksum`. Harness contract «expectedChecksum is iter-invariant»
   был implicit, никогда не задокументирован.

2. **Hardcoded `innerIterations: 1` в runner'ах.** `apps/runner-node/src/main.ts`
   и `apps/runner-web/src/driver.ts` создавали `MeasureConfig` с
   `innerIterations: 1` в обоих режимах (quick + eval). Это имело смысл для matmul
   (1 unit of work = 1 full multiply), но не для interop_calls где unit = N crossings.

3. **Noop counter accumulation across `run()` calls.** raw-wasm/bindgen/emscripten
   loaders для arity-0 entries (noop pattern) делали:
   ```ts
   for (let i = 0; i < iters; i++) fn();
   return { checksum: counter() };   // absolute, accumulates
   ```
   `module.reset?.()` (вызывается harness'ом между samples) не helped — interop_calls
   raw/cpp не экспортируют `reset`. JS impls (idiomatic + typed-array) держали
   `let counter = 0` в module scope, тот же leak. После `loadInput → run(1) →
   warmup × run(N) × warmupIterations → samples` counter был залит хвостами от
   предыдущих вызовов.

### Prevention

**Inline edit** в `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`
§ «Checksum-семантика workload'а» (новая subsection) — обязал spec нового workload'а
явно проговаривать три инварианта:

1. Iter-семантика checksum'а: invariant vs iter-dependent.
2. Per-call state leakage между `run()` вызовами.
3. `innerIterations` ratio per size (если iter-dependent).

`measure.ts` теперь имеет comment, что `run(1)` checksum НЕ валидируется. `SpecInputSizeSchema`
получил optional `innerIterations` field, runner'ы переопределяют `MeasureConfig`
из spec'а.

**Lesson для plan executor'ов будущих workload'ов:** smoke gate должен включать
не просто `quality.validated == true`, а явный sanity check «checksum совпадает
с reference для iter=innerIterations». Иначе можно получить ложно-валидные результаты
если workload accidentally daёт правильный ответ при N=1 (но не при N=innerIterations).

## P2 — Multi-bench eslint/tsconfig include patterns

### What happened

При добавлении `benches/interop_calls/validate/reference.ts` + `benches/interop_calls/fixtures/generate.ts`
`pnpm lint:ts` падал на оба файла:
```
Parsing error: ... was not found by the project service.
Consider either including it in the tsconfig.json or including it in allowDefaultProject
```

### Root cause

ESLint flat config с `parserOptions: { projectService: true }` требует чтобы каждый
линтуемый `.ts` принадлежал какой-то tsconfig'е (root или package-level). Старый
config был **matmul-specific**:

- `tsconfig.json` include: `["scripts/**/*", "benches/matmul/validate/**/*"]`
- `eslint.config.js` ignores: `"benches/matmul/fixtures/**"`

`benches/interop_calls/validate/*.ts` не попадал ни в один tsconfig include →
projectService parse error. То же для `fixtures/generate.ts`, но он исторически
ignored (matmul precedent).

Этот контракт был не writting в spec — implicit hardcode в config'ах.

### Prevention

Generalized оба pattern'а на `benches/*/`:
- `tsconfig.json` include `benches/*/validate/**/*` (validate scripts — legitimate code, линтуются).
- `eslint.config.js` ignores `benches/*/fixtures/**` (generators — write-once runtime tools, исторически не линтуются по matmul precedent).

**Чеклист для нового workload spec'а** должен включать: «при добавлении первого workload'а
после matmul — generalize tsconfig include + eslint ignores на `benches/*/...`».
Сейчас уже generalized для будущих benches; pitfall capture для случая если кто-то
ещё раз введёт specific pattern.

## P3 — `#[wasm_bindgen]` + `pub const fn` collision

### What happened

При написании `benches/interop_calls/rust/bindgen/src/lib.rs` для `interop_calls_add_i32`
и `interop_calls_add_f64` (pure functions без mutable state):

```rust
#[wasm_bindgen]
pub fn interop_calls_add_i32(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}
```

Clippy с `pedantic`+`nursery` ругался `missing_const_for_fn`: «this could be a `const fn`».
Добавление `const`:

```rust
#[wasm_bindgen]
pub const fn interop_calls_add_i32(...) { ... }
```

Завалилось на macro-level: `error: can only #[wasm_bindgen] non-const functions`.

### Root cause

`#[wasm_bindgen]` macro генерирует non-const FFI wrapper и не accept'ит `const fn` —
wasm-bindgen runtime устроен через global state (interner для JS strings, finalization
registry для GC-aware refcells), не compatible с const evaluation. Clippy lint не
знает про этот macro restriction.

### Prevention

Workaround: `#[allow(clippy::missing_const_for_fn, reason = "wasm_bindgen requires non-const fns")]`
на каждую такую функцию. Single-line nuisance, не systemic — но если bindgen
crate содержит несколько pure exports, имеет смысл `#![allow(...)]` на crate level.

Generic rule of thumb для bindgen crate authors: pure-function exports под `#[wasm_bindgen]`
обычно триггерят `missing_const_for_fn` lint, добавляй explicit allow по месту
(или crate-level `#![allow(...)]` если pure exports много).

## Methodology notes

- Все три pitfall'а были caught при первом end-to-end gate (`pnpm smoke`/`pnpm bench:all`).
  Unit tests + typecheck не помогли: harness measure.test.ts использует mock,
  который удовлетворяет matmul-style invariant случайно; eslint/tsconfig — only
  кетчатся при добавлении нового файла под новым path.
- P1 — **contract change in spec design doc** (inline applied). P2/P3 — **operational
  lessons**, остаются в pitfall file (этом). Future review через
  `/tech-debt-review` может промотить их в более formal locations.
