# wasm-rust-cpp-js

Бенчмарки для wasm: сравниваем C++, Rust и JS по двум осям — **размер артефакта** (raw / gzip / brotli) и **runtime-перформанс** (init, first call, warm median / p95). Прогоняются в Node и в браузере (Chromium, Firefox) одним и тем же кодом нагрузки.

> **Статус:** Phase 1.0 завершён. Доступен один workload — `matmul` (наивное dense f64 O(n³) умножение матриц), 10 имплементаций × профилей: JS×2, Rust×2 (raw / wasm-bindgen) × 2 профиля (speed / size, кроме JS), C++×2 (Emscripten / wasi-sdk freestanding) × 2 профиля. Phase 1.1 (`interop_calls`, `hashmap_workload`, `shape_dispatch`) — отдельная фаза, ещё не реализована.

---

## Содержание

- [Что измеряется](#что-измеряется)
- [Системные требования](#системные-требования)
- [Установка зависимостей](#установка-зависимостей)
- [Сборка](#сборка)
- [Запуск бенчмарков](#запуск-бенчмарков)
- [Отчёт](#отчёт)
- [Воспроизводимость](#воспроизводимость)
- [Структура репозитория](#структура-репозитория)
- [Документация дизайна](#документация-дизайна)
- [Известные ограничения](#известные-ограничения)

---

## Что измеряется

Каждый прогон одной combo (например `rust/bindgen/speed × S × chromium`) выдаёт JSON, валидируемый zod-схемой `BenchResult`:

- **Размер** артефакта: raw / gzip / brotli байты, sha256 хэш каждого файла.
- **Init phases**: fetch, compile, instantiate, initTotal (мс).
- **First call**: время первого вызова `run()` (мс) — ловит JIT warm-up.
- **Warm samples**: median, p95, p99, stddev, min, max + n samples + cv (коэффициент вариации). Сэмплирование останавливается, когда cv ≤ 5% или достигнут лимит.
- **Memory**: peak / delta wasm linear memory, jsHeapUsedAfter (если доступно).
- **Quality**: validated checksum, флаг correctnessFailed.
- **Окружение**: OS/CPU, JS-движок, версии тулчейнов, фичи wasm.

Корректность каждой имплементации фиксируется reference-checksum'ом (сумма `||C||₂` округлённая) — все 10 имплементаций обязаны выдать **bit-for-bit одинаковый** double:

| Размер | n×n      | Reference checksum  |
| ------ | -------- | ------------------- |
| S      | 64×64    | 8505.752465030815   |
| M      | 256×256  | 275996.81878375803  |
| L      | 1024×1024| (см. `benches/matmul/spec.json`) |

---

## Системные требования

- **macOS** (тестировалось на darwin arm64) или **Linux**. Windows не тестировался; Bash + GNU tools предполагаются.
- **Node ≥ 22.0.0**, **pnpm ≥ 9** — управляются через `packageManager` поле и `engines`.
- **Rust 1.95.0** — выбирается автоматически через `rust-toolchain.toml` после установки rustup.
- **wasm-pack 0.13.1** (cargo install).
- **Binaryen / wasm-opt 129** — отдельный бинарь, ставится через системный пакет-менеджер.
- **Emscripten 5.0.7** (через emsdk).
- **wasi-sdk 25** — скачивается ZIP-ом, переменная окружения `WASI_SDK_PATH` указывает на корень.

Точные версии зафиксированы в [`tool-versions.json`](./tool-versions.json). При расхождении любой версии артефакты и тайминги будут отличаться — формально такой прогон **не воспроизводим** относительно референсного.

---

## Установка зависимостей

### 1. Node + pnpm

```bash
# через nvm (рекомендуется)
nvm install 22
nvm use 22

# pnpm включается через corepack
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

Проверка: `node --version` → `v22.x.x`, `pnpm --version` → `9.15.0`.

### 2. Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# принять параметры по умолчанию

# rust-toolchain.toml в репозитории зафиксирует rustc 1.95.0 +
# таргет wasm32-unknown-unknown автоматически при первом cargo build.
```

```bash
cargo install wasm-pack --version 0.13.1
```

Проверка: `rustc --version` → `1.95.0`, `wasm-pack --version` → `0.13.1`.

### 3. wasm-opt (Binaryen)

```bash
# macOS
brew install binaryen   # установит свежую версию; убедитесь, что 129+

# Ubuntu / Debian
sudo apt install binaryen   # может быть старее; см. ниже

# Если системного пакета мало — скачать релиз вручную:
# https://github.com/WebAssembly/binaryen/releases/tag/version_129
```

Проверка: `wasm-opt --version` → `wasm-opt version 129` (или новее).

### 4. Emscripten (emsdk)

```bash
git clone https://github.com/emscripten-core/emsdk ~/emsdk
cd ~/emsdk
./emsdk install 5.0.7
./emsdk activate 5.0.7
source ./emsdk_env.sh   # добавляет emcc в PATH
```

`emsdk_env.sh` нужно сорсить **в каждом новом терминале**, где собирается C++/Emscripten вариант.

Проверка: `emcc --version` → начинается с `5.0.7`.

### 5. wasi-sdk

```bash
# Скачать релиз 25 для своей платформы:
#   https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-25
# Распаковать куда угодно, затем:
export WASI_SDK_PATH=/path/to/wasi-sdk-25
# (положить в ~/.zshrc / ~/.bashrc для постоянства)
```

Проверка: `$WASI_SDK_PATH/bin/clang --version` должен отвечать.

### 6. Воркспейсные зависимости

```bash
cd /path/to/wasm-rust-cpp-js
pnpm install
```

### 7. Браузеры для Playwright (только для прогона в браузере)

```bash
pnpm --filter @bench-app/runner-web exec playwright install chromium firefox
```

Скачивает ~300 MB в `~/Library/Caches/ms-playwright/` (на macOS).

---

## Сборка

### Всё сразу

```bash
pnpm build:all
```

Делает по порядку:

1. Генерирует фикстуры (`benches/matmul/fixtures/{s,m,l}.bin`).
2. Копирует фикстуры и `spec.json` в `dist/matmul/` (для browser-фетчинга через Vite publicDir).
3. Бандлит JS — esbuild ESM, минификация, ES2022 → `dist/matmul/js-{idiomatic,typed-array}-speed/module.js`.
4. Собирает Rust raw (no_std) и wasm-bindgen в обоих профилях, прогоняет `wasm-opt -Oz` на size → `dist/matmul/rust-{raw,bindgen}-{speed,size}/`.
5. Собирает C++ через Emscripten (`glue.mjs` + `glue.wasm`) и через wasi-sdk freestanding (`module.wasm`), оба × {speed, size} → `dist/matmul/cpp-{emscripten,wasi-sdk}-{speed,size}/`.

После успешного прогона в `dist/matmul/` будет 10 combo-папок + `fixtures/` + `spec.json`. Каждая combo-папка содержит артефакт(ы) и `meta.json` с размерами и хэшами.

### Только одна цепочка

```bash
pnpm build:js     # только JS
pnpm build:rust   # только Rust (требует rustc + wasm-pack + wasm-opt)
pnpm build:cpp    # только C++ (требует emcc + wasi-sdk + wasm-opt)
```

---

## Запуск бенчмарков

### Smoke — sanity-чек

```bash
pnpm smoke
```

~30 секунд: запускает quick-режим на S × все combos × только Node, генерит mini-отчёт. Полезно перед длинным прогоном.

### Один кейс — Node

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=matmul \
  --language=rust --toolchain=raw --profile=speed \
  --size=S \
  --out=results/raw/single \
  --mode=quick   # или eval
```

### Один кейс — браузер

В одном терминале:

```bash
pnpm --filter @bench-app/runner-web dev   # Vite на порту 5174
```

В другом:

```bash
pnpm --filter @bench-app/runner-web drive \
  --benchmark=matmul \
  --language=cpp --toolchain=emscripten --profile=size \
  --size=S \
  --browser=chromium \
  --out=results/raw/single \
  --mode=quick
```

### Полная матрица

```bash
pnpm bench --envs=node,chromium,firefox --sizes=S,M --mode=quick --out=results/raw/<run-name>
```

`run-matrix.ts` автоматически поднимает Vite-сервер на 5174, если в `--envs` есть браузер, и шлёт ему SIGTERM в `finally`.

Параметры:

- `--envs=node,chromium,firefox` (любая подмножество).
- `--sizes=S,M,L` (любое подмножество; M ~50–100×S по нагрузке, L ~1000×).
- `--mode=quick` (5–10 сэмплов) или `--mode=eval` (30–100 сэмплов с CV-стопом).
- `--out=<dir>` (по умолчанию `results/raw/<ISO timestamp>`).

Каждый кейс пишет `<benchmark>__<lang>-<toolchain>-<profile>__<size>__<env>.json`. 10 combos × N sizes × M envs = `10·N·M` файлов.

### Полный пайплайн end-to-end

```bash
pnpm bench:all
# == pnpm build:all && pnpm bench --mode=eval && pnpm report
```

Долго (десятки минут в `eval`). Используется для финальных замеров.

---

## Отчёт

```bash
pnpm report --in=results/raw/<run-name>
# или без --in: возьмёт самый свежий каталог под results/raw/
```

Создаёт `results/summarized/<ISO timestamp>/index.html` — статичный HTML с таблицей по каждому benchmark'у. Строки шумных кейсов (cv > порога) подсвечены жёлтым, упавшие correctness — красным.

Каждый JSON-результат прогоняется через `BenchResultSchema.parse` перед агрегацией — невалидный файл будет ошибкой.

---

## Воспроизводимость

Цель — чтобы при тех же версиях тулчейнов на той же машине вы получили **bit-for-bit те же checksum'ы** и тайминги в пределах cv. Гарантии:

- Все версии тулов пиннутся в `tool-versions.json` и `rust-toolchain.toml`.
- `pnpm` использует `packageManager` для self-pin'а.
- Внешние пакеты pin'ятся в `pnpm-lock.yaml` (коммитится).
- `wasm-opt` явно вызывается с `--enable-bulk-memory --enable-nontrapping-float-to-int` для размер-профилей Rust/C++ — иначе свежий `rustc` / `emcc` пишут операции, которые wasm-opt без этих флагов отвергает.
- В `meta.json` каждой combo-папки лежит обнаруженная версия каждого тула. Расхождение с `tool-versions.json` не блокирует прогон, но означает, что результат не воспроизведёт референс.

Reference checksums S/M зашиты в `benches/matmul/spec.json`; runner валидирует первый вызов `run()` — несовпадение с reference сразу останавливает кейс с `correctnessFailed: true`.

---

## Структура репозитория

```
.
├── benches/matmul/                 # сам benchmark
│   ├── spec.json                   # reference checksums + fixture sha256
│   ├── fixtures/                   # генерируемые .bin (gitignored)
│   ├── js/{idiomatic,typed-array}/ # JS-имплементации (TS source)
│   ├── rust/{raw,bindgen}/         # Rust-крейты
│   ├── cpp/                        # общий .cpp + два build-скрипта
│   └── validate/                   # справочный TS, генерит ожидаемые checksum'ы
│
├── packages/                       # библиотечные пакеты воркспейса
│   ├── result-schema/              # zod-схема BenchResult + типы
│   ├── harness/                    # measure loop, stats, validation
│   ├── loaders/                    # пять loader'ов (plain-js, raw-wasm, rust-bindgen, emscripten)
│   └── reporter/                   # aggregate + renderHtml
│
├── apps/                           # CLI-драйверы
│   ├── runner-node/                # один кейс в Node
│   └── runner-web/                 # Vite + Worker + Playwright
│
├── scripts/                        # оркестраторы сборки и прогона
│   ├── lib/                        # matrix, exec, meta, tool-versions
│   ├── build-{js,rust,cpp,all}.ts  # сборка
│   ├── run-matrix.ts               # прогон матрицы
│   ├── report.ts                   # сборка HTML
│   └── smoke.ts                    # быстрый sanity-pipe
│
├── docs/superpowers/
│   ├── specs/  …design.md          # дизайн-спека (immutable)
│   └── plans/  …phase-1-0.md       # план реализации Phase 1.0
│
├── tool-versions.json              # пины внешних тулов
├── rust-toolchain.toml             # rust 1.95.0 + wasm32-unknown-unknown
├── pnpm-workspace.yaml             # packages/*, apps/*, benches/matmul/js/*
└── tsconfig.base.json              # strict + verbatimModuleSyntax + …
```

---

## Документация дизайна

- **`docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`** — дизайн-спека, объясняет, что и зачем измеряется, обоснование выбранного workload'а, контракты `BenchModule` / `Loader`, формат `BenchResult`. Читать первой.
- **`docs/superpowers/plans/2026-05-01-wasm-benchmarks-phase-1-0.md`** — пошаговый план Phase 1.0 (29 задач). Полезно как индекс по коду.

---

## Известные ограничения

- **Один workload.** Phase 1.0 ограничен `matmul` — это compute-bound с тривиальной wasm-side памятью; cost модели loader'ов / interop / dispatch здесь почти не видно.
- **`navigator.platform` в Firefox.** Firefox 110+ выдаёт пустой `navigator.platform`; runner стампит `machine.os` со стороны Node host'а, чтобы не получать пустоту в результате.
- **Таймеры `performance.now()` в браузере.** Без cross-origin isolation Chromium квантует до 100 µs, Firefox — до 1 ms (Spectre mitigation). Phase 1.0.5 Wave 4 включил COI (COOP+COEP headers в Vite dev/preview servers), что подняло precision до ~5 µs (Chromium) и ~20 µs (Firefox). На S-размере без COI samples были 0/1 ms binary — теперь видны реальные fractional values.
- **⚠️ Playwright Firefox env — не репрезентативен реальному Firefox.** Playwright поставляет patched Firefox **Nightly** build (148.0.2 с Juggler protocol), в котором optimizing JIT (Ion) для wasm не accessible. Manual runs реального Firefox показывают ≈ Chrome speed для wasm matmul (~5 ms / M cpp/emscripten/size); Playwright Firefox показывает ~125 ms (~25× artifact). System Firefox c Playwright не работает (требуется Juggler patch). FF cells текущих результатов — это «automation-tool reading», не Firefox engine performance. Полное расследование: [`docs/superpowers/notes/2026-05-05-perf-now-precision.md`](docs/superpowers/notes/2026-05-05-perf-now-precision.md). Migration на BiDi+geckodriver+system Firefox запланирована в Phase 1.0.6 / 1.1.
- **Mac CPU без подавления throttling.** Никаких `cpuset`/`taskset`/turbo-boost lock'ов не делается; на лэптопе на батарее cv может вылетать выше 5%.
- **wasm-pack 0.13.1 + Rust 1.95.0**: внутренний wasm-opt из wasm-pack отключён через Cargo metadata, потому что валится на современный output. Внешний `wasm-opt` запускается build-скриптом отдельно.
- **Тег `phase-1-0` совпадает с именем удалённой ветки.** Технически это легально (refs/tags vs refs/heads), но git кидает `warning: refname 'phase-1-0' is ambiguous` при `git rev-parse phase-1-0`. Используйте `refs/tags/phase-1-0` если нужно однозначно.
