# Phase 1.0.5 — Housekeeping (design spec)

**Дата:** 2026-05-04
**Статус:** brainstorm complete, awaiting user review
**Ветка для реализации:** `feature/phase-1-0-5`
**Финальный артефакт:** tag `phase-1-0-5` после merge в `master`

## Цель

Закрыть UX-долги Phase 1.0 и ввести quality gates **до** Phase 1.1. Кодовая база в Phase 1.1 утроится (три новых workload'а: `interop_calls`, `hashmap_workload`, `shape_dispatch`); фиксить эти же боли потом будет в три раза дороже.

## Out of scope

- Новые workload'ы (это Phase 1.1).
- CI/GitHub Actions.
- Кросс-платформенность auto-deps installer'а — только macOS arm64.
- Полный nix/devcontainer/mise setup.
- Известные ограничения Phase 1.0 из README (CPU lock, FF/Chrome `performance.now` quantization сама по себе) — НЕ трогаем, кроме того, что выявит Wave 4.
- `clang-tidy` для C++ — оставляем как открытый тикет.

## Структура — 5 waves

Подход A («Quality gates first, infra last»): quick wins → quality → rust → firefox investigation → auto-deps. Каждая волна закрывается до старта следующей. Wave 5 — finальный exit-point: если затягивается, можно отрезать в Phase 1.0.6 без блокировки Phase 1.1.

---

## Wave 1 — Quick wins

Время: ~0.5 дня. Три маленькие правки, сразу улучшают «caress» проекта.

### 1.1 `pnpm clear` и `pnpm clear:all`

Цель: одной командой убрать все автогенерируемые ресурсы для проверки «с чистого листа».

**Реализация:** `scripts/clear.ts`, идемпотентный (не падает на отсутствующих путях), вызывается через `pnpm clear`.

**`pnpm clear` удаляет:**

- `dist/` (build artifacts)
- `results/` (целиком — там только `raw/` и `summarized/`)
- `benches/matmul/rust/raw/target/`
- `benches/matmul/rust/bindgen/target/`
- `benches/matmul/rust/bindgen/pkg-tmp/`
- `apps/runner-web/.vite/` (vite cache, если есть)
- `apps/runner-web/test-results/`, `apps/runner-web/playwright-report/` (если есть)

После Wave 3 список расширится с учётом workspace-target (если будет один общий `target/` — он заменит per-crate target'ы).

**`pnpm clear:all` дополнительно удаляет:**

- `node_modules/` на всех уровнях монорепо
- `.tools/` (cache из Wave 5)

**НЕ удаляем никогда:**

- `~/Library/Caches/ms-playwright/` (общая для системы)
- Системные emsdk/wasi-sdk/rustup кэши

### 1.2 Units in HTML report

В `packages/reporter/src/render-html.ts` (или где живёт рендеринг) поменять заголовки таблицы:

| Сейчас | Стало |
|---|---|
| `wasm raw` | `wasm raw (B)` |
| `wasm gz` | `wasm gz (B)` |
| `total gz` | `total gz (B)` |
| `init` | `init (ms)` |
| `first` | `first (ms)` |
| `cv` | `cv` (без скобок — безразмерный) |
| `ok` | `ok` (boolean) |
| `warm med (ms)` | без изменений |
| `warm p95 (ms)` | без изменений |

### 1.3 Fix exit 143 в `pnpm bench:all`

Симптом: после успешного прогона торчит `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @bench-app/runner-web@0.0.0 dev: vite, Exit status 143`.

**Гипотеза:** vite dev-server для web-runner'а запущен через `pnpm -r --parallel run dev`; harness в `scripts/run-matrix.ts` посылает SIGTERM (143 = 128+15), pnpm wrapper интерпретирует как failure.

**Fix:** не запускать vite через pnpm wrapper. Стартовать напрямую через `execa('pnpm', ['--filter', '@bench-app/runner-web', 'run', 'dev'], { detached: false })` и при teardown посылать SIGTERM именно этому child process'у, а не через pnpm-wrapper.

**Acceptance:** `pnpm bench:all` завершается с exit code 0 и без ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL в выводе.

---

## Wave 2 — Quality gates

Время: ~1.5–2 дня. Поднимаем «потолок» дисциплины кода до Phase 1.1.

### 2.1 ESLint + @stylistic + 4-space indent (TS)

**Стек:**

- `eslint` с flat config (`eslint.config.js` в корне)
- `typescript-eslint` (parser + recommended-type-checked)
- `@stylistic/eslint-plugin` для форматирования (вместо prettier — пользовательский выбор)

**Стилистические правила:**

- 4-space indent
- Double quotes (как в существующем коде)
- Semicolons обязательны
- Trailing comma multiline
- `curly: ["error", "all"]` — форсит фигурные скобки везде
- `@stylistic/brace-style: ["error", "1tbs"]` — открывающая `{` на той же строке, тело — с новой строки. Цель: запретить `if (x) foo();` в одну строку.

**Type-checked rules:**

- `typescript-eslint`'s `recommended-type-checked`. Использует tsc для type info, медленнее, но ловит реальные баги.
- `no-console: "warn"` глобально, override `"off"` для `scripts/**`.
- НЕ включаем `eslint-plugin-import` (дорого без явной потребности).

**Применение к существующему коду:** `pnpm lint:ts:fix` один раз по всему репо → один большой commit `refactor(ts): apply eslint + stylistic`. Болезненный diff, но дальше — никогда.

**Bench-impl пакеты:** в `benches/matmul/js/*/tsconfig.json` локально отключён `noUncheckedIndexedAccess`. ESLint туда тоже не должен лезть с лишним строгим, но базовые правила и indent — да. Override в `eslint.config.js` через `files: ["benches/**"]` с relaxed type-checked.

### 2.2 C++ flags

Базовый набор для **обоих** build-скриптов (`build-emscripten.sh`, `build-wasi-sdk.sh`):

```
-std=c++23
-Wall -Wextra -Wpedantic -Werror
-Wshadow -Wconversion -Wsign-conversion
-Wcast-align -Wold-style-cast -Wnon-virtual-dtor
-Wnull-dereference -Wdouble-promotion
```

`-std=c++23` фиксирует версию языка явно — раньше полагались на default компилятора, что менялось от версии к версии. Текущие emcc 5.0.x и wasi-sdk 25 (clang 19+) поддерживают C++23. Если в существующем коде что-то ругается — фиксим в этом же PR.

**НЕ добавляем:**

- `-Weffc++` — слишком noisy для тривиального кода.
- `-Wuseless-cast` — gcc-only, у нас clang.
- `-fsanitize=*` — runtime, для wasm artifact'а не нужно.

`-Werror` — blocking. Если что-то ругается на текущий код — фиксим в этом же PR.

### 2.3 Rust flags + warnings

**Источник:** `[lints]` в Cargo.toml каждого crate (стабильно с 1.74+; у нас 1.95).

**Базовый набор для всех crate'ов:**

```toml
[lints.rust]
warnings = "deny"
unsafe_op_in_unsafe_fn = "deny"
unsafe_code = "warn"

[lints.clippy]
all = "deny"
pedantic = "warn"
nursery = "warn"
```

После Wave 3 (workspace root) можно вынести через `[workspace.lints]` + `[lints] workspace = true` в каждом crate'е.

**Применение в Wave 2:** `cargo clippy --all-targets -- -D warnings` per-crate (`raw`, `bindgen`). Чинить всё, что вылезет, в этом же PR. После Wave 3.1 (workspace root) — переход на `--workspace`.

### 2.4 Команды линтеров

Структура (pull request requested by user):

| Команда | Что делает |
|---|---|
| `pnpm lint:ts` | `eslint .` |
| `pnpm lint:ts:fix` | `eslint . --fix` |
| `pnpm lint:rust` | До Wave 3: `cargo clippy --all-targets -- -D warnings` per-crate. После Wave 3.1 (workspace root): `cargo clippy --workspace --all-targets -- -D warnings` |
| `pnpm lint:all` | `pnpm lint:ts && pnpm lint:rust` |

**`pnpm lint:cpp` НЕ делаем** — отдельного fast-линтера для C++ нет, а warnings ловятся в build с `-Werror`. `clang-tidy` — открытый тикет.

CI/pre-commit hooks не добавляем (CI нет, hooks пользователь не просил).

---

## Wave 3 — Rust hygiene

Время: ~1.5–2 дня. Самая инженерно-интересная wave: устраняем дублирование алгоритма и сокращаем unsafe до минимума.

### 3.1 Cargo workspace root + edition 2024

Создаём `Cargo.toml` в корне репо:

```toml
[workspace]
resolver = "3"
members = [
    "benches/matmul/rust/shared",
    "benches/matmul/rust/raw",
    "benches/matmul/rust/bindgen",
]

[workspace.package]
edition = "2024"
version = "0.0.0"

[workspace.lints.rust]
warnings = "deny"
# ...

[workspace.lints.clippy]
all = "deny"
# ...
```

Все три member-crate'а поднимаем с edition `"2021"` до `"2024"` (через `[package] edition.workspace = true`).

**Профиты edition 2024:**

- `unsafe_op_in_unsafe_fn` — в 2024 default = `warn` (был `allow`); наш `deny` поверх остаётся осмысленным.
- Atribute `#[no_mangle]` теперь требует обёртку: `#[unsafe(no_mangle)]`. Применим при рефакторинге (3.3).
- `core::ptr::addr_of!` deprecated в пользу `&raw const X` / `&raw mut X`. Тоже мигрируем в (3.3).
- `static mut` без обёртки — стало hard error в 2024. Это естественно стыкуется с целью убрать `static mut` в (3.3) и (3.4).

`resolver = "3"` — default для edition 2024.

Профиты workspace: один общий `target/`, `cargo clippy --workspace`, единый источник lint-настроек.

`pnpm clear` после этого должен очищать корневой `target/` вместо per-crate.

### 3.2 Shared algorithm crate

Создаём `benches/matmul/rust/shared/`:

```
shared/
  Cargo.toml
  src/lib.rs
```

`src/lib.rs`:

```rust
#![no_std]

pub fn matmul_naive(a: &[f64], b: &[f64], c: &mut [f64], n: usize) {
    for x in c.iter_mut() { *x = 0.0; }
    for i in 0..n {
        for k in 0..n {
            let aik = a[i * n + k];
            for j in 0..n {
                c[i * n + j] += aik * b[k * n + j];
            }
        }
    }
}

pub fn abs_sum(c: &[f64]) -> f64 {
    let mut s = 0.0_f64;
    for &x in c.iter() {
        s += abs(x);
    }
    s
}

#[inline]
fn abs(x: f64) -> f64 { if x < 0.0 { -x } else { x } }
```

`f64::abs` доступен начиная с Rust 1.43, но требует `std`. В `no_std` пишем свой `abs` — 4 строки, прозрачно.

**`Cargo.toml`:**

```toml
[package]
name = "matmul-shared"
version.workspace = true
edition.workspace = true

[lib]
crate-type = ["rlib"]

[lints]
workspace = true
```

### 3.3 raw crate — рефакторинг

`benches/matmul/rust/raw/Cargo.toml`:

```toml
[dependencies]
matmul-shared = { path = "../shared" }
```

`benches/matmul/rust/raw/src/lib.rs` — целевая структура (FFI остаётся, алгоритма больше нет; синтаксис edition 2024):

```rust
#![no_std]

use core::panic::PanicInfo;
use core::cell::UnsafeCell;
use matmul_shared::{matmul_naive, abs_sum};

#[panic_handler]
fn on_panic(_: &PanicInfo) -> ! { loop {} }

const HEAP_SIZE: usize = 32 * 1024 * 1024;

// Wasm32 single-threaded — UnsafeCell wrapper достаточен для глобального
// мутабельного состояния. Все unsafe-блоки локализованы и документированы.
struct GlobalHeap(UnsafeCell<[u8; HEAP_SIZE]>);
unsafe impl Sync for GlobalHeap {}
static HEAP: GlobalHeap = GlobalHeap(UnsafeCell::new([0u8; HEAP_SIZE]));

struct GlobalState {
    next: UnsafeCell<usize>,
    n: UnsafeCell<usize>,
    a_off: UnsafeCell<usize>,
    b_off: UnsafeCell<usize>,
    c_off: UnsafeCell<usize>,
}
unsafe impl Sync for GlobalState {}
static STATE: GlobalState = /* ... */;

#[unsafe(no_mangle)]
pub extern "C" fn alloc(sz: u32) -> u32 {
    // SAFETY: wasm32 single-threaded; STATE.next и HEAP не используются
    // из других потоков; alloc() — единственная точка мутации STATE.next.
    unsafe {
        let next = &mut *STATE.next.get();
        let p = *next;
        *next = (*next + sz as usize + 7) & !7;
        if *next > HEAP_SIZE { return u32::MAX; }
        // edition 2024: &raw const вместо deprecated addr_of!
        (&raw const (*HEAP.0.get())[0]) as usize as u32 + p as u32
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn run(iters: u32) -> f64 {
    let (a, b, c, n) = unsafe { get_slices() };  // safe call дальше
    let mut last = 0.0;
    for _ in 0..iters {
        matmul_naive(a, b, c, n);
        last = abs_sum(c);
    }
    last
}

// SAFETY: caller гарантирует, что load_input() был вызван и установил
// валидные указатели в HEAP. Wasm32 single-threaded — borrow checker
// даёт &mut [f64] эксклюзивно на время вызова run().
unsafe fn get_slices<'a>() -> (&'a [f64], &'a [f64], &'a mut [f64], usize) { /* ... */ }
```

Edition 2024 примечания для raw crate:

- `#[no_mangle]` → `#[unsafe(no_mangle)]` для всех экспортов: `alloc`, `load_input`, `run`, `output_ptr`, `output_len`, `reset`.
- `core::ptr::addr_of!(HEAP)` → `&raw const HEAP` (или эквивалент через `UnsafeCell::get()`).
- `static mut` — вообще не используем; вся мутация через `UnsafeCell`.

**Цель по unsafe:** ≤ 4 unsafe-блоков, каждый ≤ 5 строк, каждый с `// SAFETY: ...` комментарием.

### 3.4 bindgen crate — рефакторинг

`benches/matmul/rust/bindgen/Cargo.toml`:

```toml
[dependencies]
wasm-bindgen = "0.2"
matmul-shared = { path = "../shared" }
```

`benches/matmul/rust/bindgen/src/lib.rs` — убираем `static mut`, переходим на `thread_local!` (wasm32 single-threaded → singleton):

```rust
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use matmul_shared::{matmul_naive, abs_sum};

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

#[derive(Default)]
struct State { n: usize, a: Vec<f64>, b: Vec<f64>, c: Vec<f64> }

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let total_f64 = buf.len() / 8;
    let half = total_f64 / 2;
    let n = (half as f64).sqrt() as usize;
    debug_assert!(n * n == half);
    // SAFETY: buf — валидный байтовый слайс; преобразование к &[f64]
    // безопасно, т.к. align(f64)=8 и длина кратна 8 (debug_assert).
    let f64s: &[f64] = unsafe {
        core::slice::from_raw_parts(buf.as_ptr() as *const f64, total_f64)
    };
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.n = n;
        s.a = f64s[0..n*n].to_vec();
        s.b = f64s[n*n..2*n*n].to_vec();
        s.c = vec![0.0; n*n];
    });
}

#[wasm_bindgen]
pub fn run(iters: u32) -> f64 {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let n = s.n;
        let mut last = 0.0;
        // borrow checker не разрешит одновременно &s.a и &mut s.c —
        // используем split_at_mut на c (он отдельный Vec, проблем нет).
        for _ in 0..iters {
            matmul_naive(&s.a, &s.b, &mut s.c, n);
            last = abs_sum(&s.c);
        }
        last
    })
}
```

**Цель по unsafe:** 1 unsafe-блок (cast `&[u8]` → `&[f64]`), документирован. Без `bytemuck` — пользователь предпочёл явный код.

Edition 2024 для bindgen crate: `#[wasm_bindgen]` не задет (это derive macro, не attribute). `static mut` уже убран — `thread_local!` + `RefCell`. Никаких других edition-specific миграций не требуется.

### 3.5 Decision point

Если в реализации выяснится, что generic shared-crate не покрывает обе модели памяти cleanly (например, `&'static mut [f64]` для raw нельзя получить через safe API без unsafe-конструкции, делающей shared API неудобным) — **fallback** на «два crate'а с одинаковым стилем» (одинаковые имена переменных, порядок функций, заголовки секций). Эта развилка — в плане как явный gate после первой рабочей версии shared-crate'а.

---

## Wave 4 — Firefox / Chrome precision investigation

Время: ~1.5 дня. Investigation-only — fix зависит от findings.

### 4.1 Структура расследования (3 gates)

**Gate 1 — Baseline данные.** Запускаем M-size matmul cpp/emscripten/size во всех трёх средах (firefox, chromium, node) с инструментацией:

- Логируем raw `performance.now()` для каждой sample, не только агрегаты.
- Логируем фактическое количество iterations внутри одного sample.
- Логируем resolution `performance.now()` через busy-loop:
  ```js
  const p = performance.now();
  while (performance.now() === p) {}
  const resolution = performance.now() - p;
  ```

**Gate 2 — Quantization hypothesis.** Если Firefox показывает resolution = 1ms (или 2ms), а Chrome ≪ 1ms:

- **Найдено.** Fix: bump iterations per sample так, чтобы каждая sample длилась ≥ 10ms во всех средах. В harness — динамический iteration count: подбирать так, чтобы первая warm sample была ≥ 10ms.
- **Не подтвердилось** (FF resolution тоже ≪ 1ms): → Gate 3.

**Gate 3 — Liftoff/baseline JIT hypothesis.** Тестируем через `firefoxUserPrefs` в `apps/runner-web/playwright.config.ts`:

```ts
firefox: {
    launchOptions: {
        firefoxUserPrefs: {
            "javascript.options.wasm_baselinejit": false,
            "javascript.options.wasm_optimizingjit": true,
        },
    },
},
```

- **Если разница исчезла** (FF timings приблизились к Chrome) → fix через prefs (закоммитить в playwright config + документировать).
- **Если не исчезла** → harness overhead unlikely (CV маленький, проблема стабильная), но проверить wasm.compile/instantiate hot path в loader. Если ничего → **STOP**, документируем findings, переносим в Phase 1.0.6.

### 4.2 Acceptance criteria

- Findings задокументированы в `docs/superpowers/notes/2026-05-XX-perf-now-precision.md` (включая raw данные resolution в трёх средах).
- Если есть actionable fix — применён, в `pnpm bench:all` results показывают исправление.
- Если actionable fix нет — README обновлён в секции «Известные ограничения» с конкретикой.

---

## Wave 5 — Auto-deps installer (macOS arm64 only)

Время: ~3-5 дней. Финальный exit-point цикла — если затягивается, отрезается в Phase 1.0.6 без блокировки Phase 1.1.

### 5.1 Что ставим

**В `.tools/`:**

- emcc (через emsdk install + activate)
- wasi-sdk
- wasm-opt (binaryen)
- wasm-pack

**Через rustup (idempotent):**

- `rustup target add wasm32-unknown-unknown`

**Pre-installed (не ставим):**

- node, pnpm, rustup, cargo, rust toolchain
- xcode-tools / clang

### 5.2 Структура `.tools/`

```
.tools/
    emsdk/                   ← клон emsdk, после activate
    wasi-sdk-25/             ← распакованный tar.gz
    binaryen-122/            ← распакованный tar.gz, отсюда wasm-opt
    wasm-pack-0.13.1/        ← распакованный tar.gz
    bin/                     ← симлинки на исполняемые в PATH
        emcc → ../emsdk/upstream/emscripten/emcc
        wasm-opt → ../binaryen-122/bin/wasm-opt
        wasm-pack → ../wasm-pack-0.13.1/wasm-pack
    state.json               ← {emcc: "...", wasi: "...", binaryen: "...", wasm-pack: "..."}
```

`.tools/` добавляется в `.gitignore` (расширяем существующий).

### 5.3 Версии и checksums

Расширяем существующий `tool-versions.json`:

```json
{
    "emcc": { "version": "5.0.x", "url": "https://...", "sha256": "..." },
    "wasi-sdk": { "version": "25", "url": "https://...", "sha256": "..." },
    "binaryen": { "version": "122", "url": "https://...", "sha256": "..." },
    "wasm-pack": { "version": "0.13.1", "url": "https://...", "sha256": "..." }
}
```

URL — pinned на конкретные релизы для macOS arm64.

**SHA256 verification — обязательная** (стандартная гигиена для downloaded binaries).

### 5.4 Скрипт `scripts/setup.ts`

Реализация:

1. Читает желаемые версии из `tool-versions.json`.
2. Для каждого тула:
    - Проверяет `.tools/state.json` — есть ли уже нужная версия.
    - Если нет — `curl -fsSL --fail-with-body $url -o $tmpfile`, проверяет SHA256, распаковывает в `.tools/`.
3. Пересоздаёт симлинки в `.tools/bin/`.
4. `rustup target add wasm32-unknown-unknown` (idempotent).
5. `playwright install chromium firefox` (idempotent).

Idempotent: повторный запуск — no-op, если все версии актуальны.

### 5.5 Wiring в build-скрипты

Создаём `scripts/lib/tool-paths.ts`:

```ts
export function emccPath(): string { /* .tools/bin/emcc если есть, иначе PATH */ }
export function wasmOptPath(): string { /* ... */ }
export function wasmPackPath(): string { /* ... */ }
export function wasiSdkPath(): string { /* .tools/wasi-sdk-25 */ }
```

Build-скрипты используют эти функции вместо хардкода `wasm-opt`/`wasm-pack`/etc.

`build-cpp.ts` экспортирует `WASI_SDK_PATH=...` именно для child process (не глобально), перед запуском `build-wasi-sdk.sh`.

emsdk: вместо `source emsdk_env.sh` пишем `scripts/lib/emsdk-env.ts`, экспортирует переменные окружения программно. Удаляем требование «source emsdk_env.sh в каждом терминале».

### 5.6 Команды

| Команда | Действие |
|---|---|
| `pnpm setup` | Запускает `scripts/setup.ts` |
| `pnpm bench:all` | Теперь начинается с `pnpm setup` (idempotent) |

Существующие команды (`pnpm build:*`, `pnpm bench`, etc) — не меняются по поведению, но теперь используют `.tools/bin/*` через `tool-paths.ts`.

### 5.7 Acceptance criteria

На чистом macOS arm64 (без emsdk, wasi-sdk, binaryen, wasm-pack; есть только node + pnpm + rustup + xcode-tools):

```bash
git clone <repo>
cd wasm-rust-cpp-js
pnpm install
pnpm bench:all
```

Должно работать без ручных шагов и завершиться с exit code 0.

Размеры артефактов и timings — те же, что были до Wave 5 (тот же toolchain → те же байты).

---

## Зависимости между waves

- Wave 1 → Wave 2: lint:fix будет править quick-wins код тоже, но это OK — coexist.
- Wave 2 → Wave 3: lint config + cargo lints должны быть на месте до rust-рефакторинга, чтобы новый код сразу был в стиле и без warnings.
- Wave 3 → Wave 4: independent (rust unification ортогонален firefox).
- Wave 4 → Wave 5: independent.
- Wave 5 ничего не блокирует — финальный.

Возможна параллельная работа Wave 4 и Wave 5, но не рекомендую — Wave 4 требует full attention для interpretation findings.

## Открытые тикеты на потом

- `clang-tidy` для C++ (Phase 1.0.6 или позже).
- Linux/Windows вариант auto-deps installer'а (если будет CI).
- CPU throttling lock на macOS / FF baseline JIT (если Wave 4 не закроет).

## Ссылки

- Phase 1.0 design: `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`
- Phase 1.0 plan: `docs/superpowers/plans/2026-05-01-wasm-benchmarks-phase-1-0.md`
- Phase 1.0 session state: `docs/superpowers/session-states/session-state-2026-05-02.md`
