# Session state — 2026-05-02

Снапшот для следующей сессии. Phase 1.0 завершён и смерджен в `master`, тег `phase-1-0` создан. Этот файл — handoff для Phase 1.1 (brainstorm/research).

В этом файле — только то, чего нет в коде, README или спеке. Высокоуровневое состояние и общие feedback'и уже в auto-memory; этот файл их не дублирует.

---

## TL;DR

- Phase 1.0 done на `master`, tag `phase-1-0` (= `25eed91`). Ветка `phase-1-0` удалена локально, на `origin` её никогда не было.
- 49 коммитов на `master` опережают `origin/master`. Push не сделан — на усмотрение следующей сессии.
- README обновлён и закоммичен (`49fa17e Updated readme.md`) — уже на master, поверх tagged-коммита.
- Auto-memory `project_wasm_benchmarks.md` актуальная — её достаточно как entry-point.
- Следующий шаг: brainstorm для Phase 1.1 (`interop_calls`, `hashmap_workload`, `shape_dispatch`).

---

## Состояние репозитория

| Что | Куда указывает |
|---|---|
| `master` HEAD | `49fa17e Updated readme.md` |
| tag `phase-1-0` | `25eed91 feat(scripts): add smoke target ...` (на коммит ниже HEAD; tagged-коммит = «end of plan», README прилетел отдельной правкой пользователя) |
| `origin/master` | ~49 коммитов отстаёт |
| Untracked | `Какие есть существующие бенчмарки wasm под браузер.md` (input от пользователя, **не коммитить**) |
| Untracked | `docs/superpowers/session-state-2026-05-02.md` (этот файл — пользователь сам решит, коммитить ли) |

`origin`: `git@github.com:uncerso/wasm-rust-cpp-js.git`. Никаких feature-веток на origin нет.

---

## Чтение перед стартом Phase 1.1 (порядок)

1. **`README.md`** — публичная инструкция: как воспроизвести, что измеряется, какие тулы нужны.
2. **Auto-memory** — загружается автоматически. Ключевая запись: `project_wasm_benchmarks.md` (Phase 1.0 done, ссылки на спеку/план).
3. **`docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`** — дизайн-спека, неизменяемая основа. §Phase 1.1 на ~191–199 строках:
   - `interop_calls` — JS↔Wasm boundary cost на 100k–1M вызовах. Сравнить wasm-bindgen vs raw exports.
   - `hashmap_workload` — `std::unordered_map` / `HashMap` / `Map`. Главный сигнал — размер артефакта (libc++ vs rust-std vs JS).
   - `shape_dispatch` — обход коллекции shape'ов с подсчётом площади (circle/square/triangle). Static dispatch (templates/generics) vs dynamic (`virtual` / `dyn Trait`); JS как dynamic baseline.
4. **Этот файл** (handoff).
5. *(по желанию, для истории)* `docs/superpowers/session-state-2026-05-01.md` — снапшот мида Phase 1.0 (16/29). И `docs/superpowers/plans/2026-05-01-wasm-benchmarks-phase-1-0.md` — пошаговый план Phase 1.0.

---

## Phase 1.0 знания, которые нельзя терять

Это конкретные «мины», которые пришлось решать по ходу Phase 1.0. В коде они отражены, но новый workload может легко повторить ошибку, если не знать о них заранее.

### wasm-opt feature flags

Современный rustc (1.95+) и emcc (5.0+) emit'ят `memory.fill` и `i32.trunc_sat_f64_u`. wasm-opt без флагов отказывается их обрабатывать.

- `scripts/build-rust.ts` — оба `wasm-opt -Oz` вызова с `--enable-bulk-memory --enable-nontrapping-float-to-int`.
- `benches/matmul/cpp/build-emscripten.sh` — то же самое.
- `benches/matmul/cpp/build-wasi-sdk.sh` — flags **не нужны**, freestanding C++ их не emit'ит; добавление сделает артефакт больше.

Если новый workload использует bulk memory ops (например `std::memset`/`memcpy` на больших массивах), флаги нужны.

### Schema gotchas (`packages/result-schema/src/schema.ts`)

- `artifactHash` имеет regex `/^sha256:[0-9a-f]{64}$/`. В `meta.json` хэш хранится **без префикса**; runner оборачивает через `asSha256Prefixed()` в `apps/runner-node/src/run-case.ts:65` и в `apps/runner-web/src/worker.ts:61`.
- `stats.nSamples` — `int().positive()` (т.е. ≥1). Runner клампит: `Math.max(stats.n, 1)`. Без клампа кейсы с `correctnessFailed=true` (нет warm samples) роняют `BenchResultSchema.parse`.
- `MachineSchema.memoryGb: positive()` — clamp `Math.max(1, ...)`.

### Emscripten output convention

Build-скрипт пишет **`glue.mjs` + `glue.wasm`** side-by-side (не `module.wasm`). emcc хардкодит имя `glue.wasm` через `import.meta.url` в самом glue.

- Loader (`packages/loaders/src/emscripten.ts`) использует **только** `glueUrl`. `artifactUrl` обязателен по типу `LoaderInput`, но не читается. В runner'ах кладут `glue.wasm` для консистентности.

### rust-bindgen в Node — pre-read bytes

wasm-bindgen `--target=web` glue делает `fetch(url)` внутри `init()`. undici fetch в Node не понимает `file://`.

- `packages/loaders/src/rust-bindgen.ts:33-40` — pre-читает байты через `fetchBytes` и кладёт `module_or_path: Uint8Array`. wasm-bindgen runtime принимает `BufferSource | URL string | WebAssembly.Module`.
- В браузере path работает через нативный fetch — pre-read избыточен, но не вреден.
- Хелпер `fetchBytes` живёт в `packages/loaders/src/fetch-bytes.ts` и используется и raw-wasm, и rust-bindgen.

### wasm-pack internal wasm-opt отключён

В `benches/matmul/rust/bindgen/Cargo.toml`:
```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = false
[package.metadata.wasm-pack.profile.release-size]
wasm-opt = false
```

Внутренний wasm-opt в wasm-pack 0.13.1 валится на rustc 1.95 output. Внешний `wasm-opt` запускается из `scripts/build-rust.ts` после копирования артефакта. Для нового bindgen-крейта в Phase 1.1 обязательно повторить эти строки.

### Vite 6 в ESM

`apps/runner-web/vite.config.ts`:
- Использует `fileURLToPath(new URL(".", import.meta.url))` вместо `__dirname` (`__dirname` не существует в ESM).
- Alias `node:fs/promises` → `apps/runner-web/src/node-fs-stub.ts`. Без alias'а Vite внедряет throwing-proxy, и worker валится на module-eval, потому что `@bench/loaders/fetch-bytes.ts` импортирует `readFile` (в браузере не вызывается, но импорт срабатывает). Стаб возвращает `Promise.reject(...)` — формальный shape `node:fs/promises`.

### `tsconfig.base.json` строгий

Активные флаги: `strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax`. Привычки:

- `import type { ... }` для type-only импортов (verbatim требует).
- Bracket access для динамических ключей: `process.env["MACHINE_CPU"]` (не `process.env.MACHINE_CPU`).
- Optional спредить условно, не передавать `undefined`. Образец — `scripts/lib/exec.ts`.
- В `bench-impl/*` пакетах локально отключён `noUncheckedIndexedAccess` (нечитабельно для алгоритмики на массивах). См. `benches/matmul/js/typed-array/tsconfig.json`.

### Tag/branch namespace conflict

`phase-1-0` — и тег, и **удалённая** ветка с одинаковым именем. `git rev-parse phase-1-0` ругается `ambiguous`. Однозначная форма: `git rev-parse refs/tags/phase-1-0`.

При создании Phase 1.1 branch имя должно отличаться от будущего тега. Рекомендую `feature/phase-1-1` для ветки, `phase-1-1` для тега в финале — slash в имени ветки исключает коллизию.

### Subagent flow, что реально работало

Из 13 «оставшихся» задач Phase 1.0 только Task 23 (vite + worker + playwright) пошла через subagent — implementer (sonnet) → spec reviewer (haiku) → code-quality reviewer (sonnet) → fix-loop. Остальные 12 — inline.

Что критически помогло субагенту вернуться с DONE с первого раза: **NOTE-list of fixes** в промпте — конкретные строки/проблемы плана, которые субагент должен поправить. Без этого списка субагент копирует ошибки плана буквально (например, `as any` на CLI-парсинге, `require()` в ESM, неверный импорт Playwright).

Для Phase 1.1: если задача переросла ~400 строк плана и/или включает browser/worker-стек — subagent оправдан. Иначе inline быстрее.

---

## Tooling state

Полный pin — в `tool-versions.json`. Что важно помнить из ритуала:

- **emcc** — `source ~/emsdk/emsdk_env.sh` нужно **в каждом новом терминале**. Без этого `pnpm build:cpp` падает на `emcc: command not found`.
- **`$WASI_SDK_PATH`** = `/Users/uncerso/wasi-sdk-25`. Положить в `~/.zshrc` если не сделано.
- **Playwright browsers** — chromium + firefox скачаны (~300 MB, в `~/Library/Caches/ms-playwright/`) в Phase 1.0. Повторно ставить не нужно.
- **`--no-gpg-sign`** — обязательный флаг на каждом коммите. См. auto-memory `feedback_gpg_no_sign.md`.

---

## Phase 1.1 setup checklist

Стартовый ритуал в новой сессии:

1. `git status && git log --oneline | head -5` — `master` чистый, tag `phase-1-0` на `25eed91`.
2. `pnpm install` — workspace-симлинки актуальные.
3. `source ~/emsdk/emsdk_env.sh` — emcc в PATH.
4. `pnpm smoke` — sanity на Phase 1.0 пайплайне (~30 с). Должно вернуть `smoke OK`. Если падает — проблема в локальной среде, а не в коде.
5. Прочитать **§Phase 1.1** в спеке (`docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md`).
6. Запустить **`superpowers:brainstorming`** для уточнения интерфейса/контракта нового workload'а. Не лезть сразу в код.
7. После brainstorm — **`superpowers:writing-plans`**.
8. Только потом — execution: `superpowers:executing-plans` или `superpowers:subagent-driven-development` (выбор по сложности задач).
9. Branch — `feature/phase-1-1` (имя осознанно отличается от тега `phase-1-0`).

---

## Open items, не-блокирующие

- **Push на origin** не сделан. `git push origin master --tags` даст 49 коммитов + tag `phase-1-0` на удалённый репо. Решение — за пользователем.
- **Известные ограничения Phase 1.0** задокументированы в `README.md` §Известные ограничения: Firefox `performance.now` quantization, отсутствие CPU throttling lock, тег/ветка namespace conflict. Заняться ими — отдельный план.

---

## Полезные команды

```bash
pnpm smoke                                                                 # ~30 c sanity
pnpm bench --envs=node --sizes=S --mode=quick --out=results/raw/check     # node-only sanity
pnpm bench --envs=node,chromium,firefox --sizes=S,M --mode=eval \
  --out=results/raw/full                                                  # полный прогон
pnpm bench:all                                                            # build + bench eval + report
pnpm report --in=results/raw/<dir>                                        # пересобрать HTML
git rev-parse refs/tags/phase-1-0                                         # однозначно резолвить tag
```
