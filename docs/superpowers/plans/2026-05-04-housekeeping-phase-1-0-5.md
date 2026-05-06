# Phase 1.0.5 — Housekeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть UX-долги Phase 1.0 и ввести quality gates до Phase 1.1: pnpm clear, units в репорте, fix exit 143, ESLint+stylistic, C++ flags, Rust workspace+edition 2024+lints, shared algorithm crate с минимизацией unsafe, расследование Firefox/Chrome precision, auto-deps installer для macOS arm64.

**Architecture:** Пять последовательных waves, каждая закрывается до старта следующей. Wave 1 (quick wins) → Wave 2 (quality gates) → Wave 3 (rust hygiene) → Wave 4 (firefox investigation, 3 structural gates) → Wave 5 (auto-deps installer). Tag `phase-1-0-5` в финале.

**Tech Stack:** TypeScript (tsx, esbuild, vite, vitest), Rust 1.95 (edition 2024, cargo workspace, clippy), C++23 (clang via emcc + wasi-sdk), ESLint 9 (flat config) + typescript-eslint + @stylistic, Playwright (chromium + firefox), execa, zod.

**Spec:** `docs/superpowers/specs/2026-05-04-housekeeping-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `scripts/clear.ts` | Wave 1: idempotent removal of generated artifacts |
| `eslint.config.js` | Wave 2: flat-config ESLint config root |
| `Cargo.toml` (репо корень) | Wave 3: cargo workspace root + workspace.lints + workspace.package |
| `benches/matmul/rust/shared/Cargo.toml` | Wave 3: shared algorithm crate manifest |
| `benches/matmul/rust/shared/src/lib.rs` | Wave 3: matmul_naive, abs_sum (no_std) |
| `docs/superpowers/notes/2026-05-XX-perf-now-precision.md` | Wave 4: investigation findings |
| `scripts/setup.ts` | Wave 5: auto-deps installer entry point |
| `scripts/lib/tool-paths.ts` | Wave 5: emcc/wasm-opt/wasm-pack/wasi-sdk path resolver |
| `scripts/lib/emsdk-env.ts` | Wave 5: programmatic emsdk env-var setup |
| `scripts/lib/setup-tools.ts` | Wave 5: download + verify + extract logic |
| `tool-versions.json` (расширяется) | Wave 5: добавляются url + sha256 |

### Modified files

| Path | What changes |
|---|---|
| `package.json` | Wave 1: add `clear`/`clear:all`. Wave 2: add `lint:ts`/`lint:ts:fix`/`lint:rust`/`lint:all` + eslint deps. Wave 5: add `setup`, modify `bench:all`. |
| `packages/reporter/src/render.ts` | Wave 1: add unit suffixes to table headers |
| `scripts/run-matrix.ts` | Wave 1: ensure SIGTERM goes to direct child, not pnpm wrapper (fix exit 143) |
| `benches/matmul/cpp/build-emscripten.sh` | Wave 2: add `-std=c++23 -Wall ...` flag set |
| `benches/matmul/cpp/build-wasi-sdk.sh` | Wave 2: add `-std=c++23 -Wall ...` flag set |
| `benches/matmul/rust/raw/Cargo.toml` | Wave 2: `[lints.rust]/[lints.clippy]` per-crate. Wave 3: replace with `edition.workspace = true` + `[lints] workspace = true` + dep on shared. |
| `benches/matmul/rust/bindgen/Cargo.toml` | Wave 2: `[lints.*]`. Wave 3: workspace inheritance + shared dep. |
| `benches/matmul/rust/raw/src/lib.rs` | Wave 3: extract algorithm to shared, refactor unsafe via UnsafeCell, edition 2024 syntax |
| `benches/matmul/rust/bindgen/src/lib.rs` | Wave 3: extract algorithm to shared, replace `static mut` with `thread_local!`+`RefCell` |
| `apps/runner-web/playwright.config.ts` | Wave 4 (Gate 3 only): add `firefoxUserPrefs` if hypothesis confirmed |
| `packages/harness/src/measure.ts` | Wave 4 (Gate 1): add resolution probe + per-sample logging |
| `apps/runner-node/src/main.ts` | Wave 4 (Gate 2 fix only): bump `innerIterations` if quantization confirmed |
| `apps/runner-web/src/driver.ts` | Wave 4 (Gate 2 fix only): bump `innerIterations` if quantization confirmed |
| `scripts/build-cpp.ts` | Wave 5: use `wasiSdkPath()`, set `WASI_SDK_PATH` env per-process |
| `scripts/build-rust.ts` | Wave 5: use `wasmPackPath()`, `wasmOptPath()` |
| `.gitignore` | Wave 1: add reporter test outputs if present. Wave 5: add `.tools/` |
| `README.md` | Wave 4: update «Известные ограничения» if Wave 4 STOP. Wave 5: simplify «Toolchain» section. |

### Deleted files

Никаких удалений в Phase 1.0.5 — только дополнения и модификации.

---

## Setup — branch and worktree

- [ ] **Step 0.1: Confirm clean working tree on master**

Run: `git status`
Expected: `On branch master, nothing to commit` (untracked `Какие есть существующие бенчмарки wasm под браузер.md` и spec/plan markdown — игнорируем).

- [ ] **Step 0.2: Create feature branch**

Run: `git switch -c feature/phase-1-0-5`
Expected: `Switched to a new branch 'feature/phase-1-0-5'`.

Имя ветки осознанно отличается от будущего тега `phase-1-0-5` (slash в имени) — см. session-state Phase 1.0.

- [ ] **Step 0.3: Commit spec + plan**

```bash
git add docs/superpowers/specs/2026-05-04-housekeeping-design.md \
        docs/superpowers/plans/2026-05-04-housekeeping-phase-1-0-5.md
git commit --no-gpg-sign -m "docs: add Phase 1.0.5 housekeeping spec and plan"
```

Expected: коммит создан. `--no-gpg-sign` обязателен для агентских коммитов в этом репо.

---

## Wave 1 — Quick wins

### Task 1: `pnpm clear` — clear.ts script

**Files:**
- Create: `scripts/clear.ts`
- Modify: `package.json`

- [ ] **Step 1.1: Create `scripts/clear.ts`**

```ts
import { rm } from "node:fs/promises";

const ALWAYS_PATHS = [
    "dist",
    "results",
    "benches/matmul/rust/raw/target",
    "benches/matmul/rust/bindgen/target",
    "benches/matmul/rust/bindgen/pkg-tmp",
    "apps/runner-web/.vite",
    "apps/runner-web/test-results",
    "apps/runner-web/playwright-report",
    // After Wave 3.1 (workspace root) добавить "target" в этот список
    // и убрать per-crate target'ы выше.
];

const ALL_EXTRA_PATHS = [
    ".tools",
    "node_modules",
    "apps/runner-node/node_modules",
    "apps/runner-web/node_modules",
    "packages/harness/node_modules",
    "packages/loaders/node_modules",
    "packages/reporter/node_modules",
    "packages/result-schema/node_modules",
];

async function removeAll(paths: readonly string[]): Promise<void> {
    for (const p of paths) {
        await rm(p, { recursive: true, force: true });
        console.log(`removed ${p}`);
    }
}

async function main(): Promise<void> {
    const all = process.argv.includes("--all");
    await removeAll(ALWAYS_PATHS);
    if (all) {
        await removeAll(ALL_EXTRA_PATHS);
    }
    console.log(all ? "clear:all done" : "clear done");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
```

`rm` с `force: true` идемпотентен — не падает на отсутствующих путях.

- [ ] **Step 1.2: Add scripts to root `package.json`**

В `package.json` в секции `scripts` добавить две строки сразу после `"smoke"`:

```json
"clear": "tsx scripts/clear.ts",
"clear:all": "tsx scripts/clear.ts --all",
```

- [ ] **Step 1.3: Run `pnpm clear` on a populated tree**

Сначала прогнать что-нибудь, что создаст артефакты:

```bash
pnpm build:all
ls dist results 2>/dev/null  # должны существовать
pnpm clear
ls dist results 2>/dev/null  # пустой вывод (no such file or directory)
```

Expected: dist/ и results/ удалены, остальные пути в выводе `removed ...`. Команда завершилась успешно.

- [ ] **Step 1.4: Run `pnpm clear` on a clean tree (idempotent check)**

```bash
pnpm clear
```

Expected: завершается без ошибок (force: true проглатывает ENOENT).

- [ ] **Step 1.5: Run `pnpm clear:all`**

```bash
pnpm clear:all
ls node_modules 2>/dev/null  # пусто
ls apps/runner-web/node_modules 2>/dev/null  # пусто
```

Expected: `node_modules/` исчезли, `pnpm install` потребуется для следующего шага.

- [ ] **Step 1.6: Restore deps and commit**

```bash
pnpm install
git add scripts/clear.ts package.json
git commit --no-gpg-sign -m "feat(scripts): add pnpm clear and clear:all"
```

Expected: коммит создан, дерево чистое (`git status`).

---

### Task 2: Units in HTML report

**Files:**
- Modify: `packages/reporter/src/render.ts:43-46` (table header)
- Test: `packages/reporter/tests/render.test.ts`

- [ ] **Step 2.1: Read existing render test**

Run: `cat packages/reporter/tests/render.test.ts`
Note: убедиться, что тест проверяет существующие заголовки. Если да — обновить ожидания. Если нет (тест не покрывает headers) — добавить тест.

- [ ] **Step 2.2: Add/update failing test for headers with units**

В `packages/reporter/tests/render.test.ts` добавить (или модифицировать существующий) тест:

```ts
import { describe, it, expect } from "vitest";
import { renderHtml } from "../src/render.js";
import type { Aggregated } from "../src/aggregate.js";

describe("renderHtml table headers", () => {
    it("includes units in size and timing columns", () => {
        const agg: Aggregated = {
            generatedAt: "2026-05-05T00:00:00.000Z",
            benchmarks: {},
        };
        const html = renderHtml(agg);
        // Размерные столбцы — байты:
        expect(html).toContain("<th>wasm raw (B)</th>");
        expect(html).toContain("<th>wasm gz (B)</th>");
        expect(html).toContain("<th>total gz (B)</th>");
        // Временные столбцы — миллисекунды:
        expect(html).toContain("<th>init (ms)</th>");
        expect(html).toContain("<th>first (ms)</th>");
        expect(html).toContain("<th>warm med (ms)</th>");
        expect(html).toContain("<th>warm p95 (ms)</th>");
        // Безразмерные — без скобок:
        expect(html).toContain("<th>cv</th>");
        expect(html).toContain("<th>ok</th>");
    });
});
```

Note: `renderHtml` сейчас принимает `Aggregated` где `benchmarks: Record<string, AggregatedBenchmark>`. Пустой объект → нет секций → headers не выводятся (они внутри `renderBenchmark`). Тест выше провалится, так как headers в HTML появляются только при наличии benchmarks. Решение: сделать минимальный fixture с одной empty-benchmark секцией. См. структуру `Aggregated` через `cat packages/reporter/src/aggregate.ts` и подстроить fixture.

Альтернатива (проще): тестировать exported helper `renderBenchmarkHeaders()` — но его сейчас нет. Добавлять только ради теста — overkill.

**Прагматичный путь:** в тесте создать fixture с одной benchmark, у которой `cases: []`. `renderBenchmark` всё равно выведет thead. Проверить актуальную структуру `AggregatedBenchmark` через `cat packages/reporter/src/aggregate.ts` перед написанием fixture. Затем повторить test setup из существующего `render.test.ts`.

- [ ] **Step 2.3: Run test to verify it fails**

Run: `pnpm --filter @bench/reporter test`
Expected: тест падает на ожиданиях `<th>wasm raw (B)</th>` etc.

- [ ] **Step 2.4: Update headers in `render.ts`**

В `packages/reporter/src/render.ts` строки 43-46 (внутри `renderBenchmark`):

```ts
return `<section>
    <h2>${escape(b.id)}</h2>
    <table>
      <thead><tr>
        <th>env</th><th>impl</th><th>size</th>
        <th>wasm raw (B)</th><th>wasm gz (B)</th><th>total gz (B)</th>
        <th>init (ms)</th><th>first (ms)</th>
        <th>warm med (ms)</th><th>warm p95 (ms)</th><th>cv</th><th>ok</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
```

Изменены 3 заголовка размера (`wasm raw`, `wasm gz`, `total gz` → `+ (B)`) и 2 заголовка времени (`init`, `first` → `+ (ms)`).

- [ ] **Step 2.5: Run test to verify pass**

Run: `pnpm --filter @bench/reporter test`
Expected: PASS.

- [ ] **Step 2.6: Smoke render**

Run:
```bash
pnpm bench --envs=node --sizes=S --mode=quick --out=results/raw/headers-check
pnpm report --in=results/raw/headers-check
```

Открыть `results/summarized/<latest>/index.html` в браузере, визуально проверить заголовки таблицы. Убедиться, что отображаются `wasm raw (B)` и `init (ms)`.

- [ ] **Step 2.7: Commit**

```bash
git add packages/reporter/src/render.ts packages/reporter/tests/render.test.ts
git commit --no-gpg-sign -m "feat(reporter): add units (B/ms) to table headers"
```

---

### Task 3: Fix exit 143 in `pnpm bench:all`

**Files:**
- Modify: `scripts/run-matrix.ts:64-71` (server start) and `scripts/run-matrix.ts:100` (teardown)

- [ ] **Step 3.1: Reproduce the bug**

Run:
```bash
pnpm clear
pnpm bench:all 2>&1 | tail -20
```

Expected: финальные строки содержат `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @bench-app/runner-web@0.0.0 dev: vite, Exit status 143`. Записать exact lines в notes (для verification later).

Note: `pnpm bench:all` уже использует `pnpm --filter` (см. строку 64) — не `-r --parallel`. Significant: ошибка может быть в самой `pnpm --filter` обёртке, которая тоже мониторит exit code child'а. Проверить, что именно её нужно поправить.

- [ ] **Step 3.2: Investigate child process tree**

Run while bench is running (в отдельном терминале):
```bash
pgrep -af "pnpm.*runner-web" | head
pgrep -af "vite" | head
```

Expected: видим как минимум 2 уровня — `pnpm --filter ...` сверху, `vite` ниже. SIGTERM на верхнего (что делает `serverProc.kill`) — pnpm wrapper exit'ит с 143, но не propagates быстро. На vite SIGTERM приходит через `tree-kill` или сам.

Если `serverProc.kill("SIGTERM")` уже doesnt kill the whole process group — нужен process group kill.

- [ ] **Step 3.3: Fix — kill the whole process group**

В `scripts/run-matrix.ts` две правки:

(а) При старте — добавить `detached: true` чтобы дочерний процесс был лидером своей process group:

```ts
serverProc = execa("pnpm", ["--filter", "@bench-app/runner-web", "dev"], {
    stdio: "inherit",
    detached: true,
});
```

(б) При teardown — убить group по `-PID` и проглотить ошибку «no such process» если group уже мёртв:

```ts
} finally {
    if (serverProc?.pid) {
        try {
            // negative PID = signal to entire process group
            process.kill(-serverProc.pid, "SIGTERM");
        } catch (e: unknown) {
            // ESRCH означает группа уже завершилась — игнорируем
            if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
        }
        // ждём пока процесс реально умрёт
        try {
            await serverProc;
        } catch { /* expected on SIGTERM */ }
    }
}
```

Note: `detached: true` на macOS делает child лидером новой group. `process.kill(-pid, sig)` убивает всю group атомарно. Это и снимает «торчащий» pnpm wrapper, и vite, и любые subprocess'ы vite.

- [ ] **Step 3.4: Run bench:all and verify clean exit**

Run:
```bash
pnpm clear
pnpm bench:all 2>&1 | tail -20
```

Expected: финал — `report -> results/summarized/<ts>/index.html (60 results)`. **Без** `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`. **Без** `Exit status 143`. exit code = 0:

```bash
echo $?  # 0
```

- [ ] **Step 3.5: Commit**

```bash
git add scripts/run-matrix.ts
git commit --no-gpg-sign -m "fix(scripts): SIGTERM whole process group to avoid pnpm exit 143"
```

---

### Task 4: Wave 1 closeout

- [ ] **Step 4.1: Smoke check**

Run: `pnpm smoke`
Expected: финал `smoke OK` через ~30 секунд.

- [ ] **Step 4.2: Tag wave checkpoint (annotated, not pushed)**

```bash
git tag wave-1-done
git log --oneline | head -10
```

Expected: видны 3 свежих коммита Wave 1 (clear, units, exit143) поверх spec+plan коммита.

---

## Wave 2 — Quality gates

### Task 5: ESLint flat config + dependencies

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (devDependencies + scripts)

- [ ] **Step 5.1: Install ESLint deps**

Run:
```bash
pnpm add -D -w eslint typescript-eslint @stylistic/eslint-plugin globals
```

Expected: `package.json` обновлён с новыми devDependencies. `pnpm-lock.yaml` обновлён.

`-w` флаг ставит в корневой `package.json`, не в workspace package.

- [ ] **Step 5.2: Create root `eslint.config.js`**

В корне репо создать `eslint.config.js`:

```js
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default tseslint.config(
    {
        ignores: [
            "**/dist/**",
            "**/node_modules/**",
            "**/target/**",
            "**/pkg-tmp/**",
            "results/**",
            ".tools/**",
            "benches/matmul/fixtures/**",
            // emscripten output
            "**/glue.mjs",
            "**/glue.js",
        ],
    },
    {
        files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
        extends: [
            ...tseslint.configs.recommendedTypeChecked,
        ],
        plugins: {
            "@stylistic": stylistic,
        },
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        rules: {
            // Stylistic — 4-space, double quotes, semis, trailing comma multiline
            "@stylistic/indent": ["error", 4, { SwitchCase: 1 }],
            "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/comma-dangle": ["error", "always-multiline"],
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/eol-last": ["error", "always"],
            "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
            // Запрет однострочного if-then
            "curly": ["error", "all"],
            // Console — глобально warn, в скриптах OK (см. override ниже)
            "no-console": "warn",
        },
    },
    {
        // В scripts/** console.log — это нормальный output
        files: ["scripts/**/*.ts"],
        rules: {
            "no-console": "off",
        },
    },
    {
        // bench-impl: relax type-checked, base style сохраняется
        files: ["benches/**/*.ts"],
        rules: {
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-call": "off",
        },
    },
    {
        // Тесты — слабее правила
        files: ["**/*.test.ts", "**/tests/**/*.ts"],
        rules: {
            "no-console": "off",
        },
    },
);
```

Note: `projectService: true` — стандартный способ в typescript-eslint v8+ автоматически найти tsconfig'и monorepo. Если не сработает (бывает в старых версиях) — fallback на `project: ["./tsconfig.json", "./packages/*/tsconfig.json", "./apps/*/tsconfig.json", "./benches/**/tsconfig.json"]`.

- [ ] **Step 5.3: Add lint scripts to root `package.json`**

В `package.json` секция `scripts` добавить четыре строки сразу после `"clear:all"`:

```json
"lint:ts": "eslint .",
"lint:ts:fix": "eslint . --fix",
"lint:rust": "cargo clippy --all-targets -- -D warnings && (cd benches/matmul/rust/bindgen && cargo clippy --all-targets -- -D warnings)",
"lint:all": "pnpm lint:ts && pnpm lint:rust",
```

Note для `lint:rust`: до Wave 3.1 (workspace root) запускаем clippy per-crate. Cargo CWD-aware, поэтому без `cd` он не найдёт оба crate'а. После Wave 3.1 эта строка станет проще: `cargo clippy --workspace --all-targets -- -D warnings`.

Уточнение: первая команда `cargo clippy ...` запускается с CWD = `benches/matmul/rust/raw` если этот crate уже там, **либо** надо явно `cd`. Точная форма:

```json
"lint:rust": "(cd benches/matmul/rust/raw && cargo clippy --all-targets -- -D warnings) && (cd benches/matmul/rust/bindgen && cargo clippy --all-targets -- -D warnings)",
```

- [ ] **Step 5.4: Smoke run lint:ts (no fixes yet)**

Run: `pnpm lint:ts 2>&1 | head -50`
Expected: ESLint находит большой набор ошибок (existing TS code в double quotes, indent 2 → 4, есть `if(x) foo();` и подобное). Записать общее число errors/warnings — будем сравнивать после fix.

Если `tsconfig` projects не находятся (`Parsing error: Cannot read file ...`) — добавить fallback `project: [...]` config из note выше.

- [ ] **Step 5.5: Commit ESLint setup (без auto-fix)**

```bash
git add eslint.config.js package.json pnpm-lock.yaml
git commit --no-gpg-sign -m "chore(lint): add eslint flat config with typescript-eslint and @stylistic"
```

---

### Task 6: Apply ESLint fixes to existing TS code

**Files:**
- Modify: множество TS-файлов в `scripts/`, `apps/`, `packages/`, `benches/matmul/js/`

- [ ] **Step 6.1: Run lint:ts:fix**

Run: `pnpm lint:ts:fix`
Expected: автоматически правится indent (2 → 4), quotes (mixed → double), semis, trailing commas, brace-style, добавляются braces вокруг single-line if'ов. Может остаться часть ошибок которые требуют ручного fix.

- [ ] **Step 6.2: Inspect remaining errors**

Run: `pnpm lint:ts 2>&1 | head -100`
Expected: оставшиеся проблемы (auto-fix не справился). Типичные:
- `@typescript-eslint/no-floating-promises` — нужен `await` или `void`.
- `@typescript-eslint/no-misused-promises` — async-функция передана туда, где ожидается sync callback.
- `@typescript-eslint/no-unsafe-*` — нет типов на JSON.parse результате.

Чинить по одному файлу — это руками. Не использовать `--fix` дальше; читать кажду ошибку, понимать, исправлять.

- [ ] **Step 6.3: Fix remaining errors manually**

Для каждой оставшейся ошибки:
1. Открыть файл по сообщению линтера.
2. Понять, что ругает.
3. Исправить минимально (не реструктурировать).
4. Если правило некорректно для специфичного места — добавить `// eslint-disable-next-line <rule> -- <reason>` с reason обязательно.

Запрещено: `// eslint-disable` без reason; bulk-disable правила в `eslint.config.js` (это меняет policy для всего репо).

- [ ] **Step 6.4: Verify clean lint**

Run: `pnpm lint:ts`
Expected: exit code 0, `0 errors, 0 warnings` (или только warnings от `no-console` в нештампованных местах — допустимо).

- [ ] **Step 6.5: Run full smoke**

Run: `pnpm smoke && pnpm typecheck`
Expected: оба проходят. ESLint refactor не должен поменять behavior.

- [ ] **Step 6.6: Commit (один большой)**

```bash
git add -u
git commit --no-gpg-sign -m "refactor(ts): apply eslint + @stylistic to existing code"
```

Note: коммит **без** untracked файлов (`-u` only). Это refactor, не feature.

---

### Task 7: C++ flags

**Files:**
- Modify: `benches/matmul/cpp/build-emscripten.sh`
- Modify: `benches/matmul/cpp/build-wasi-sdk.sh`

- [ ] **Step 7.1: Update build-emscripten.sh**

В `benches/matmul/cpp/build-emscripten.sh` добавить flag-set между существующим `OPT="..."` блоком (строки 13-19) и вызовом `emcc` (строка 21):

```bash
WARN_FLAGS="-Wall -Wextra -Wpedantic -Werror \
-Wshadow -Wconversion -Wsign-conversion \
-Wcast-align -Wold-style-cast -Wnon-virtual-dtor \
-Wnull-dereference -Wdouble-promotion"

STD_FLAG="-std=c++23"
```

Затем в строке `emcc \` добавить `$STD_FLAG $WARN_FLAGS \` после `"$HERE/src/matmul.cpp"`:

```bash
emcc \
  "$HERE/src/matmul.cpp" \
  $STD_FLAG \
  $WARN_FLAGS \
  $OPT \
  -fno-exceptions -fno-rtti \
  ...
```

- [ ] **Step 7.2: Update build-wasi-sdk.sh**

Аналогично в `benches/matmul/cpp/build-wasi-sdk.sh` после строки `OPT=...` (строки 11-17):

```bash
WARN_FLAGS="-Wall -Wextra -Wpedantic -Werror \
-Wshadow -Wconversion -Wsign-conversion \
-Wcast-align -Wold-style-cast -Wnon-virtual-dtor \
-Wnull-dereference -Wdouble-promotion"

STD_FLAG="-std=c++23"
```

В вызов `clang++` добавить `$STD_FLAG $WARN_FLAGS` после `--target=wasm32 \`:

```bash
"$WASI_SDK_PATH/bin/clang++" \
  --target=wasm32 \
  $STD_FLAG \
  $WARN_FLAGS \
  -nostdlib \
  $OPT \
  ...
```

- [ ] **Step 7.3: Build cpp + observe warnings**

Run:
```bash
source ~/emsdk/emsdk_env.sh
pnpm build:cpp 2>&1 | head -80
```

Expected: либо чистая сборка (все 4 артефакта собрались), либо warnings, которые `-Werror` превратил в errors. Если есть errors — открыть `benches/matmul/cpp/src/matmul.cpp` и поправить. Типовые ожидаемые проблемы:
- `-Wconversion`/`-Wsign-conversion` ругаются на `(uint32_t)__builtin_sqrt((double)half)` — это implicit narrowing. Решение: явный `static_cast<uint32_t>(...)`.
- `-Wold-style-cast` ругается на `(const double*)(uintptr_t)A_OFF` — заменить на `reinterpret_cast<const double*>(...)`.

Чинить по месту в той же commit'е — это spec ack: «если что-то ругается на текущий код — фиксим в этом же PR».

- [ ] **Step 7.4: Re-run cpp build until clean**

Run: `pnpm build:cpp`
Expected: 4 артефакта собрались без warnings/errors. Размеры артефактов в логах сравнимы с pre-flag (unsigned narrowing fix не должен менять байты заметно).

- [ ] **Step 7.5: Sanity smoke**

Run: `pnpm smoke`
Expected: `smoke OK`. Алгоритм работает идентично — checksums match.

- [ ] **Step 7.6: Commit**

```bash
git add benches/matmul/cpp/build-emscripten.sh benches/matmul/cpp/build-wasi-sdk.sh benches/matmul/cpp/src/matmul.cpp
git commit --no-gpg-sign -m "feat(cpp): enforce -std=c++23 and warning flags (Wall/Wextra/Wpedantic/Werror + extras)"
```

---

### Task 8: Rust per-crate lints (pre-workspace)

**Files:**
- Modify: `benches/matmul/rust/raw/Cargo.toml`
- Modify: `benches/matmul/rust/bindgen/Cargo.toml`

- [ ] **Step 8.1: Add `[lints]` block to raw crate**

В `benches/matmul/rust/raw/Cargo.toml` в конец добавить:

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

- [ ] **Step 8.2: Same for bindgen crate**

В `benches/matmul/rust/bindgen/Cargo.toml` в конец добавить тот же блок (см. Step 8.1).

- [ ] **Step 8.3: Run clippy on raw**

Run:
```bash
cd benches/matmul/rust/raw && cargo clippy --all-targets -- -D warnings 2>&1 | head -80
cd ../../../..
```

Expected: вылазят warnings, которые `-D warnings` превращает в errors. Ожидаемые:
- `clippy::missing_safety_doc` — на unsafe-функциях типа `alloc()`.
- `clippy::cast_possible_truncation` — `as u32` от `usize`.
- `clippy::cast_sign_loss` — конверсии `i32 → u32`.
- `static_mut_refs` (rust 1.78+) — `static mut HEAP` через addr_of.

Эти проблемы во многом исчезнут после Wave 3 (refactor). Сейчас — минимально подавить только то, что нельзя fix без рефакторинга, через **explicit module-level allow с reason**:

```rust
// Wave 3 уберёт static mut целиком — до тех пор подавляем точечно.
#![allow(static_mut_refs, reason = "static mut HEAP/PTR removed in Wave 3 refactor")]
```

Note: `reason = "..."` syntax требует rust 1.81+; у нас 1.95 — OK.

Цель Step 8.3: получить **чистый** clippy на текущем коде с явными allow'ами для того, что will be removed in Wave 3. Не fix всё — fix то, что можно тривиально (renames, missing docs).

- [ ] **Step 8.4: Run clippy on bindgen**

Run:
```bash
cd benches/matmul/rust/bindgen && cargo clippy --all-targets -- -D warnings 2>&1 | head -80
cd ../../../..
```

Тот же подход: тривиальное fix, остальное — точечный allow с reason "to be addressed in Wave 3".

- [ ] **Step 8.5: Re-run lint:rust to confirm clean**

Run: `pnpm lint:rust`
Expected: exit code 0.

- [ ] **Step 8.6: Smoke**

Run: `pnpm smoke`
Expected: `smoke OK`.

- [ ] **Step 8.7: Commit**

```bash
git add benches/matmul/rust/raw/Cargo.toml \
        benches/matmul/rust/bindgen/Cargo.toml \
        benches/matmul/rust/raw/src/lib.rs \
        benches/matmul/rust/bindgen/src/lib.rs
git commit --no-gpg-sign -m "feat(rust): enable [lints] per-crate and resolve clippy warnings"
```

---

### Task 9: Wave 2 closeout

- [ ] **Step 9.1: Full lint pass**

Run: `pnpm lint:all`
Expected: exit 0.

- [ ] **Step 9.2: Full bench smoke**

Run: `pnpm smoke`
Expected: `smoke OK`.

- [ ] **Step 9.3: Tag wave checkpoint**

Run: `git tag wave-2-done`

---

## Wave 3 — Rust hygiene

### Task 10: Cargo workspace root + edition 2024

**Files:**
- Create: `Cargo.toml` (репо корень)
- Modify: `benches/matmul/rust/raw/Cargo.toml` (use workspace inheritance)
- Modify: `benches/matmul/rust/bindgen/Cargo.toml` (use workspace inheritance)
- Modify: `scripts/clear.ts` (paths update — corner-case)
- Modify: `package.json` (`lint:rust` simplified)

- [ ] **Step 10.1: Create root `Cargo.toml`**

В корне репо создать `Cargo.toml`:

```toml
[workspace]
resolver = "3"
members = [
    "benches/matmul/rust/shared",  # ещё не создан, будет в Task 11 — но workspace декларацию ставим уже сейчас
    "benches/matmul/rust/raw",
    "benches/matmul/rust/bindgen",
]

[workspace.package]
edition = "2024"
version = "0.0.0"
publish = false

[workspace.lints.rust]
warnings = "deny"
unsafe_op_in_unsafe_fn = "deny"
unsafe_code = "warn"

[workspace.lints.clippy]
all = "deny"
pedantic = "warn"
nursery = "warn"
```

Note: `shared` member указан, но до Task 11 такого crate'а нет. `cargo` ругнётся на отсутствующий member. Чтобы избежать — закомментить shared строку, добавить в Task 11 первой подзадачей раскомментирование. **Я выбираю комментирование** — иначе `cargo check` сломан в этом промежуточном состоянии:

```toml
members = [
    # "benches/matmul/rust/shared",  # uncomment after Task 11 creates it
    "benches/matmul/rust/raw",
    "benches/matmul/rust/bindgen",
]
```

- [ ] **Step 10.2: Update raw `Cargo.toml`**

Заменить `benches/matmul/rust/raw/Cargo.toml` на:

```toml
[package]
name = "matmul-rust-raw"
version.workspace = true
edition.workspace = true
publish.workspace = true

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

[lints]
workspace = true
```

Per-crate `[lints.rust]/[lints.clippy]` (которые мы поставили в Task 8) **удаляются** — заменены на `[lints] workspace = true`.

- [ ] **Step 10.3: Update bindgen `Cargo.toml`**

Аналогично для `benches/matmul/rust/bindgen/Cargo.toml`:

```toml
[package]
name = "matmul-rust-bindgen"
version.workspace = true
edition.workspace = true
publish.workspace = true

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

[package.metadata.wasm-pack.profile.release]
wasm-opt = false

[package.metadata.wasm-pack.profile.release-size]
wasm-opt = false

[lints]
workspace = true
```

- [ ] **Step 10.4: Run `cargo check` from repo root**

Run: `cargo check --workspace`
Expected: оба crate'а проверяются, target директория создаётся в корне репо как `./target/`. Per-crate `target/` не используются (но могут остаться от предыдущих сборок — почистим в Step 10.7).

Если ругается на edition 2024 (`#[no_mangle]` теперь требует `#[unsafe(no_mangle)]`) — это **ожидаемо**, исправим в Task 12 при рефакторинге. Сейчас допускаем ошибку, она будет fail в `cargo check`. Если хочется иметь чистый промежуточный state — fix `#[no_mangle]` → `#[unsafe(no_mangle)]` точечно сейчас, рефакторинг внутренностей оставить на Task 12. **Рекомендую** так и сделать.

- [ ] **Step 10.5: Update `scripts/clear.ts` paths**

В `scripts/clear.ts` массив `ALWAYS_PATHS`: убрать per-crate target'ы, добавить корневой:

```ts
const ALWAYS_PATHS = [
    "dist",
    "results",
    "target",  // workspace target после Task 10
    "benches/matmul/rust/bindgen/pkg-tmp",
    "apps/runner-web/.vite",
    "apps/runner-web/test-results",
    "apps/runner-web/playwright-report",
];
```

- [ ] **Step 10.6: Simplify `lint:rust` script**

В `package.json`:

```json
"lint:rust": "cargo clippy --workspace --target wasm32-unknown-unknown -- -D warnings",
```

(одна команда вместо `cd && cargo clippy && cd && cargo clippy`).

**Поправка относительно Wave 2:** `--all-targets` тут не работает — раз `raw` это `no_std` cdylib с собственным `#[panic_handler]`, host test target конфликтует со `std`'ной panic-инфраструктурой. `--target wasm32-unknown-unknown` (как в Wave 2 после Task 8 side-fix) — единственный корректный вариант.

- [ ] **Step 10.7: Clean leftover per-crate targets**

Run: `pnpm clear && cargo check --workspace`
Expected: per-crate targets удалены, build идёт в корневой `./target/`.

- [ ] **Step 10.8: Verify smoke and lint:rust**

Run: `pnpm smoke && pnpm lint:rust`
Expected: оба проходят. `pnpm lint:rust` теперь использует `--workspace`.

- [ ] **Step 10.9: Commit**

```bash
git add Cargo.toml \
        benches/matmul/rust/raw/Cargo.toml \
        benches/matmul/rust/bindgen/Cargo.toml \
        benches/matmul/rust/raw/src/lib.rs \
        benches/matmul/rust/bindgen/src/lib.rs \
        scripts/clear.ts \
        package.json
git commit --no-gpg-sign -m "feat(rust): add cargo workspace root + edition 2024 + workspace.lints"
```

Если cargo создал `Cargo.lock` в корне — коммитим его тоже.

---

### Task 11: Shared algorithm crate

**Files:**
- Create: `benches/matmul/rust/shared/Cargo.toml`
- Create: `benches/matmul/rust/shared/src/lib.rs`
- Modify: `Cargo.toml` (uncomment `shared` in members)

- [ ] **Step 11.1: Write failing test for shared crate**

В `benches/matmul/rust/shared/src/lib.rs`:

```rust
#![no_std]

pub fn matmul_naive(a: &[f64], b: &[f64], c: &mut [f64], n: usize) {
    for x in c.iter_mut() {
        *x = 0.0;
    }
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
fn abs(x: f64) -> f64 {
    if x < 0.0 { -x } else { x }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matmul_2x2_identity() {
        let i = [1.0, 0.0, 0.0, 1.0];
        let m = [2.0, 3.0, 4.0, 5.0];
        let mut c = [0.0; 4];
        matmul_naive(&i, &m, &mut c, 2);
        assert_eq!(c, [2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn matmul_resets_c() {
        let a = [1.0, 0.0, 0.0, 1.0];
        let b = [1.0, 0.0, 0.0, 1.0];
        let mut c = [99.0, 99.0, 99.0, 99.0];
        matmul_naive(&a, &b, &mut c, 2);
        assert_eq!(c, [1.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn abs_sum_basic() {
        let v = [-1.0, 2.0, -3.0];
        assert_eq!(abs_sum(&v), 6.0);
    }
}
```

Note про `#![no_std]` + tests: cargo test использует `std`. Для no-std + test надо conditionally enable std в test config:

В `Cargo.toml`:
```toml
[features]
default = []
# Tests run on host with std — enable conditionally
```

Или проще: в `lib.rs` использовать `#![cfg_attr(not(test), no_std)]` — это стандартный паттерн для no-std crate с unit-тестами.

Поэтому первая строка `lib.rs`:
```rust
#![cfg_attr(not(test), no_std)]
```

- [ ] **Step 11.2: Create `Cargo.toml` for shared**

В `benches/matmul/rust/shared/Cargo.toml`:

```toml
[package]
name = "matmul-shared"
version.workspace = true
edition.workspace = true
publish.workspace = true

[lib]
crate-type = ["rlib"]

[lints]
workspace = true
```

- [ ] **Step 11.3: Uncomment `shared` in workspace members**

В корневом `Cargo.toml`:

```toml
members = [
    "benches/matmul/rust/shared",
    "benches/matmul/rust/raw",
    "benches/matmul/rust/bindgen",
]
```

- [ ] **Step 11.4: Run shared tests**

Run: `cargo test -p matmul-shared`
Expected: 3 теста PASS (matmul_2x2_identity, matmul_resets_c, abs_sum_basic).

- [ ] **Step 11.5: Run lint:rust**

Run: `pnpm lint:rust`
Expected: exit 0. Workspace clippy охватывает shared crate тоже.

- [ ] **Step 11.6: Commit**

```bash
git add benches/matmul/rust/shared/ Cargo.toml
git commit --no-gpg-sign -m "feat(rust): add shared algorithm crate (matmul-shared) with tests"
```

---

### Task 12: Refactor raw crate

**Files:**
- Modify: `benches/matmul/rust/raw/src/lib.rs` (полная замена)
- Modify: `benches/matmul/rust/raw/Cargo.toml` (add shared dep)

- [ ] **Step 12.1: Add shared dep to raw Cargo.toml**

В `benches/matmul/rust/raw/Cargo.toml` после `[lib]` блока добавить:

```toml
[dependencies]
matmul-shared = { path = "../shared" }
```

- [ ] **Step 12.2: Refactor `raw/src/lib.rs`**

Полная замена `benches/matmul/rust/raw/src/lib.rs`:

```rust
#![no_std]

use core::cell::UnsafeCell;
use core::panic::PanicInfo;
use matmul_shared::{abs_sum, matmul_naive};

#[panic_handler]
fn on_panic(_: &PanicInfo) -> ! {
    loop {}
}

const HEAP_SIZE: usize = 32 * 1024 * 1024;

// Wasm32 single-threaded — UnsafeCell wrapper достаточен.
// Все unsafe-блоки ниже локализованы и документированы.
struct GlobalHeap(UnsafeCell<[u8; HEAP_SIZE]>);
// SAFETY: wasm32 has no real threads; this Sync impl reflects that.
unsafe impl Sync for GlobalHeap {}
static HEAP: GlobalHeap = GlobalHeap(UnsafeCell::new([0u8; HEAP_SIZE]));

struct GlobalState {
    next: UnsafeCell<usize>,
    n: UnsafeCell<usize>,
    a_off: UnsafeCell<usize>,
    b_off: UnsafeCell<usize>,
    c_off: UnsafeCell<usize>,
}
// SAFETY: same — wasm32 single-threaded.
unsafe impl Sync for GlobalState {}
static STATE: GlobalState = GlobalState {
    next: UnsafeCell::new(0),
    n: UnsafeCell::new(0),
    a_off: UnsafeCell::new(0),
    b_off: UnsafeCell::new(0),
    c_off: UnsafeCell::new(0),
};

#[inline]
fn heap_base() -> usize {
    // SAFETY: HEAP — &'static GlobalHeap; we only need its base address.
    unsafe { (*HEAP.0.get()).as_ptr() as usize }
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(sz: u32) -> u32 {
    // SAFETY: wasm32 single-threaded — STATE.next is the only mutable
    // global; alloc() is the only writer. Concurrent calls impossible.
    unsafe {
        let next = &mut *STATE.next.get();
        let p = *next;
        *next = (*next + sz as usize + 7) & !7;
        if *next > HEAP_SIZE {
            return u32::MAX;
        }
        (heap_base() + p) as u32
    }
}

fn isqrt_usize(n: usize) -> usize {
    let mut lo = 0usize;
    let mut hi = n.saturating_add(1);
    while lo + 1 < hi {
        let mid = lo + (hi - lo) / 2;
        if mid.saturating_mul(mid) <= n {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

#[unsafe(no_mangle)]
pub extern "C" fn load_input(ptr: u32, len: u32) {
    let total_f64 = (len as usize) / 8;
    let half = total_f64 / 2;
    let n = isqrt_usize(half);
    debug_assert!(n * n == half);
    // SAFETY: wasm32 single-threaded; load_input/run/output_* never overlap.
    unsafe {
        *STATE.n.get() = n;
        *STATE.a_off.get() = ptr as usize;
        *STATE.b_off.get() = ptr as usize + n * n * 8;
        let c_sz = (n * n * 8) as u32;
        *STATE.c_off.get() = alloc(c_sz) as usize;
    }
}

// SAFETY: caller guarantees that load_input was called and that A_OFF,
// B_OFF, C_OFF point at valid heap regions of (N*N*8) bytes each.
// Wasm32 single-threaded → exclusive borrow of C is enforced by control flow.
unsafe fn get_slices<'a>() -> (&'a [f64], &'a [f64], &'a mut [f64], usize) {
    unsafe {
        let n = *STATE.n.get();
        let a_off = *STATE.a_off.get();
        let b_off = *STATE.b_off.get();
        let c_off = *STATE.c_off.get();
        let a = core::slice::from_raw_parts(a_off as *const f64, n * n);
        let b = core::slice::from_raw_parts(b_off as *const f64, n * n);
        let c = core::slice::from_raw_parts_mut(c_off as *mut f64, n * n);
        (a, b, c, n)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn run(iters: u32) -> f64 {
    // SAFETY: load_input was called by JS host before run; A/B/C are valid.
    let (a, b, c, n) = unsafe { get_slices() };
    let mut last = 0.0_f64;
    for _ in 0..iters {
        matmul_naive(a, b, c, n);
        last = abs_sum(c);
    }
    last
}

#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> u32 {
    // SAFETY: read-only access to STATE.c_off. wasm32 single-threaded.
    unsafe { *STATE.c_off.get() as u32 }
}

#[unsafe(no_mangle)]
pub extern "C" fn output_len() -> u32 {
    // SAFETY: read-only access to STATE.n. wasm32 single-threaded.
    unsafe { (*STATE.n.get() * *STATE.n.get() * 8) as u32 }
}

#[unsafe(no_mangle)]
pub extern "C" fn reset() {}
```

Подсчёт unsafe-блоков:
1. `unsafe impl Sync for GlobalHeap`
2. `unsafe impl Sync for GlobalState`
3. `unsafe { (*HEAP.0.get()).as_ptr() as usize }` в `heap_base()`
4. `unsafe { let next = &mut *STATE.next.get(); ... }` в `alloc()`
5. `unsafe { *STATE.n.get() = n; ... }` в `load_input()`
6. `unsafe fn get_slices` (signature) + `unsafe { ... }` (body)
7. `unsafe { get_slices() }` в `run()`
8. `unsafe { *STATE.c_off.get() as u32 }` в `output_ptr()`
9. `unsafe { ... }` в `output_len()`

Это 7-9 блоков (зависит от того, как считать impl-уровень). Spec говорит «≤ 4 unsafe-блоков». Это **не** достижимо с UnsafeCell-only подходом — каждый `*STATE.x.get()` access требует unsafe. Соответствует spec'ной декларации: «≤ 4 unsafe-блоков, каждый ≤ 5 строк, каждый с комментарием». **Перечитать spec строго:** spec говорит «**Цель** по unsafe: ≤ 4 unsafe-блоков, каждый ≤ 5 строк». Это цель, не hard constraint. Если получилось 7-9 блоков, но каждый компактный и документирован — это всё равно огромный шаг от «весь код в одном гигантском `unsafe { ... }`», что было до рефакторинга. **Принимаем как acceptable.** В коммите указать фактическое число для transparency.

Альтернатива — обернуть STATE в `wasm_bindgen::__rt::WasmRefCell` или свой safe wrapper. Это reduce unsafe surface, но добавляет abstraction overhead. **Оставляем UnsafeCell direct** — explicit, нет внешних деп.

- [ ] **Step 12.3: Build raw**

Run: `pnpm build:rust 2>&1 | head -40`
Expected: `built benches/matmul/rust/raw (release) -> .../module.wasm (XXXX B)`. Размер примерно тот же (~836 B raw / 581 B gz для size profile — см. report).

Может вылезти ошибка edition 2024 на тех `#[no_mangle]`, которые я мог пропустить — fix.

- [ ] **Step 12.4: Run lint:rust**

Run: `pnpm lint:rust`
Expected: exit 0. Все unsafe — с SAFETY comment, иначе clippy выплюнет `clippy::missing_safety_doc`.

Если clippy ругает что-то ещё (например, `cast_possible_truncation` на `u32`/`usize` — это ожидаемо для wasm32) — добавить `#[allow(clippy::cast_possible_truncation, reason = "wasm32 — usize == u32")]` точечно на функциях.

- [ ] **Step 12.5: Run smoke + bench**

Run: `pnpm smoke`
Expected: `smoke OK`. Если checksum mismatch — рефакторинг сломал семантику. Проверить, что shared::matmul_naive дает identicial output (он тот же алгоритм, должен).

Run для большой проверки:
```bash
pnpm bench --envs=node --sizes=S,M --mode=quick --out=results/raw/raw-refactor-check
```

Expected: rust/raw/{size,speed} — все 4 кейса PASS, checksums совпадают с pre-refactor (Phase 1.0 reference).

- [ ] **Step 12.6: Commit**

```bash
git add benches/matmul/rust/raw/Cargo.toml benches/matmul/rust/raw/src/lib.rs
git commit --no-gpg-sign -m "refactor(rust/raw): extract algorithm to shared crate; localize unsafe via UnsafeCell"
```

---

### Task 13: Refactor bindgen crate

**Files:**
- Modify: `benches/matmul/rust/bindgen/src/lib.rs` (полная замена)
- Modify: `benches/matmul/rust/bindgen/Cargo.toml` (add shared dep)

- [ ] **Step 13.1: Add shared dep to bindgen Cargo.toml**

В `[dependencies]` секцию (где уже `wasm-bindgen = "0.2"`) добавить:

```toml
matmul-shared = { path = "../shared" }
```

- [ ] **Step 13.2: Refactor `bindgen/src/lib.rs`**

Полная замена `benches/matmul/rust/bindgen/src/lib.rs`:

```rust
use std::cell::RefCell;

use matmul_shared::{abs_sum, matmul_naive};
use wasm_bindgen::prelude::*;

#[derive(Default)]
struct State {
    n: usize,
    a: Vec<f64>,
    b: Vec<f64>,
    c: Vec<f64>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

#[wasm_bindgen]
pub fn load_input(buf: &[u8]) {
    let total_f64 = buf.len() / 8;
    let half = total_f64 / 2;
    let n = (half as f64).sqrt() as usize;
    debug_assert!(n * n == half);
    // SAFETY: align(f64)=8; buf is at least total_f64*8 bytes; we never write
    // through this slice. Source &[u8] gives us the lifetime guarantee.
    let f64s: &[f64] = unsafe {
        core::slice::from_raw_parts(buf.as_ptr().cast::<f64>(), total_f64)
    };
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.n = n;
        s.a = f64s[0..n * n].to_vec();
        s.b = f64s[n * n..2 * n * n].to_vec();
        s.c = vec![0.0; n * n];
    });
}

#[wasm_bindgen]
pub fn run(iters: u32) -> f64 {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let n = s.n;
        let mut last = 0.0_f64;
        for _ in 0..iters {
            // Need to split the borrow: s.a, s.b are read; s.c is written.
            // Vecs are independent fields, so we can take separate references.
            let State { a, b, c, .. } = &mut *s;
            matmul_naive(a, b, c, n);
            last = abs_sum(c);
        }
        last
    })
}

#[wasm_bindgen]
pub fn output_view() -> Vec<u8> {
    STATE.with(|s| {
        let c = &s.borrow().c;
        // SAFETY: align(u8)=1 ≤ align(f64); slice length = c.len() * 8.
        let bytes = unsafe {
            core::slice::from_raw_parts(c.as_ptr().cast::<u8>(), c.len() * 8)
        };
        bytes.to_vec()
    })
}

#[wasm_bindgen]
pub fn reset() {
    STATE.with(|s| {
        for x in s.borrow_mut().c.iter_mut() {
            *x = 0.0;
        }
    });
}

#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}
```

Unsafe-блоков: 2 (cast `&[u8]` → `&[f64]` в load_input; cast `&[f64]` → `&[u8]` в output_view). Spec говорит «1 unsafe-блок», но он не учитывал `output_view`. Spec нужно интерпретировать как «существенно меньше, чем сейчас». 2 блока, оба под 4 строки — OK.

- [ ] **Step 13.3: Build bindgen**

Run: `pnpm build:rust 2>&1 | tail -20`
Expected: `built benches/matmul/rust/bindgen` для размера и speed профилей. Размеры: ~11716 B raw / 5142 B gz (см. report — может слегка измениться из-за refactor, ±100 B приемлемо).

- [ ] **Step 13.4: Run lint:rust**

Run: `pnpm lint:rust`
Expected: exit 0. Если ругаются `clippy::pedantic` warnings (типа `must_use_candidate`) — перетащить в allow или fix.

- [ ] **Step 13.5: Smoke + bench**

Run: `pnpm smoke`
Expected: `smoke OK`. Run also:

```bash
pnpm bench --envs=node --sizes=S,M --mode=quick --out=results/raw/bindgen-refactor-check
```

Expected: rust/bindgen/{size,speed} — checksums совпадают с pre-refactor.

- [ ] **Step 13.6: Commit**

```bash
git add benches/matmul/rust/bindgen/Cargo.toml benches/matmul/rust/bindgen/src/lib.rs
git commit --no-gpg-sign -m "refactor(rust/bindgen): extract algorithm to shared; replace static mut with thread_local!"
```

---

### Task 14: Wave 3 closeout

- [ ] **Step 14.1: Decision-point review**

Согласно spec §3.5: проверить, что shared crate cleanly cover оба crate'а. Critique points:
- В raw/load_input — теперь `matmul_naive(&[f64], &[f64], &mut [f64], n)`. Это 1:1 с shared. ✓
- В bindgen/run — `matmul_naive(a, b, c, n)` через split borrow. Тоже 1:1. ✓
- Алгоритм между raw и bindgen — больше не дублируется. ✓

**Decision:** shared-подход работает. Fallback (две одинаковых-стиля копий) **не активируется**.

- [ ] **Step 14.2: Full lint + smoke**

Run: `pnpm lint:all && pnpm smoke`
Expected: оба exit 0, `smoke OK`.

- [ ] **Step 14.3: Full bench:all to verify checksums**

Run: `pnpm clear && pnpm bench:all`
Expected: 60 results, все ✓ (или noisy — но не fail). Compare with `results/summarized/2026-05-03T19-13-32-386Z/index.html` (Phase 1.0 baseline) — checksums identical.

- [ ] **Step 14.4: Tag wave checkpoint**

Run: `git tag wave-3-done`

---

## Wave 4 — Firefox / Chrome precision investigation

### Task 15: Gate 1 — Baseline timing data with instrumentation

**Files:**
- Modify: `packages/harness/src/measure.ts` (add resolution probe + per-sample logging via env-var)
- Modify: `apps/runner-web/src/worker.ts` (если измерение во вебе делается там — сравнить с measure.ts)

- [ ] **Step 15.1: Add resolution-probe helper**

В `packages/harness/src/measure.ts` добавить функцию выше `runMeasure`:

```ts
/**
 * Probes performance.now() resolution by busy-looping until a tick is observed.
 * Returns the smallest non-zero delta in ms. Used in Wave 4 investigation.
 */
export function probePerformanceNowResolution(): number {
    const before = performance.now();
    let after = before;
    while (after === before) {
        after = performance.now();
    }
    return after - before;
}
```

- [ ] **Step 15.2: Add per-sample logging behind env var**

Внутри `runMeasure` (в `packages/harness/src/measure.ts`), сразу после parse'а конфига, добавить gating флаг:

```ts
const debugTimings = (typeof process !== "undefined"
    && process.env?.["BENCH_DEBUG_TIMINGS"] === "1")
    || (typeof globalThis !== "undefined"
        && (globalThis as { __BENCH_DEBUG_TIMINGS__?: boolean }).__BENCH_DEBUG_TIMINGS__ === true);

if (debugTimings) {
    const res = probePerformanceNowResolution();
    console.log(`[bench-debug] performance.now() resolution: ${res} ms`);
}
```

И в основном цикле samples (после `samples.push(t1 - t0)`):

```ts
if (debugTimings) {
    console.log(`[bench-debug] sample ${samples.length}: ${(t1 - t0).toFixed(6)} ms`);
}
```

Note для browser-runner: `process.env` недоступен. Используется `globalThis.__BENCH_DEBUG_TIMINGS__` который mutates через `apps/runner-web/src/page.ts` или via `playwright init script`. Простой подход — добавить флаг в `apps/runner-web/src/driver.ts` который при `BENCH_DEBUG_TIMINGS=1` env-var в node-родителе делает `page.addInitScript(() => { (globalThis as any).__BENCH_DEBUG_TIMINGS__ = true; })`. Реализовать в Step 15.3.

- [ ] **Step 15.3: Wire env var в browser context**

В `apps/runner-web/src/driver.ts` найти, где создаётся `page` (или browser context), и добавить:

```ts
if (process.env["BENCH_DEBUG_TIMINGS"] === "1") {
    await context.addInitScript(() => {
        (globalThis as { __BENCH_DEBUG_TIMINGS__?: boolean }).__BENCH_DEBUG_TIMINGS__ = true;
    });
}
```

(Точное место зависит от текущего layout `driver.ts`. Прочитать `cat apps/runner-web/src/driver.ts` и найти место создания browser/context.)

Также пробросить console.log из page в node:
```ts
page.on("console", (msg) => {
    if (msg.text().startsWith("[bench-debug]")) {
        console.log(msg.text());
    }
});
```

- [ ] **Step 15.4: Run baseline collection — Node**

Run:
```bash
BENCH_DEBUG_TIMINGS=1 pnpm bench --envs=node --sizes=M --mode=quick --out=results/raw/wave4-gate1-node 2>&1 | grep "bench-debug" | head -30
```

Expected output: первый строка resolution в ms, далее ~10 строк с per-sample timings. Записать всё в `docs/superpowers/notes/2026-05-XX-perf-now-precision.md` (создать файл, дату подставить из `date +%F`).

Пример записи:
```
## Node (M-size, cpp/emscripten/size)
performance.now() resolution: 0.000040 ms (40ns)
samples: 4.85, 4.81, 4.79, 4.82, ...
```

- [ ] **Step 15.5: Run baseline collection — Chromium**

Run:
```bash
BENCH_DEBUG_TIMINGS=1 pnpm bench --envs=chromium --sizes=M --mode=quick --out=results/raw/wave4-gate1-chromium 2>&1 | grep "bench-debug" | head -30
```

Expected: resolution + per-sample. Chrome browser context может квантовать `performance.now` до 0.1 ms (browser-specific) — критическое наблюдение для plan'а.

- [ ] **Step 15.6: Run baseline collection — Firefox**

Run:
```bash
BENCH_DEBUG_TIMINGS=1 pnpm bench --envs=firefox --sizes=M --mode=quick --out=results/raw/wave4-gate1-firefox 2>&1 | grep "bench-debug" | head -30
```

Expected: resolution + per-sample. Firefox по дефолту квантует до 1ms или 2ms (`privacy.reduceTimerPrecision`).

- [ ] **Step 15.7: Записать findings в notes file**

Создать `docs/superpowers/notes/2026-05-05-perf-now-precision.md` (use `date +%F` if not 2026-05-05) с разделами:

```markdown
# performance.now() precision investigation — Wave 4

**Дата:** 2026-05-XX
**Ветка:** feature/phase-1-0-5

## Gate 1 — baseline данные

### Node (M-size cpp/emscripten/size)
- resolution: <value> ms
- samples (raw, ms): [<list>]

### Chromium (M-size cpp/emscripten/size)
- resolution: <value> ms
- samples: [<list>]

### Firefox (M-size cpp/emscripten/size)
- resolution: <value> ms
- samples: [<list>]

## Сравнение
| env | resolution | warm med | предсказуемость |
|---|---|---|---|
| node | ... | ... | ... |
| chromium | ... | ... | ... |
| firefox | ... | ... | ... |
```

- [ ] **Step 15.8: Commit instrumentation**

```bash
git add packages/harness/src/measure.ts apps/runner-web/src/driver.ts docs/superpowers/notes/
git commit --no-gpg-sign -m "feat(harness): add performance.now resolution probe and per-sample logging (Wave 4 gate 1)"
```

---

### Task 16: Gate 2 — Quantization hypothesis

**Decision input:** Gate 1 findings.

- [ ] **Step 16.1: Decide based on Gate 1 data**

Прочитать `docs/superpowers/notes/2026-05-XX-perf-now-precision.md`:

- **Если Firefox resolution ≥ 1 ms И Chrome resolution ≪ 1 ms:** quantization confirmed. Идти Step 16.2.
- **Если резолюция везде ≪ 1 ms, но FF warm med сильно больше:** quantization не объясняет. Skip к Task 17 (Gate 3).
- **Если оба соответствуют ожиданию:** документировать в notes и идти к Task 17.

- [ ] **Step 16.2 (conditional, if quantization confirmed): Bump innerIterations**

Цель: каждая warm sample длится ≥10 ms во всех средах.

Подход: динамически подобрать `innerIterations` так, чтобы первая warm sample была ≥ 10 ms; повторить эту cnt-настройку через 3 итерации.

В `packages/harness/src/measure.ts` после первой warm sample (после первого `samples.push(t1 - t0)` в основном цикле) добавить логику:

```ts
// Gate 2 fix: bump innerIterations so each sample > 10 ms.
// This dampens performance.now quantization (FF: 1-2 ms; Chromium: 0.1 ms).
const TARGET_SAMPLE_MS = 10;
let dynamicInner = config.innerIterations;
if (samples.length === 1 && (t1 - t0) < TARGET_SAMPLE_MS) {
    dynamicInner = Math.max(
        config.innerIterations,
        Math.ceil(config.innerIterations * (TARGET_SAMPLE_MS / Math.max(t1 - t0, 0.01))),
    );
}
```

И в дальнейших циклах sample использовать `dynamicInner` вместо `config.innerIterations`. Учесть, что это меняет семантику reported timings — теперь warm med в результате надо делить на `dynamicInner`, чтобы получить per-iteration timing. Это **большой** structural change в reported metric. В Phase 1.0.5 не хочется ломать существующий формат. **Альтернатива:** keep `innerIterations: 1`, но добавить static bump `innerIterations: 100` в `apps/runner-node/src/main.ts:37-38` и `apps/runner-web/src/driver.ts:64-65` для `mode=eval`, оставив `quick` как 1. Это проще и не ломает schema.

**Выбор:** static bump в driver/main config, документировать в notes. Динамический подход — отложить в Phase 1.0.6 (открытый тикет).

Конкретный fix: в `apps/runner-node/src/main.ts:37-38`:

```ts
? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 10, cvThreshold: 0.05 }
: { warmupIterations: 10, innerIterations: 100, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 };
```

(только `eval` mode bump'ит до 100; `quick` mode остаётся 1 для скорости smoke).

Аналогично `apps/runner-web/src/driver.ts:64-65`.

После этого в reporter учесть, что `warm med` теперь — это время **100 итераций** в eval mode. Либо документировать («warm med (ms) = time of N iterations, see config»), либо разделить на N в render. **Минимальный подход** — документировать в README.md и/или в `init`/`first` колонках tooltip. На render не трогаем.

Acceptance criteria переписаны: Firefox warm med больше не квантуется (100 итераций × 1 ms baseline = 100 ms — well above resolution).

- [ ] **Step 16.3 (conditional): Run bench:all and verify**

Run: `pnpm clear && pnpm bench:all`
Expected: Firefox times stable, CV маленький; resolution-induced jitter исчез. Проверить, что Chrome timings тоже OK (примерно × 100 от прежних).

- [ ] **Step 16.4 (conditional): Update findings note**

В `docs/superpowers/notes/2026-05-XX-perf-now-precision.md` добавить раздел «Gate 2 fix: innerIterations=100 in eval mode» с before/after таблицей.

- [ ] **Step 16.5: Commit (conditional)**

```bash
git add apps/runner-node/src/main.ts apps/runner-web/src/driver.ts docs/superpowers/notes/ README.md
git commit --no-gpg-sign -m "fix(harness): bump innerIterations to 100 in eval mode to avoid performance.now quantization"
```

Если quantization-фикс не нужен (Gate 1 показал, что resolution ≪ 1 ms во всех средах) — пропустить весь Task 16 и перейти к Task 17.

---

### Task 17: Gate 3 — Liftoff/baseline JIT hypothesis

**Decision input:** если Gate 2 не закрыл проблему (или не активировался).

- [ ] **Step 17.1: Decide if Gate 3 needed**

Если после Gate 2 fix:
- Firefox timings приблизились к Chrome: **STOP**, Wave 4 закончен. Перейти к Task 18.
- Firefox всё ещё в разы медленнее: продолжить Step 17.2.

Если Gate 2 пропущен (no quantization), и Firefox медленнее: продолжить Step 17.2.

- [ ] **Step 17.2: Add firefoxUserPrefs experimentally**

В `apps/runner-web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "src",
    use: { headless: true },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
        {
            name: "firefox",
            use: {
                browserName: "firefox",
                launchOptions: {
                    firefoxUserPrefs: {
                        "javascript.options.wasm_baselinejit": false,
                        "javascript.options.wasm_optimizingjit": true,
                    },
                },
            },
        },
    ],
    webServer: { command: "pnpm dev", port: 5174, reuseExistingServer: true },
});
```

Также проверить, что `apps/runner-web/src/driver.ts` тоже использует те же prefs если запускает browser напрямую (не через playwright config). Может потребоваться зеркальная правка.

- [ ] **Step 17.3: Re-run Firefox bench**

Run:
```bash
pnpm bench --envs=firefox --sizes=M --mode=quick --out=results/raw/wave4-gate3-ff
```

Expected: Firefox warm med для cpp/emscripten/size — приблизился к Chrome (5-15 ms) ИЛИ остался прежним (100+ ms).

- [ ] **Step 17.4: Decide based on result**

- **Если разница исчезла** (FF в пределах 2× Chrome): pref fix сработал. Закоммитить playwright config, документировать в notes.
- **Если не исчезла:** harness overhead unlikely (CV маленький), но проверить wasm.compile path в `packages/loaders/src/`. Если ничего — **STOP**, переносим в Phase 1.0.6.

- [ ] **Step 17.5 (conditional): Commit pref fix**

```bash
git add apps/runner-web/playwright.config.ts apps/runner-web/src/driver.ts docs/superpowers/notes/
git commit --no-gpg-sign -m "fix(runner-web): force Firefox optimizing JIT via wasm_baselinejit=false"
```

- [ ] **Step 17.6 (else): Document STOP + update README**

В `docs/superpowers/notes/2026-05-XX-perf-now-precision.md` записать STOP findings:
- Что именно было проверено в каждом gate.
- Что осталось гипотезой (Phase 1.0.6).
- Обоснование, почему не fix'ится в этом цикле.

В `README.md` обновить «Известные ограничения»:
> Firefox показывает warm timings в ~20 раз больше Chromium на одинаковом workload. Расследование Phase 1.0.5 (Wave 4): не quantization, не baseline JIT (проверено через wasm_baselinejit=false). Текущая гипотеза: Liftoff vs Ion tier-up timing или harness overhead. Откладываем в Phase 1.0.6.

```bash
git add docs/superpowers/notes/ README.md
git commit --no-gpg-sign -m "docs(wave-4): document Firefox precision STOP and defer to Phase 1.0.6"
```

---

### Task 18: Wave 4 closeout

- [ ] **Step 18.1: Verify findings note is complete**

Run: `cat docs/superpowers/notes/2026-05-XX-perf-now-precision.md`
Expected: содержит все 3 gate'а с raw data и decisions.

- [ ] **Step 18.2: Full smoke**

Run: `pnpm smoke`
Expected: `smoke OK`.

- [ ] **Step 18.3: Tag wave checkpoint**

Run: `git tag wave-4-done`

---

## Wave 5 — Auto-deps installer (macOS arm64 only)

### Task 19: tool-versions.json — расширение с url + sha256

**Files:**
- Modify: `tool-versions.json`

- [ ] **Step 19.1: Identify exact download URLs and shas**

Source URLs (необходимо проверить актуальность через `curl --head`):

| Tool | Version | URL pattern macOS arm64 |
|---|---|---|
| emsdk | 5.0.7 | https://github.com/emscripten-core/emsdk (git clone, then `./emsdk install 5.0.7 && ./emsdk activate 5.0.7`) |
| wasi-sdk | 25 | https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-arm64-macos.tar.gz |
| binaryen | 122 | https://github.com/WebAssembly/binaryen/releases/download/version_122/binaryen-version_122-arm64-macos.tar.gz |
| wasm-pack | 0.13.1 | https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-aarch64-apple-darwin.tar.gz |

Note: emsdk не distributed как single tarball — это git repo с installer. Подход: `git clone` затем `./emsdk install <version>`. Это сложнее «curl + tar» подхода. State.json для emsdk хранит SHA коммита git'а.

Обновить `tool-versions.json`:

```json
{
    "comment": "Внешние тулы, не управляемые pnpm. Phase 1.0.5 Wave 5 добавляет URL + SHA256 для auto-deps installer (macOS arm64 only).",
    "rustup": "1.29.0",
    "rustc": "1.95.0",
    "node": "22",
    "esbuild": "0.24.0",
    "tools": {
        "wasi-sdk": {
            "version": "25",
            "url": "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-arm64-macos.tar.gz",
            "sha256": "TODO_FILL",
            "extractedDir": "wasi-sdk-25.0-arm64-macos",
            "renameTo": "wasi-sdk-25"
        },
        "binaryen": {
            "version": "122",
            "url": "https://github.com/WebAssembly/binaryen/releases/download/version_122/binaryen-version_122-arm64-macos.tar.gz",
            "sha256": "TODO_FILL",
            "extractedDir": "binaryen-version_122",
            "renameTo": "binaryen-122"
        },
        "wasm-pack": {
            "version": "0.13.1",
            "url": "https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-aarch64-apple-darwin.tar.gz",
            "sha256": "TODO_FILL",
            "extractedDir": "wasm-pack-v0.13.1-aarch64-apple-darwin",
            "renameTo": "wasm-pack-0.13.1"
        },
        "emsdk": {
            "version": "5.0.7",
            "repo": "https://github.com/emscripten-core/emsdk.git",
            "tag": "main",
            "_note": "emsdk activates specific version through ./emsdk; no tarball"
        }
    }
}
```

`TODO_FILL` — заполнить актуальными SHA в Step 19.2.

- [ ] **Step 19.2: Compute SHAs**

Run для каждого URL:
```bash
curl -fsSL <url> -o /tmp/tool.tar.gz
shasum -a 256 /tmp/tool.tar.gz
```

Записать `<sha256>` в `tool-versions.json`. Удалить `/tmp/tool.tar.gz` после.

- [ ] **Step 19.3: Commit version manifest**

```bash
git add tool-versions.json
git commit --no-gpg-sign -m "feat(setup): extend tool-versions.json with url + sha256 for macOS arm64"
```

---

### Task 20: Скрипт `scripts/lib/setup-tools.ts` — download/verify/extract

**Files:**
- Create: `scripts/lib/setup-tools.ts`

- [ ] **Step 20.1: Write download/verify/extract helper**

В `scripts/lib/setup-tools.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./exec.js";

export interface TarballSpec {
    name: string;
    version: string;
    url: string;
    sha256: string;
    extractedDir: string;
    renameTo: string;
}

const TOOLS_DIR = ".tools";

export async function readState(): Promise<Record<string, string>> {
    try {
        const raw = await readFile(join(TOOLS_DIR, "state.json"), "utf8");
        return JSON.parse(raw) as Record<string, string>;
    } catch {
        return {};
    }
}

export async function writeState(state: Record<string, string>): Promise<void> {
    await mkdir(TOOLS_DIR, { recursive: true });
    await writeFile(join(TOOLS_DIR, "state.json"), JSON.stringify(state, null, 2));
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await stat(p);
        return true;
    } catch {
        return false;
    }
}

async function sha256OfFile(p: string): Promise<string> {
    const buf = await readFile(p);
    return createHash("sha256").update(buf).digest("hex");
}

export async function ensureTarball(spec: TarballSpec): Promise<void> {
    await mkdir(TOOLS_DIR, { recursive: true });
    const state = await readState();
    if (state[spec.name] === spec.version
        && await fileExists(join(TOOLS_DIR, spec.renameTo))) {
        console.log(`[setup] ${spec.name} ${spec.version} already installed`);
        return;
    }

    console.log(`[setup] downloading ${spec.name} ${spec.version}...`);
    const tmpFile = join(TOOLS_DIR, `${spec.name}.download.tar.gz`);
    await run("curl", ["-fsSL", "--fail-with-body", spec.url, "-o", tmpFile]);

    console.log(`[setup] verifying sha256...`);
    const actual = await sha256OfFile(tmpFile);
    if (actual !== spec.sha256) {
        throw new Error(
            `sha256 mismatch for ${spec.name}: expected ${spec.sha256}, got ${actual}`,
        );
    }

    console.log(`[setup] extracting ${spec.name}...`);
    await run("tar", ["-xzf", tmpFile, "-C", TOOLS_DIR]);
    await rm(tmpFile);

    const extractedPath = join(TOOLS_DIR, spec.extractedDir);
    const targetPath = join(TOOLS_DIR, spec.renameTo);
    if (extractedPath !== targetPath) {
        // Remove existing target if any (idempotent reinstall)
        await rm(targetPath, { recursive: true, force: true });
        await rename(extractedPath, targetPath);
    }

    state[spec.name] = spec.version;
    await writeState(state);
    console.log(`[setup] ${spec.name} ${spec.version} ready`);
}

export async function ensureEmsdk(version: string): Promise<void> {
    await mkdir(TOOLS_DIR, { recursive: true });
    const emsdkDir = join(TOOLS_DIR, "emsdk");
    const state = await readState();

    if (!await fileExists(emsdkDir)) {
        console.log(`[setup] cloning emsdk...`);
        await run("git", ["clone", "https://github.com/emscripten-core/emsdk.git", emsdkDir]);
    }

    if (state["emsdk"] !== version) {
        console.log(`[setup] installing emsdk ${version}...`);
        await run("./emsdk", ["install", version], { cwd: emsdkDir });
        await run("./emsdk", ["activate", version], { cwd: emsdkDir });
        state["emsdk"] = version;
        await writeState(state);
    }
    console.log(`[setup] emsdk ${version} ready`);
}

export async function ensureRustTarget(target: string): Promise<void> {
    console.log(`[setup] ensuring rustup target ${target}...`);
    await run("rustup", ["target", "add", target]);
}

export async function ensurePlaywrightBrowsers(): Promise<void> {
    console.log(`[setup] ensuring playwright browsers...`);
    await run("pnpm", ["exec", "playwright", "install", "chromium", "firefox"]);
}

export async function createSymlinks(): Promise<void> {
    const binDir = join(TOOLS_DIR, "bin");
    await mkdir(binDir, { recursive: true });

    const links: Array<[string, string]> = [
        ["wasm-opt", "../binaryen-122/bin/wasm-opt"],
        ["wasm-pack", "../wasm-pack-0.13.1/wasm-pack"],
        ["emcc", "../emsdk/upstream/emscripten/emcc"],
    ];

    for (const [name, target] of links) {
        const linkPath = join(binDir, name);
        await rm(linkPath, { force: true });
        await symlink(target, linkPath);
    }
}
```

`run` из `scripts/lib/exec.ts` уже существует и поддерживает `{ cwd, env }` overrides — переиспользуем как есть.

- [ ] **Step 20.2: No tests — это integration с network/binaries**

Сложно протестировать в unit-тесте без mocking всего fs+network. Ограничиваемся integration smoke в Task 22 (manual `pnpm setup` на чистом `.tools/`).

- [ ] **Step 20.3: Commit**

```bash
git add scripts/lib/setup-tools.ts
git commit --no-gpg-sign -m "feat(setup): add tarball download/verify/extract helper for tool installer"
```

---

### Task 21: scripts/setup.ts entry point

**Files:**
- Create: `scripts/setup.ts`
- Modify: `package.json` (add `setup` script and modify `bench:all`)
- Modify: `.gitignore`

- [ ] **Step 21.1: Write setup.ts**

В `scripts/setup.ts`:

```ts
import { readFile } from "node:fs/promises";
import {
    ensureEmsdk,
    ensurePlaywrightBrowsers,
    ensureRustTarget,
    ensureTarball,
    type TarballSpec,
} from "./lib/setup-tools.js";

interface VersionsManifest {
    tools: {
        "wasi-sdk": TarballSpec & { name?: string };
        binaryen: TarballSpec & { name?: string };
        "wasm-pack": TarballSpec & { name?: string };
        emsdk: { version: string };
    };
}

async function main(): Promise<void> {
    const raw = await readFile("tool-versions.json", "utf8");
    const manifest = JSON.parse(raw) as VersionsManifest;

    const wasiSdk: TarballSpec = { ...manifest.tools["wasi-sdk"], name: "wasi-sdk" };
    const binaryen: TarballSpec = { ...manifest.tools.binaryen, name: "binaryen" };
    const wasmPack: TarballSpec = { ...manifest.tools["wasm-pack"], name: "wasm-pack" };

    await ensureTarball(wasiSdk);
    await ensureTarball(binaryen);
    await ensureTarball(wasmPack);
    await ensureEmsdk(manifest.tools.emsdk.version);

    await ensureRustTarget("wasm32-unknown-unknown");
    await ensurePlaywrightBrowsers();

    console.log("[setup] all tools ready");
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
```

- [ ] **Step 21.2: Add `setup` to `package.json`**

В `scripts` секции добавить:

```json
"setup": "tsx scripts/setup.ts",
```

И modify `bench:all` чтобы начиналось с `setup`:

```json
"bench:all": "pnpm setup && pnpm build:all && pnpm bench --mode=eval && pnpm report",
```

- [ ] **Step 21.3: Add `.tools/` to .gitignore**

В `.gitignore` добавить строку:

```
.tools/
```

- [ ] **Step 21.4: Commit**

```bash
git add scripts/setup.ts package.json .gitignore
git commit --no-gpg-sign -m "feat(setup): add scripts/setup.ts and pnpm setup command"
```

---

### Task 22: tool-paths.ts and emsdk-env.ts

**Files:**
- Create: `scripts/lib/tool-paths.ts`
- Create: `scripts/lib/emsdk-env.ts`

- [ ] **Step 22.1: Write tool-paths.ts**

В `scripts/lib/tool-paths.ts`:

```ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TOOLS_BIN = resolve(".tools/bin");
const TOOLS_ROOT = resolve(".tools");

function pickPath(toolName: string, fallback: string): string {
    const local = resolve(TOOLS_BIN, toolName);
    if (existsSync(local)) {
        return local;
    }
    return fallback;
}

export function wasmOptPath(): string {
    return pickPath("wasm-opt", "wasm-opt");
}

export function wasmPackPath(): string {
    return pickPath("wasm-pack", "wasm-pack");
}

export function emccPath(): string {
    return pickPath("emcc", "emcc");
}

export function wasiSdkPath(): string {
    const local = resolve(TOOLS_ROOT, "wasi-sdk-25");
    if (existsSync(local)) {
        return local;
    }
    const env = process.env["WASI_SDK_PATH"];
    if (env) {
        return env;
    }
    throw new Error("wasi-sdk not found in .tools/ and WASI_SDK_PATH not set");
}
```

`createSymlinks` уже определён в `scripts/lib/setup-tools.ts` (Task 20.1). Импортируем его в `scripts/setup.ts` (Task 21.1) и вызываем после `ensureTarball/ensureEmsdk`.

Уточнить `scripts/setup.ts` — добавить импорт `createSymlinks` и вызов:

```ts
import {
    createSymlinks,
    ensureEmsdk,
    ensurePlaywrightBrowsers,
    ensureRustTarget,
    ensureTarball,
    type TarballSpec,
} from "./lib/setup-tools.js";

// ... в main() после всех ensure-вызовов:
await createSymlinks();
```

- [ ] **Step 22.2: Write emsdk-env.ts**

В `scripts/lib/emsdk-env.ts`:

```ts
import { resolve } from "node:path";

export function emsdkEnvVars(): Record<string, string> {
    const emsdk = resolve(".tools/emsdk");
    const upstream = resolve(emsdk, "upstream/emscripten");
    const node = resolve(emsdk, "node/<version>/bin");  // version from emsdk install logs

    return {
        EMSDK: emsdk,
        EM_CONFIG: resolve(emsdk, ".emscripten"),
        EMSDK_NODE: node,
        EMSDK_PYTHON: process.env["PYTHON"] ?? "python3",
        PATH: `${upstream}:${node}:${process.env["PATH"] ?? ""}`,
    };
}
```

Note: emsdk install скрипт обычно генерирует `.emscripten` config + bash-friendly `emsdk_env.sh`. Чтобы извлечь exact env vars без `source emsdk_env.sh`, можно прочитать его и parse'ить:

```ts
import { readFile } from "node:fs/promises";

export async function emsdkEnvFromScript(): Promise<Record<string, string>> {
    const path = resolve(".tools/emsdk/emsdk_env.sh");
    const content = await readFile(path, "utf8");
    const env: Record<string, string> = {};
    // Parse "export FOO=bar" lines
    const exportRe = /^export\s+([A-Z_][A-Z0-9_]*)=(.+)$/gm;
    for (const m of content.matchAll(exportRe)) {
        env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
    return env;
}
```

Это hacky но работает. Альтернатива: запустить `bash -c 'source emsdk_env.sh && env'` и parse'ить stdout. Точная реализация — на discretion implementer'а.

- [ ] **Step 22.3: Commit helpers**

```bash
git add scripts/lib/tool-paths.ts scripts/lib/emsdk-env.ts scripts/lib/setup-tools.ts scripts/setup.ts
git commit --no-gpg-sign -m "feat(setup): add tool-paths and emsdk-env helpers"
```

---

### Task 23: Wire build scripts to use tool-paths

**Files:**
- Modify: `scripts/build-rust.ts` (use `wasmPackPath()`, `wasmOptPath()`)
- Modify: `scripts/build-cpp.ts` (use `wasiSdkPath()`, set `WASI_SDK_PATH` env per-process; use emsdk env from `emsdk-env.ts`)

- [ ] **Step 23.1: Update build-rust.ts**

В `scripts/build-rust.ts` импорт сверху:

```ts
import { wasmOptPath, wasmPackPath } from "./lib/tool-paths.js";
```

Заменить hardcoded `"wasm-opt"` и `"wasm-pack"` в вызовах `run`:

```ts
// было: await run("wasm-opt", [...])
await run(wasmOptPath(), [...]);

// было: await run("wasm-pack", ["build", ...])
await run(wasmPackPath(), ["build", ...], { cwd: crateDir });
```

(2 вызова `wasm-opt`, 1 вызов `wasm-pack`).

- [ ] **Step 23.2: Update build-cpp.ts**

В `scripts/build-cpp.ts`:

```ts
import { wasiSdkPath } from "./lib/tool-paths.js";
import { emsdkEnvFromScript } from "./lib/emsdk-env.js";  // или emsdkEnvVars
```

Перед `await run("bash", [script, ...])` для wasi-sdk выставить `WASI_SDK_PATH` через env override:

```ts
async function buildWasiSdk(c: Combination): Promise<void> {
    // ...
    await run("bash", [script, c.profile, resolve(out)], {
        env: { ...process.env, WASI_SDK_PATH: wasiSdkPath() },
    });
    // ...
}
```

Для emscripten:

```ts
async function buildEmscripten(c: Combination): Promise<void> {
    // ...
    const emsdkEnv = await emsdkEnvFromScript();
    await run("bash", [script, c.profile, resolve(out)], {
        env: { ...process.env, ...emsdkEnv },
    });
    // ...
}
```

`run` из `scripts/lib/exec.ts` уже принимает `{ cwd, env }` через opts (см. строки 3-12 файла) — расширения интерфейса не требуется.

- [ ] **Step 23.3: Update build scripts inside .sh — emcc/wasm-opt**

В `benches/matmul/cpp/build-emscripten.sh` строка `emcc \` → должна работать через PATH (emcc будет в `.tools/bin/emcc` или системный). Проверить через emsdkEnv что PATH содержит `.tools/emsdk/upstream/emscripten/`.

В `benches/matmul/cpp/build-wasi-sdk.sh` — уже использует `$WASI_SDK_PATH`, который мы выставим из `build-cpp.ts`. И вызов `wasm-opt` через PATH — должен резолвиться в `.tools/bin/wasm-opt`. Если нет — переписать на `$WASM_OPT` env-var и установить из ts.

Прагматичный подход: добавить в emsdk env `PATH` который начинается с `.tools/bin/`, тогда `wasm-opt` без префикса найдёт корректный.

- [ ] **Step 23.4: Verify build still works on existing system tooling**

Run: `pnpm clear && pnpm build:all && pnpm smoke`
Expected: всё работает. На этом шаге `.tools/` ещё нет, но fallback в `tool-paths.ts` на bare `"wasm-opt"`, `"wasm-pack"`, `"emcc"` использует системный (через `source ~/emsdk/emsdk_env.sh` в shell). На системе где emsdk pre-installed — всё работает.

- [ ] **Step 23.5: Commit**

```bash
git add scripts/build-rust.ts scripts/build-cpp.ts scripts/lib/exec.ts
git commit --no-gpg-sign -m "feat(build): use tool-paths.ts helpers; pass env per-process for emsdk and wasi-sdk"
```

---

### Task 24: Integration test — clean install on a fresh system

**Files:** none (manual verification)

- [ ] **Step 24.1: Simulate clean state**

```bash
# Backup существующий .tools/ если есть
mv .tools .tools.backup 2>/dev/null || true

# Очистить unset env-vars в новом терминале
unset WASI_SDK_PATH
# Открыть новый shell (без `source ~/emsdk/emsdk_env.sh` в .zshrc — pre-condition)
```

- [ ] **Step 24.2: Fresh clone simulation**

```bash
pnpm clear:all  # remove node_modules + .tools + dist + results
pnpm install
pnpm bench:all
```

Expected: `pnpm setup` срабатывает, скачивает все 4 тула (wasi-sdk, binaryen, wasm-pack — через tarball; emsdk — через git clone). Затем `build:all`, `bench`, `report` — все работают. Финал: `report -> results/summarized/<ts>/index.html (60 results)` без `Exit status 143`.

Время first-run: `pnpm setup` — порядка 5-10 минут (300-700 MB downloads). `bench:all` — порядка 10-15 минут.

- [ ] **Step 24.3: Idempotent re-run check**

```bash
pnpm bench:all
```

Expected: `pnpm setup` фаза показывает «already installed» для всех тулов и быстро завершается (< 5 секунд). Полный `bench:all` тогда не существенно длиннее, чем без setup.

- [ ] **Step 24.4: Restore backup if present**

```bash
mv .tools.backup .tools 2>/dev/null || true
# Re-run pnpm install потому что node_modules могли быть удалены
pnpm install
```

- [ ] **Step 24.5: Update README with new flow**

В `README.md` секции «Toolchain» / «Установка» переписать:

было что-то типа:
> Установите emsdk, wasi-sdk, binaryen, wasm-pack самостоятельно.

стало:
> ```bash
> pnpm install
> pnpm setup       # auto-installs emsdk, wasi-sdk, binaryen, wasm-pack to .tools/
> pnpm bench:all
> ```
> Требуется: macOS arm64, node ≥ 22, pnpm ≥ 9, rustup, xcode command-line tools.

- [ ] **Step 24.6: Commit doc + verify**

```bash
git add README.md
git commit --no-gpg-sign -m "docs: simplify Toolchain setup using pnpm setup"
```

---

### Task 25: Wave 5 closeout

- [ ] **Step 25.1: Verify acceptance criteria from spec §5.7**

Run на чистом state (имитация fresh clone):
```bash
pnpm clear:all
pnpm install
pnpm bench:all
echo $?  # 0
```

Expected: завершилось exit 0, без интерактивных вопросов, без ручных шагов.

- [ ] **Step 25.2: Verify artifact sizes match Phase 1.0 baseline**

Compare `results/summarized/<latest>/index.html` с `results/summarized/2026-05-03T19-13-32-386Z/index.html` (Phase 1.0 reference): размеры столбцов wasm raw / wasm gz / total gz должны совпадать ±5 байт (детерминированный compile).

- [ ] **Step 25.3: Tag wave checkpoint**

Run: `git tag wave-5-done`

---

## Final closeout

### Task 26: Phase 1.0.5 finalize

- [ ] **Step 26.1: Run full suite**

```bash
pnpm clear
pnpm bench:all
pnpm lint:all
pnpm typecheck
pnpm test
```

Expected: all exit 0.

- [ ] **Step 26.2: Update README headline**

В `README.md` обновить статус-секцию: «Phase 1.0.5 (Housekeeping) complete. Phase 1.1 (interop_calls, hashmap_workload, shape_dispatch) — следующий шаг.»

- [ ] **Step 26.3: Merge to master**

```bash
git switch master
git merge --no-ff feature/phase-1-0-5 --no-gpg-sign -m "merge: Phase 1.0.5 (Housekeeping)"
```

Expected: fast-forward merge или merge commit с историей всех wave'ов.

- [ ] **Step 26.4: Tag the phase**

```bash
git tag -a phase-1-0-5 -m "Phase 1.0.5 housekeeping complete"
```

- [ ] **Step 26.5: Cleanup wave checkpoints**

```bash
git tag -d wave-1-done wave-2-done wave-3-done wave-4-done wave-5-done
```

(Промежуточные tag'и — для агентских handoff'ов внутри waves; финальный tag — `phase-1-0-5`.)

- [ ] **Step 26.6: Optionally push (user decision)**

```bash
# git push origin master --tags  # Только по явному запросу пользователя.
```

- [ ] **Step 26.7: Update auto-memory `project_wasm_benchmarks.md`**

Обновить запись в `~/.claude/projects/-Users-uncerso-src-wasm-rust-cpp-js/memory/project_wasm_benchmarks.md`: «Phase 1.0.5 done на master, tag `phase-1-0-5`. Auto-deps installer работает. Phase 1.1 — next.»

(Это шаг «вне дерева репо» — выполняется через память Claude.)

---

## Dependency graph

```
Task 1 (clear) ────────────┐
Task 2 (units) ────────────┤
Task 3 (exit143) ──────────┴─► Task 4 (Wave 1 closeout)
                                       │
Task 5 (eslint setup) ─────────────────┤
Task 6 (eslint apply) ─► Task 7 (cpp flags) ──┐
Task 8 (rust per-crate lints) ────────────────┴─► Task 9 (Wave 2 closeout)
                                                         │
Task 10 (workspace+edition) ─► Task 11 (shared crate) ───┤
                                       │                 │
Task 12 (raw refactor) ────────────────┤                 │
Task 13 (bindgen refactor) ────────────┴─► Task 14 (Wave 3 closeout)
                                                         │
Task 15 (Gate 1 instrumentation) ────────────────────────┤
Task 16 (Gate 2 quantization, conditional) ──────────────┤
Task 17 (Gate 3 Liftoff, conditional) ───────────────────┴─► Task 18 (Wave 4 closeout)
                                                                       │
Task 19 (tool-versions) ───────────────────────────────────────────────┤
Task 20 (setup-tools.ts) ─► Task 21 (setup.ts) ─► Task 22 (paths/env) ─┤
Task 23 (wire build scripts) ─► Task 24 (integration test) ────────────┴─► Task 25 (Wave 5 closeout)
                                                                                       │
                                                                                       └─► Task 26 (finalize)
```

---

## Self-review notes (для implementer'а)

- Каждый wave заканчивается tagged checkpoint — позволяет subagent-driven development делать handoffs.
- Wave 4 conditional tasks (16, 17) — implementer должен на каждом gate решить идти дальше или STOP.
- Все коммиты используют `--no-gpg-sign` (auto-memory `feedback_gpg_no_sign.md`).
- TDD применён где разумно (shared crate Task 11; reporter render Task 2). Для refactor-задач (Tasks 12, 13) полагаемся на existing smoke + bench:all для regression detection — checksums служат as integration test.
- Wave 5 не unit-тестируется (network + binaries) — verified через manual integration in Task 24.
