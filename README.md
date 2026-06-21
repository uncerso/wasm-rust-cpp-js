# wasm-rust-cpp-js

Бенчмарки для wasm: сравниваем C++, Rust и JS по двум осям — **размер артефакта** (raw / gzip / brotli) и **runtime-перформанс** (init, first call, warm median / p95). Прогоняются в Node и в браузере (Chromium, Firefox) одним и тем же кодом нагрузки.

Цель проекта не ограничивается самими числами: на их основе накапливаются actionable **guidelines** для продуктовых команд — какие build-флаги, toolchain-комбинации и code-паттерны дают меньший wasm и быстрее runtime, а где trade-off проигрышный. Текущий каталог наблюдений — [`docs/guidelines.md`](./docs/guidelines.md).

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
- [Guidelines](#guidelines)
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

Корректность каждой имплементации фиксируется reference-checksum'ом, который spec.json объявляет per (entry, size). Все имплементации одного entry обязаны выдать **bit-for-bit одинаковый** результат.

Для `matmul` (`||C||₂`, округлённая):

| Размер | n×n      | Reference checksum  |
| ------ | -------- | ------------------- |
| S      | 64×64    | 8505.752465030815   |
| M      | 256×256  | 275996.81878375803  |
| L      | 1024×1024| (см. `benches/matmul/spec.json`) |

Для остальных workloads — checksum-таблицы в их `benches/<id>/spec.json` под полем `expectedChecksums`.

---

## Системные требования

**Pre-installed (системно):**

- **macOS arm64** — auto-install из коробки работает только здесь. Linux/Windows — см. §4 ниже.
- **Node ≥ 22**, **pnpm ≥ 9**.
- **Rust 1.95.0** — через rustup; `rust-toolchain.toml` зафиксирует версию автоматически.
- **Xcode command-line tools** (clang, git, curl).
- ~500 MB свободного места под `.tools/`, интернет для первого `setup-tools`.

**Auto-managed через `pnpm setup-tools`** (ставятся в `.tools/`, не на системный PATH):

- emcc 5.0.7 (через emsdk).
- wasi-sdk 25.
- wasm-opt 129 (binaryen).
- wasm-pack 0.13.1 (через `cargo install --root .tools/wasm-pack-0.13.1`).
- twiggy 0.8.0 (через `cargo install --root .tools/twiggy-0.8.0`) — code-size профайлер для size-атрибуции.
- Firefox stable + geckodriver + Chrome for Testing + chromedriver — см. [Browser versions](#browser-versions).

Точные версии и pinned URL+sha256 — в [`tool-versions.json`](./tool-versions.json). При расхождении артефакты и тайминги будут отличаться — формально такой прогон **не воспроизводим** относительно референсного.

### Browser versions

Web envs (`firefox`, `chromium`) запускаются на pinned production builds, скачиваемых через `pnpm setup-tools` в `.tools/`:

- **Firefox stable** — Mozilla releases (DMG для macOS arm64).
- **Chrome for Testing** — Google's pinnable Chrome builds для automation (ZIP).
- **geckodriver** + **chromedriver** — версии управляются `tool-versions.json` browsers section.

Driver: `selenium-webdriver` (W3C classic). Точные версии — в `tool-versions.json` `browsers`.

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

# rust-toolchain.toml в репозитории зафиксирует rustc 1.95.0
# при первом cargo build. Таргет wasm32-unknown-unknown добавляет
# `pnpm setup-tools` (см. §3).
```

Проверка: `rustc --version` → `1.95.0`.

### 3. Auto-install остальных тулов (macOS arm64)

```bash
cd /path/to/wasm-rust-cpp-js
pnpm install
pnpm setup-tools
```

`setup-tools` (~5–10 мин first-run, ~500 MB):

- скачивает и проверяет sha256 wasi-sdk 25 и binaryen 129 в `.tools/`;
- клонирует и активирует emsdk 5.0.7 в `.tools/emsdk/`;
- ставит wasm-pack 0.13.1 через `cargo install --locked --root .tools/wasm-pack-0.13.1`;
- ставит twiggy 0.8.0 через `cargo install --locked --root .tools/twiggy-0.8.0`;
- добавляет rustup target `wasm32-unknown-unknown`;
- скачивает Firefox stable + geckodriver + Chrome for Testing + chromedriver (DMG / tar.gz / ZIP, sha256-pinned).

Идемпотентен — повторный запуск пропускает то, что уже стоит. `pnpm bench:all` автоматически запускает `setup-tools` первым шагом, так что отдельный вызов нужен только для отладки установки.

### 4. Linux / Windows (вручную)

Auto-install сделан под macOS arm64. На других платформах поставьте версии из `tool-versions.json` любым способом и сделайте чтобы `emcc`, `wasm-opt`, `wasm-pack`, `twiggy` резолвились на PATH; для wasi-sdk выставьте `WASI_SDK_PATH` на корень установленного SDK. Build-скрипты упадут на bare-name резолюцию через PATH когда `.tools/` пуст.

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
4. Собирает Rust raw и wasm-bindgen в обоих профилях, прогоняет `wasm-opt -Oz` на size → `dist/matmul/rust-{raw,bindgen}-{speed,size}/`.
5. Собирает C++ через Emscripten (`glue.mjs` + `glue.wasm`) и через wasi-sdk freestanding (`module.wasm`), оба × {speed, size} → `dist/matmul/cpp-{emscripten,wasi-sdk}-{speed,size}/`.

После успешного прогона в `dist/<workload>/` будет 10 combo-папок + `fixtures/` + `spec.json` под каждый обнаруженный `benches/<id>/spec.json`. Каждая combo-папка содержит артефакт(ы) и `meta.json` с размерами и хэшами.

### Только одна цепочка

```bash
pnpm build:js   <bench-id>…   # только JS-цепочка для указанных workload'ов
pnpm build:rust <bench-id>…   # только Rust (требует rustc + wasm-pack + wasm-opt + twiggy)
pnpm build:cpp  <bench-id>…   # только C++ (требует emcc + wasi-sdk + wasm-opt + twiggy)
```

---

## Запуск бенчмарков

### Smoke — sanity-чек

```bash
pnpm smoke
```

~30 секунд: quick-режим — S × все combos × Node (полная breadth) + matmul × все combos × S × chromium + firefox (sanity для long-lived browser session). Генерит mini-отчёт. Полезно перед длинным прогоном.

### Один кейс — Node

```bash
pnpm exec tsx apps/runner-node/src/main.ts \
  --benchmark=matmul --entry=matmul \
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
  --benchmark=matmul --entry=matmul \
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
- `--benchmarks=<id1,id2>` — фильтр по `spec.id` (по умолчанию все).
- `--restart-every=N` — quit+relaunch browser session каждые N cases per env (default 0 = never; hedge на возможный V8 state drift в long runs).

Для browser envs `run-matrix.ts` держит одну long-lived WebDriver session per env и навигирует по case URL'ам через `driver.get()` — намного устойчивее на full matrix (810 cases) чем driver-per-case spawn. Per-case error или session-crash триггерит retry-once-with-relaunch; cases что упали оба раза — собираются в `<out>/failures.txt`.

Каждый кейс пишет `<entry>__<lang>-<toolchain>-<profile>__<size>__<env>.json`, где `<entry>` — benchmark ID (для single-entry binary типа matmul совпадает с `<benchmark>`; multi-entry binaries будут давать N файлов с разными `<entry>` на один (lang, toolchain, profile)).

### Полный пайплайн end-to-end

```bash
pnpm bench:all
# == pnpm build:all && pnpm bench --mode=eval && pnpm report
```

Долго (десятки минут в `eval`). Используется для финальных замеров.

### Debug timings (отладка измерений)

Если измерения дают неожиданные значения (high CV, аномальные firstCall, и т.п.) — включаются подробные per-sample логи и проба разрешения `performance.now()`:

```bash
# Node-side
BENCH_DEBUG_TIMINGS=1 pnpm exec tsx apps/runner-node/src/main.ts ...

# Browser-side (через runner-web driver)
BENCH_DEBUG_TIMINGS=1 pnpm --filter @bench-app/runner-web drive ...
```

Что появляется в выводе:

- `[bench-debug] performance.now() resolution: <ms>` — измеренное разрешение high-resolution clock (Node ~ 1µs, Chromium ~ 5µs с COOP+COEP, Firefox ~ 20µs).
- `[bench-debug] sample N: <duration>` — длительность каждого warm sample'а.

Browser-side флаг прокидывается из Node в page → worker scope через query param `?debug=1`.

Полезно для investigations типа «почему в Firefox все samples 0 ms» (фон — § Известные ограничения, таймеры `performance.now()`).

---

## Отчёт

```bash
pnpm report --in=results/raw/<run-name>
# или без --in: возьмёт самый свежий каталог под results/raw/
```

Создаёт `results/summarized/<ISO timestamp>/index.html` — одну статическую страницу с двумя вкладками:

- **Size** — композиция артефакта по facility-категориям (allocator / hash-map / string / panic-fmt / observed / …) композиционными bars на общей байтовой шкале: floor-band (paid-once, приглушённый) + observed-band (изучаемый код, акцент), сегменты разделены тонкой линией, имя+байты — в hover-тултипе. Фильтры: сжатие raw/gzip/brotli, профиль, тулчейны, тумблер «только наблюдаемое». Под барами — кросс-языковая таблица по категориям (численный per-facility разбор). Доли считаются по raw, абсолют помечен ≈ (pre-opt композиция × калибровка к точному production-тоталу — байт-точная символьная атрибуция post-opt невозможна; подробнее — Plan 3/README).
- **Perf** — таблица таймингов по каждому benchmark'у + 2×2 grid для shape_dispatch. Строки шумных кейсов подсвечены жёлтым, упавшие correctness — красным.

Size читает `composition` из `dist/*/meta.json` (rust/raw покрыты; cpp/wasi-sdk, bindgen, emscripten, js деградируют до одного бара с пометкой — атрибуция расширяется в Plan 3). Каждый JSON-результат прогоняется через `BenchResultSchema.parse` перед агрегацией — невалидный файл будет ошибкой.

---

## Воспроизводимость

Цель — чтобы при тех же версиях тулчейнов на той же машине вы получили **bit-for-bit те же checksum'ы** и тайминги в пределах cv. Гарантии:

- Все версии тулов пиннутся в `tool-versions.json` и `rust-toolchain.toml`.
- `pnpm` использует `packageManager` для self-pin'а.
- Внешние пакеты pin'ятся в `pnpm-lock.yaml` (коммитится).
- `wasm-opt` явно вызывается с `--enable-bulk-memory --enable-nontrapping-float-to-int` для размер-профилей Rust/C++ — иначе свежий `rustc` / `emcc` пишут операции, которые wasm-opt без этих флагов отвергает.
- В `meta.json` каждой combo-папки лежит обнаруженная версия тула. Расхождение с `tool-versions.json` не блокирует прогон, но означает, что результат не воспроизведёт референс. Замечание: при auto-install (тулы только в `.tools/`, не на PATH родителя) `meta.json` сейчас фиксирует версии лишь rustc/node — `wasm-opt`/`wasm-pack`/`emcc` остаются пустыми. Воспроизводимость гарантируется sha256-пинами в `tool-versions.json`.

Reference checksums per (entry, size) зашиты в `benches/<workload>/spec.json` под `expectedChecksums[entry][size]`. Runner валидирует **warm-loop сэмплы** — `run(innerIterations)` против `expectedChecksum`; несовпадение останавливает кейс с `correctnessFailed: true`. (Первый вызов `run(1)` сам по себе не валидируется, потому что для iter-dependent workloads его checksum — функция innerIterations.)

---

## Структура репозитория

```
.
├── benches/<workload>/             # каждый workload — отдельный каталог
│   │                               # toolchain coverage varies per workload — см. spec.json.supported
│   ├── spec.json                   # v2: entries + expectedChecksums[entry][size] + fixture sha256
│   ├── fixtures/                   # генерируемые .bin (gitignored); fixture-less workloads пишут 0-байт sentinels
│   ├── js/{idiomatic,typed-array}/ # JS-имплементации (TS source) — typed-array variant только matmul
│   ├── rust/{raw,bindgen}/         # Rust-крейты (matmul ещё имеет rust/shared core)
│   ├── cpp/                        # общий .cpp + per-bench build-emscripten.sh + build-wasi-sdk.sh
│   └── validate/                   # справочный TS, генерит ожидаемые checksum'ы per (entry, size)
│
├── benches/common/                 # shared fixture utilities (PRNG + per-workload generators)
│
├── packages/                       # библиотечные пакеты воркспейса
│   ├── result-schema/              # zod-схема BenchResult + типы
│   ├── harness/                    # measure loop, stats, validation
│   ├── loaders/                    # четыре loader'а (plain-js, raw-wasm, rust-bindgen, emscripten)
│   └── reporter/                   # aggregate + renderHtml
│
├── apps/                           # CLI-драйверы
│   ├── runner-node/                # один кейс в Node
│   └── runner-web/                 # Vite + Worker + selenium-webdriver
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
│   ├── plans/  …phase-1-0.md       # план реализации Phase 1.0
│   └── bug-reports/                # root-cause notes для specific bugs с repro
│
├── tool-versions.json              # пины внешних тулов
├── rust-toolchain.toml             # rust 1.95.0 + wasm32-unknown-unknown
├── pnpm-workspace.yaml             # packages/*, apps/*, benches/*/js/*
└── tsconfig.base.json              # strict + verbatimModuleSyntax + …
```

---

## Документация дизайна

- **`docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`** — дизайн-спека, объясняет, что и зачем измеряется, обоснование выбранного workload'а, контракты `BenchModule` / `Loader`, формат `BenchResult`. Читать первой.
- **`docs/superpowers/plans/2026-05-01-wasm-benchmarks-phase-1-0.md`** — пошаговый план Phase 1.0 (29 задач). Полезно как индекс по коду.

---

## Guidelines

[`docs/guidelines.md`](./docs/guidelines.md) — actionable рекомендации для продуктовых команд, извлекаемые из накопленных измерений: build-флаги (e.g. `-Oz` для C++ size-sensitive cases), toolchain trade-off'ы, code-паттерны под wasm. Каждая рекомендация привязана к evidence-пути в `results/` или `dist/` и phase'у, в котором появилась. Файл наполняется по мере появления confirmed-выводов из phases (на текущий момент — claims из Phase 1.1.x).

---

## Известные ограничения

Рабочий backlog не-критичных tech-debt items — `docs/tech_debt/` (триаж через skill `/backlog-review`).

- **`navigator.platform` в Firefox.** Firefox 110+ выдаёт пустой `navigator.platform`; runner стампит `machine.os` со стороны Node host'а, чтобы не получать пустоту в результате.
- **Таймеры `performance.now()` в браузере.** Без cross-origin isolation Chromium квантует до 100 µs, Firefox — до 1 ms (Spectre mitigation). Phase 1.0.5 Wave 4 включил COI (COOP+COEP headers в Vite dev/preview servers), что подняло precision до ~5 µs (Chromium) и ~20 µs (Firefox). На S-размере без COI samples были 0/1 ms binary — теперь видны реальные fractional values.
- **Mac CPU без подавления throttling.** Никаких `cpuset`/`taskset`/turbo-boost lock'ов не делается; на лэптопе на батарее cv может вылетать выше 5%.
- **wasm-pack 0.13.1 + Rust 1.95.0**: внутренний wasm-opt из wasm-pack отключён через Cargo metadata, потому что валится на современный output. Внешний `wasm-opt` запускается build-скриптом отдельно.
- **Тег `phase-1-0` совпадает с именем удалённой ветки.** Технически это легально (refs/tags vs refs/heads), но git кидает `warning: refname 'phase-1-0' is ambiguous` при `git rev-parse phase-1-0`. Используйте `refs/tags/phase-1-0` если нужно однозначно.
