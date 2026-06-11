# Session state — 2026-05-01

Сохранено для следующей сессии. Прочитайте это первым делом, потом план.

---

## TL;DR

Реализуется план **`docs/superpowers/plans/2026-05-01-wasm-benchmarks-phase-1-0.md`** на ветке **`phase-1-0`**. **16 из 29 задач готовы** (55%). Все шесть `matmul` имплементаций (JS×2, Rust×2, C++×2) собираются и дают bit-for-bit одинаковый checksum `8505.752465030815` для S-размера. Осталось: build-скрипты, runner-node, runner-web, reporter, e2e-прогон.

---

## Состояние репозитория

- **Branch:** `phase-1-0` (не master)
- **HEAD:** `a04d8a0` (на момент сохранения)
- **Commits на ветке:** 31 (16 feat + 15 docs/chore/fix плана)
- **Untracked:** `Какие есть существующие бенчмарки wasm под браузер.md` — НЕ коммитить, оставлять как есть.

---

## Готовые задачи (16/29)

| # | Task | Статус | Артефакт | Размер |
|---|---|---|---|---|
| 1 | Bootstrap pnpm workspace | ✅ | configs | — |
| 2 | result-schema (zod) | ✅ | `@bench/result-schema` | 2/2 tests |
| 3 | harness types + stats | ✅ | `@bench/harness` | tests passed |
| 4 | harness measure loop | ✅ | + measure.ts | tests passed |
| 5 | harness checksum validation | ✅ | + validation.ts | 10/10 tests |
| 6 | loaders types + timings | ✅ | `@bench/loaders` | typecheck clean |
| 7 | loaders plain-js | ✅ | + plain-js.ts | 1/1 test |
| 8 | loaders raw-wasm | ✅ | + raw-wasm.ts + wabt fixture | 2/2 tests |
| 9 | loaders rust-bindgen + emscripten stubs | ✅ | + 2 loader files | typecheck only |
| 10 | matmul spec + fixtures + reference | ✅ | spec.json, generate.ts, reference.ts | sha256 в spec |
| 11 | matmul JS idiomatic | ✅ | `js/idiomatic` | checksum verified |
| 12 | matmul JS typed-array | ✅ | `js/typed-array` | checksum verified |
| 13 | matmul Rust raw (no_std) | ✅ | `rust/raw` | **1116 B** wasm |
| 14 | matmul Rust wasm-bindgen | ✅ | `rust/bindgen` | ~14 KB wasm + 6 KB JS (без wasm-opt) |
| 15 | matmul C++ + Emscripten | ✅ | `cpp/build-emscripten.sh` | 1205 B wasm + 8.4 KB glue |
| 16 | matmul C++ wasi-sdk freestanding | ✅ | `cpp/build-wasi-sdk.sh` | **985 B** (smallest) |

**Все шесть имплементаций** дают `S=8505.752465030815`.

---

## Оставшиеся задачи (13/29)

В порядке плана. Inline = я делаю напрямую через Write+Bash. Subagent = через Agent tool с full review.

| # | Task | Подход | Заметки |
|---|---|---|---|
| 17 | scripts/lib helpers (matrix, exec, meta, tool-versions) | inline | Простой TS, есть полный код в плане |
| 18 | scripts/build-js.ts | inline | esbuild bundle |
| 19 | scripts/build-rust.ts | inline | cargo + wasm-pack + wasm-opt |
| 20 | scripts/build-cpp.ts | inline | вызывает .sh скрипты |
| 21 | scripts/build-all.ts | inline | оркестратор |
| 22 | apps/runner-node | inline | средний; runCase + CLI |
| 23 | apps/runner-web (Vite+Worker+Playwright) | **subagent** | большая, ~400 строк плана |
| 24 | scripts/run-matrix.ts | inline | обходит матрицу |
| 25 | reporter aggregate | inline | TDD, простой |
| 26 | reporter renderHtml | inline | TDD, простой |
| 27 | scripts/report.ts | inline | связывает aggregate+render |
| 28 | scripts/smoke.ts | inline | тривиальный |
| 29 | End-to-end run | inline | требует всё работающее, финал |

---

## Установленные тулчейны (на машине пользователя)

| Тул | Версия |
|---|---|
| Node | 22.22.2 |
| pnpm | 9.x (managed by packageManager field) |
| rustc | **1.95.0** (через rust-toolchain.toml) |
| rustup | 1.29.0 |
| wasm-pack | 0.13.1 |
| wasm-opt | 129 (binaryen) |
| Emscripten | **5.0.7** (`emcc`) |
| wasi-sdk | 25 (`$WASI_SDK_PATH`) |

`tool-versions.json` содержит canonical pins. Перед сессией пользователю нужно `source ~/emsdk/emsdk_env.sh` чтобы emcc был в PATH.

---

## Критичные детали

### GPG signing
Локальный gpg setup пользователя сломан. **Все сабагент-коммиты используют `--no-gpg-sign`** — пользователь явно разрешил для этой сессии. Это сохраняется в следующих сессиях (см. memory).

### Не амендить, не пушить
- ❌ Не использовать `git commit --amend` — пользователь запретил
- ❌ Не push'ить без явной просьбы
- ❌ Не использовать `--no-verify` для hooks (pre-commit hooks нет, но если появятся — ругаться)

### Стратегия исполнения (выбрана пользователем)
**Гибрид:** subagent для сложного, inline для тривиального. Субагент-flow = implementer (haiku/sonnet) + spec reviewer (haiku) + code quality reviewer (`superpowers:code-reviewer`, sonnet) + fix loop.

### Untracked file
`Какие есть существующие бенчмарки wasm под браузер.md` в корне — это input от пользователя (transcript Perplexity). НЕ коммитить, НЕ удалять.

---

## Отступления от плана (важно при чтении плана!)

В плане были несколько ошибок, поправленные по ходу. Если читать план — учесть:

### tsconfig.json для packages
- В Tasks 2, 3, 6 план изначально содержал `"rootDir": "./src"` + `include: ["tests/**/*"]`. Несовместимо (TS6059). **Удалено** — план обновлён. Просто `noEmit: true` без rootDir.

### Тест на stddev
- `expect(r.stddev).toBeCloseTo(2.872)` в плане был неверен (population stddev). Исправлен на `3.028` (sample n-1). Формула в `stats.ts` правильная (n-1).

### Тест на samples count
- `expect(out.warmSamplesMs.length).toBe(30)` нестабилен (mock мгновенный → CV>5% → max samples). Заменено на `toBeGreaterThanOrEqual(30) && toBeLessThanOrEqual(100)`.

### Rust raw (Task 13)
- `f64::sqrt()` недоступен в `no_std`. Используется `isqrt_usize()` через bisection.
- `HEAP.as_ptr()` даёт static_mut_refs warning (Rust 2024). Использован `addr_of!(HEAP)`.

### Rust wasm-bindgen (Task 14)
- `pub fn memory()` конфликтует с auto-export wasm-bindgen имени `memory`. Переименовано в **`wasm_memory()`**. Loader `rust-bindgen.ts` обновлён.
- Wasm-pack-internal `wasm-opt` валится на rust 1.95 output. Отключён через `[package.metadata.wasm-pack.profile.{release,release-size}]` → `wasm-opt = false`. Внешний wasm-opt запускается отдельно в build script.

### C++ (Task 15)
- `<math.h>` недоступен в wasi-sdk freestanding (`-nostdlib`). Заменено на `__builtin_sqrt` / `__builtin_fabs` (без include math.h). Работает и в emscripten.
- `INITIAL_MEMORY` поднят с 32 MB до **64 MB** — 32 MB static heap не влезал.

### Emscripten output convention
- Build script **НЕ переименовывает** `glue.wasm` в `module.wasm` (как было в плане). Glue.mjs hardcode-ит имя `glue.wasm` через `import.meta.url`. Loader/runner ссылается на `glue.mjs` как glueUrl, а wasm находится side-by-side автоматически.
- Convention для emscripten dir: **`glue.mjs` + `glue.wasm`** (не `module.wasm`). Это влияет на Task 20 (build-cpp), Task 22 (runner-node), Task 23 (runner-web).

### Tool versions
- Изначально `rustc: 1.85.0` в плане — слишком старо для wasm-pack 2026-го. Поднято до `1.95.0`.
- `emscripten: 4.0.0` → `5.0.7` (фактическая установленная версия).
- `wasm-opt: 120` → `129`.

### .npmrc + esbuild pin
- `.npmrc` с `engine-strict=true` создан (was missing). `esbuild: 0.24.0` добавлен в `tool-versions.json` (пропущен изначально).

### `exactOptionalPropertyTypes: true` в tsconfig.base.json
- Это значит `glueUrl?: string` НЕ принимает `undefined`. В `loaders/types.ts` тип `LoaderInput.glueUrl?: string | undefined` явно. Будущие места передавать `glueUrl` тоже могут потребовать это.

### `noUncheckedIndexedAccess: true` в tsconfig.base.json
- В `bench-impl/*` пакетах (matmul JS idiomatic, typed-array) этот флаг **отключён локально** через `compilerOptions.noUncheckedIndexedAccess: false`. Иначе нужны NN-asserts на каждом array access — нечитабельно для алгоритмики.

### `Uint8Array<ArrayBuffer>` vs `ArrayBufferLike`
- В `loaders/raw-wasm.ts` `fetchBytes()` явно возвращает `Uint8Array<ArrayBuffer>` (не `Uint8Array<ArrayBufferLike>`). `WebAssembly.compile` строго требует `ArrayBuffer`-typed buffer. При readFile (returns Buffer) делаем явное копирование в new ArrayBuffer.

### `fetchBytes` URL detection
- Изначально план: `url.startsWith("/")` → fetch (HTTP). Но `/Users/...` это абсолютный filesystem path. Логика поправлена: `http(s)://` → fetch; `file://` или absolute path → readFile.

---

## Полезные команды

### Локальный sanity-check имплементации
```bash
# JS
pnpm exec tsx -e '
import("./benches/matmul/js/typed-array/src/index.ts").then(async (m) => {
  const fs = await import("node:fs");
  const buf = fs.readFileSync("benches/matmul/fixtures/s.bin");
  const mod = m.default();
  mod.loadInput(new Uint8Array(buf));
  console.log("S =", mod.run(1).checksum);
});
'

# Rust raw
cd benches/matmul/rust/raw && cargo build --release --target wasm32-unknown-unknown
cd ../../../..
pnpm exec tsx -e '
import { rawWasmLoader } from "@bench/loaders";
import { readFileSync } from "node:fs";
(async () => {
  const buf = readFileSync("benches/matmul/fixtures/s.bin");
  const wasmPath = "benches/matmul/rust/raw/target/wasm32-unknown-unknown/release/matmul_rust_raw.wasm";
  const loaded = await rawWasmLoader.load({ artifactUrl: wasmPath });
  loaded.module.loadInput(new Uint8Array(buf));
  console.log("S =", loaded.module.run(1).checksum);
})();
'

# Rust bindgen
cd benches/matmul/rust/bindgen
wasm-pack build --target web --release --out-dir pkg-tmp
ls pkg-tmp/
rm -rf pkg-tmp
cd ../../../..

# C++ Emscripten
benches/matmul/cpp/build-emscripten.sh speed /tmp/em-test
ls /tmp/em-test/

# C++ wasi-sdk
benches/matmul/cpp/build-wasi-sdk.sh speed /tmp/wasi-test
ls /tmp/wasi-test/
```

### Запуск тестов
```bash
pnpm -r --parallel test     # все пакеты
pnpm --filter @bench/harness test
pnpm --filter @bench/result-schema test
pnpm --filter @bench/loaders test
```

---

## Восстановление контекста для следующей сессии

Запросите у меня прочитать в таком порядке:

1. **`docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`** — дизайн-спека (одобрена, неизменяемая основа)
2. **`docs/superpowers/plans/2026-05-01-wasm-benchmarks-phase-1-0.md`** — план (актуализированный с патчами)
3. **`docs/superpowers/session-states/session-state-2026-05-01.md`** ← этот файл
4. **`git log --oneline phase-1-0 ^master`** — список коммитов

Затем мы продолжим с Task 17 (scripts/lib helpers) inline.

---

## После Phase 1.0

После Tag `phase-1-0` (по плану Task 29 step 7) — separate brainstorming → writing-plans для Phase 1.1 (`interop_calls`, `hashmap_workload`, `shape_dispatch`). Phase 1.1 планируется на стабильной инфраструктуре после Phase 1.0.
