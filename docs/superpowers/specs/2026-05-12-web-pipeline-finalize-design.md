# Phase 1.0.6 — Web pipeline finalization (design spec)

**Дата:** 2026-05-12
**Статус:** brainstorm complete, awaiting user review
**Ветка для реализации:** `feature/phase-1-0-6` (создаётся от `master`)
**Финальный артефакт:** tag `phase-1-0-6` после merge в `master`

---

## Цель

Закрыть два carry-over'а из Phase 1.0.5 (см. session-state `2026-05-06-wave-4.md`), оба связанные с web-side automation pipeline:

1. **Prod-bundle migration для runner-web** — заменить Vite dev mode на `vite build` + `vite preview` как канонический pipeline. Secondary perf improvement (17-27% для C++ wasm combos под текущим Playwright FF stack), но главное — убираем dual-mode maintenance (single canonical path).

2. **Real-engine automation для FF и Chrome** — заменить Playwright (который поставляет patched Firefox Nightly без Ion JIT, дающий 20-25× artifact в FF wasm numbers) на `selenium-webdriver` с явно pin'ennными production browsers (Firefox stable + Chrome for Testing) через расширение существующей `tool-versions.json` infrastructure.

После landing'а Phase 1.0.6:
- Все 60 кейсов представляют **real production browser engines** (Ion для FF, V8 для Chrome — оба с full optimizing JIT).
- Pipeline single-canonical: prod-build всегда, без dev fallback.
- Pin pattern uniform: каждый browser + driver = entry в `tool-versions.json` с `url` + `sha256`, скачивается в `.tools/` через `pnpm setup-tools`.
- Future Safari (Phase 1.1+) добавляется одним changeset'ом, без архитектурной перестройки.

---

## Контекст и мотивация

Полный rationale для real-engine migration — в `docs/superpowers/notes/2026-05-05-perf-now-precision.md`. Кратко:

- Wave 4 Phase 1.0.5 выяснил, что 20-25× FF wasm slowdown vs Chrome — это **artifact Playwright's patched Firefox Nightly build**, а не свойство SpiderMonkey.
- Manual run в реальном Firefox stable показал ~5 ms для `cpp/emscripten/size M` (vs Playwright FF ~125 ms), полностью эквивалентно Chrome.
- Root cause: в Playwright Nightly **optimizing JIT (Ion) недоступен** — попытка disable baseline через `firefoxUserPrefs` даёт "no WebAssembly compiler available". `executablePath = system Firefox` не работает (Playwright требует Juggler-patched build).
- Playwright BiDi (через который можно было бы драйвить system FF) — экспериментальный в публичном API даже в Playwright 1.59+; `BIDI_FFPATH` есть только во внутреннем test harness, не в consumer API.
- Альтернативы: Puppeteer 23+ (production BiDi для FF, но **нет support'а Safari**, что блокирует наши планы на Phase 1.1+), selenium-webdriver (mature, единый API для FF/Chrome/Safari через geckodriver/chromedriver/safaridriver), raw webdriver-bidi.

Решение: **selenium-webdriver как single framework + explicit browser binaries в `tool-versions.json`**. Aligned с project ethos (wasi-sdk/binaryen pinning) и future-compatible с Safari.

Для prod-bundle migration — context из session-state §A: Wave 4 эксперимент `vite build` + `vite preview` дал measurable improvement (особенно для C++ combos), но больший плюс — уход от dual-mode (dev для smoke/quick, prod для eval) к single path.

---

## Out of scope

- **Cross-platform support.** macOS arm64 only, как и весь остальной `tool-versions.json`. Linux/Windows browsers — Phase 1.1+.
- **Safari implementation.** Архитектурно подготавливаем (selenium-webdriver поддерживает `safaridriver`), но конкретная реализация ветки `safari` env — Phase 1.1+.
- **WebDriver BiDi protocol.** Используем classic WebDriver (W3C). BiDi даёт продвинутые features (network interception, real-time events), не нужные для нашего "open URL, wait result, read result" workflow.
- **Re-architecture worker/harness.** `apps/runner-web/src/worker.ts`, `packages/harness/` — без изменений. Контракт `window.__BENCH_RESULT` сохраняется.
- **CI integration.** GitHub Actions / CI остаётся out of scope (как было в Phase 1.0.5).
- **Performance numbers comparison report.** Полный анализ изменений в numbers (FF до/после) — отдельный артефакт (notes file или README addendum), не часть этого spec'а.

---

## Sequencing — 3 waves

Подход: меньший risk first, larger risk second, finalization third. Если одна из волн падает — backout локальный, без коротания соседней.

| Wave | Scope | Risk | Re-baseline |
|---|---|---|---|
| **1** | Prod-bundle migration | Low — contained, 1 vite config + 1 script | Не требуется (numbers под Playwright stack, проверка sanity) |
| **2** | Real-engine automation (selenium-webdriver + browsers в tool-versions.json) | Medium — новые binaries, driver rewrite | Не требуется (smoke + spot-check) |
| **3** | Combined re-baseline + finalization | Low — bench:all run + report regenerate + docs | **Главный re-baseline** |

Каждая волна закрывается до старта следующей. Tags: `phase-1-0-6-wave-1`, `phase-1-0-6-wave-2`, `phase-1-0-6` (final).

---

## Wave 1 — Prod-bundle migration

Цель: канонический pipeline для runner-web — всегда `vite build` → `vite preview`. Dev-режим убирается из bench/smoke pipeline (остаётся как `pnpm dev` для manual debugging).

### 1.1 Изменения в `apps/runner-web/vite.config.ts`

- **Explicit `build.outDir`**: `resolve(__dirname, "dist")` (= `apps/runner-web/dist`). Чёткое разделение runner-web bundle vs repo `/dist/` (где benchmark artifacts).
- **`build.copyPublicDir = false`**: не копировать 60+ benchmark artifacts из repo `/dist/` в `apps/runner-web/dist/` при каждом build. Избегаем дублирования и waste'а времени.
- **Custom Vite plugin для preview** — добавляет middleware, обслуживающее `repo/dist/` через preview server. Сохраняет URL contract: `/dist/<benchmark>/<artifact>` resolveится на benchmark artifacts. Реализация — через `sirv` (mature static-file serving npm package) либо встроенным Node `fs.createReadStream` в connect middleware. ~15 строк плагина + 1 devDep (`sirv`).
- **`server.headers` (dev) можно убрать** — dev pipeline уходит. Но безопаснее **оставить** для consistency, если кто-то делает `pnpm dev` для interactive debugging — пусть COI тоже работает.
- **`preview.headers` (COI)** — без изменений (закоммичен `0466c51` в Phase 1.0.5).
- **`worker.format: "es"`** — без изменений.

### 1.2 Изменения в `scripts/run-matrix.ts`

Текущий fragment (lines ~65-117) launches `vite` в dev mode:
```ts
serverProc = execa(viteBin, [], { cwd: "apps/runner-web", stdio: "inherit", detached: true });
```

Новая логика:
1. **До запуска benchmark цикла** — синхронный build:
   ```ts
   await execa(viteBin, ["build"], { cwd: "apps/runner-web", stdio: "inherit" });
   ```
   Занимает ~1-3s. Negligible vs smoke ~30s или eval ~1h.

2. **Launch preview** вместо dev:
   ```ts
   serverProc = execa(viteBin, ["preview", "--port=5174", "--strictPort"], {
       cwd: "apps/runner-web", stdio: "inherit", detached: true,
   });
   ```

3. **`waitForServer`** — без изменений (тот же port 5174).
4. **Cleanup** (SIGTERM process group) — без изменений.

### 1.3 Изменения в `apps/runner-web/package.json`

- `"dev": "vite"` — **оставляем** для manual debugging convenience (per session-state §C).
- `"build": "vite build"` — уже есть.
- `"preview": "vite preview"` — **добавить** (удобство standalone use).
- `"sirv"` (или эквивалент) — в `devDependencies`.

### 1.4 Sanity-checks Wave 1

- `pnpm smoke` зелёный на новом setup.
- `pnpm bench --envs=firefox --sizes=M --mode=quick` для `cpp/emscripten/size`: numbers близки к Wave 4 prod measurements (~104 ms для FF под Playwright). Sanity: prod-bundle effect воспроизводится.
- `pnpm bench:all` — 60 кейсов проходят validation (S=8505.752465030815, M=275996.81878375803). Numbers пока **под Playwright stack** — Wave 2 поменяет engines.
- Не требуется обновлять `dist/results/` или `report.html` в Wave 1 — это сделает Wave 3.

### 1.5 Wave 1 deliverable

Atomic commit (или 2-3 связанных коммита, если так удобнее):
- `apps/runner-web/vite.config.ts` updated.
- `scripts/run-matrix.ts` updated.
- `apps/runner-web/package.json` updated (preview script + sirv).
- Tag: `phase-1-0-6-wave-1`.

---

## Wave 2 — Real-engine automation

Цель: заменить `@playwright/test` на `selenium-webdriver`, добавить explicit Firefox + Chrome for Testing + drivers в `tool-versions.json`, переписать `apps/runner-web/src/driver.ts`.

### 2.1 Архитектура

**Компоненты:**

- **Browser binaries** (downloaded by `pnpm setup-tools`, новые entries в `tool-versions.json` `browsers` секции):
  - Firefox stable (Mozilla archives, DMG)
  - Chrome for Testing (Google's pinnable Chrome bundle, ZIP, включает chromedriver)
- **Drivers** (downloaded by `pnpm setup-tools`):
  - geckodriver (Mozilla GitHub releases, tar.gz)
  - chromedriver — приходит вместе с Chrome for Testing bundle (Google гарантирует matching version)
- **Framework**: `selenium-webdriver` npm package (W3C classic WebDriver mode, не BiDi), pin в `apps/runner-web/package.json`.
- **Driver code**: `apps/runner-web/src/driver.ts` rewrite.

**Не меняется:**
- Vite preview pipeline (landed в Wave 1), COI headers, worker, harness, schema.
- `scripts/run-matrix.ts` snowmobile cycle (driver invocation CLI тот же).
- `apps/runner-web/index.html` (с одним minor дополнением для diagnostic logs — см. §2.4).

### 2.2 Расширение `tool-versions.json`

Добавляем новую top-level секцию `browsers` рядом с `tools`:

```jsonc
{
    "tools": { /* unchanged */ },
    "browsers": {
        "firefox": {
            "version": "<LATEST_STABLE>",
            "url": "https://ftp.mozilla.org/pub/firefox/releases/<ver>/mac/en-US/Firefox%20<ver>.dmg",
            "sha256": "<from SHA256SUMS at https://ftp.mozilla.org/pub/firefox/releases/<ver>/SHA256SUMS>",
            "appPath": "Firefox.app",
            "binaryInApp": "Contents/MacOS/firefox"
        },
        "geckodriver": {
            "version": "<LATEST_STABLE>",
            "url": "https://github.com/mozilla/geckodriver/releases/download/v<ver>/geckodriver-v<ver>-macos-aarch64.tar.gz",
            "sha256": "<from release notes>"
        },
        "chrome-for-testing": {
            "version": "<LATEST_STABLE>",
            "channel": "stable",
            "chromeUrl": "https://storage.googleapis.com/chrome-for-testing-public/<ver>/mac-arm64/chrome-mac-arm64.zip",
            "chromeSha256": "<from manifest>",
            "chromedriverUrl": "https://storage.googleapis.com/chrome-for-testing-public/<ver>/mac-arm64/chromedriver-mac-arm64.zip",
            "chromedriverSha256": "<from manifest>",
            "appPath": "chrome-mac-arm64/Google Chrome for Testing.app",
            "binaryInApp": "Contents/MacOS/Google Chrome for Testing",
            "chromedriverBinaryPath": "chromedriver-mac-arm64/chromedriver"
        }
    }
}
```

**Версии:** конкретные `<ver>` placeholder'ы. При имплементации:
- Firefox: latest stable на момент работы (на 2026-05 — 138.x, актуально проверить mozilla.org).
- geckodriver: latest stable (на 2026-05 — 0.36.x).
- Chrome for Testing: latest stable, **строго stable channel**, не canary/dev/beta. Manifest URL для discovery: `https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json`.

**Sha256:** для всех браузеров и драйверов берём из upstream-публикуемых checksum'ов (Mozilla SHA256SUMS, geckodriver release notes, Chrome for Testing JSON manifest содержит sha256-equivalent поле). Не вычисляем сами после download (anti-pattern — теряется integrity guarantee).

**Логика разделения firefox/geckodriver:**
- Они pinятся независимо: один geckodriver обычно поддерживает несколько FF релизов, мы можем bumpить FF без bumping geckodriver и наоборот.
- Chrome + chromedriver — единый bundle, один version field управляет обоими (Google гарантирует pairing).

### 2.3 Setup flow — расширение `scripts/lib/setup-tools.ts`

Добавляем три новые функции параллельно существующим `ensureTarball` / `ensureEmsdk` / `ensureWasmPackViaCargo`:

#### `ensureFirefox(spec)` — handling DMG

```
1. curl -fsSL --retry 5 ... <url> -o .tools/firefox.download.dmg
2. sha256 verify против spec.sha256
3. hdiutil attach -nobrowse -mountpoint <tmpdir> firefox.download.dmg
4. mkdir -p .tools/firefox-<ver>
5. cp -R <tmpdir>/Firefox.app .tools/firefox-<ver>/
6. hdiutil detach <tmpdir>
7. xattr -d com.apple.quarantine -r .tools/firefox-<ver>/Firefox.app  (macOS Gatekeeper bypass для downloaded app)
8. Verify .tools/firefox-<ver>/Firefox.app/Contents/MacOS/firefox exists и executable
9. Remove .tools/firefox.download.dmg
10. Update state.json: firefox = <ver>
```

Атомарность: target removed перед extract, state не апдейтится до verify. Если что-то падает — target в незавершённом состоянии, следующий run переустановит.

#### `ensureGeckodriver(spec)` — reuse `ensureTarball`

Тот же формат `.tar.gz`, что и binaryen/wasi-sdk. Просто другая `renameTo` папка (`geckodriver-<ver>`). Verify `<target>/geckodriver` executable. `xattr -d` не нужен для CLI binary.

#### `ensureChromeForTesting(spec)` — handling ZIP

```
1. curl ZIP-chrome → .tools/chrome.download.zip, sha256 verify
2. curl ZIP-chromedriver → .tools/chromedriver.download.zip, sha256 verify
3. mkdir -p .tools/chrome-<ver>
4. unzip -q .tools/chrome.download.zip -d .tools/chrome-<ver>/
5. unzip -q .tools/chromedriver.download.zip -d .tools/chrome-<ver>/
6. xattr -d com.apple.quarantine -r .tools/chrome-<ver>/.../Google\ Chrome\ for\ Testing.app
7. Verify оба binary paths existence + executability
8. Remove download files
9. Update state.json: chrome-for-testing = <ver>
```

Single `state.json` entry — управляет обоими (chrome + chromedriver всегда одной версии).

#### Вызовы в `scripts/setup.ts`

```diff
-    await ensurePlaywrightBrowsers();
+    await ensureFirefox({ ...manifest.browsers.firefox });
+    await ensureGeckodriver({ ...manifest.browsers.geckodriver });
+    await ensureChromeForTesting({ ...manifest.browsers["chrome-for-testing"] });
```

Парсинг manifest расширяется новой `browsers` секцией (новый TS interface для type safety).

**Cleanup старых версий:** не делаем gc автоматически (consistent с текущим поведением для wasi-sdk/binaryen — старые `.tools/wasi-sdk-24/` могут оставаться, пользователь делает `pnpm clear:all`).

### 2.4 Driver rewrite — `apps/runner-web/src/driver.ts`

Полный rewrite под `selenium-webdriver` (W3C classic mode). API surface маленький: launch → goto → wait → evaluate → quit.

#### Обнаружение путей к бинарникам — `apps/runner-web/src/browser-paths.ts` (новый файл)

Утилита читает `tool-versions.json` (из repo root) и возвращает абсолютные paths:
```ts
export interface BrowserPaths {
    firefoxBinary: string;
    geckodriver: string;
    chromeBinary: string;
    chromedriver: string;
}
export async function getBrowserPaths(repoRoot: string): Promise<BrowserPaths> { ... }
```
Если binary не существует по expected path → throw с подсказкой "run `pnpm setup-tools`". Fail-fast.

#### Структура driver.ts

```ts
import { Builder, type WebDriver } from "selenium-webdriver";
import * as firefox from "selenium-webdriver/firefox";
import * as chrome from "selenium-webdriver/chrome";
import { getBrowserPaths } from "./browser-paths.js";

async function launchBrowser(env: "firefox" | "chromium", repoRoot: string): Promise<WebDriver> {
    const paths = await getBrowserPaths(repoRoot);
    if (env === "firefox") {
        const opts = new firefox.Options();
        opts.setBinary(paths.firefoxBinary);
        opts.addArguments("--headless");
        // Prefs to suppress first-run UI, auto-update, telemetry
        opts.setPreference("app.update.auto", false);
        opts.setPreference("app.update.enabled", false);
        opts.setPreference("toolkit.telemetry.reportingpolicy.firstRun", false);
        opts.setPreference("browser.shell.checkDefaultBrowser", false);
        opts.setPreference("datareporting.policy.firstRunURL", "");
        return new Builder()
            .forBrowser("firefox")
            .setFirefoxOptions(opts)
            .setFirefoxService(new firefox.ServiceBuilder(paths.geckodriver))
            .build();
    }
    const opts = new chrome.Options();
    opts.setChromeBinaryPath(paths.chromeBinary);
    opts.addArguments(
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
        "--disable-features=Translate",
    );
    return new Builder()
        .forBrowser("chrome")
        .setChromeOptions(opts)
        .setChromeService(new chrome.ServiceBuilder(paths.chromedriver))
        .build();
}
```

#### Wait/evaluate (заменяет `page.waitForFunction` + `page.evaluate`)

```ts
await driver.get(url);
const timeoutMs = 5 * 60 * 1000;
await driver.wait(async () => {
    return await driver.executeScript<boolean>(
        "return (window).__BENCH_RESULT !== undefined;",
    );
}, timeoutMs);
const raw = await driver.executeScript<unknown>(
    "return (window).__BENCH_RESULT;",
);
```

#### BENCH_DEBUG_TIMINGS=1

`?debug=1` URL param уже поддерживается на стороне worker'а (per Wave 4 changes). Driver просто добавляет `&debug=1` к URL, если env var выставлен:
```ts
const debug = process.env["BENCH_DEBUG_TIMINGS"] === "1" ? "&debug=1" : "";
const url = `${baseUrl}/?case=${encodeURIComponent(caseParam)}${debug}`;
```
Никакого `addInitScript`-аналога не нужно.

#### Diagnostic console/error capture

В Selenium classic нет cross-browser console event'ов (geckodriver не поддерживает `logs()` API, chromedriver поддерживает, но непортируемо).

Решение — minor дополнение к `apps/runner-web/index.html` или к bootstrap-скрипту (`src/main.ts` если есть, иначе inline в index.html `<script>`):

```html
<script>
window.__BENCH_LOGS = [];
window.addEventListener("error", (e) => {
    window.__BENCH_LOGS.push({ type: "error", msg: e.message, stack: e.error?.stack });
});
window.addEventListener("unhandledrejection", (e) => {
    window.__BENCH_LOGS.push({ type: "unhandledrejection", reason: String(e.reason) });
});
// Optional: hook console.error/warn если хотим diagnostic forwarding
</script>
```

Driver после `driver.wait(...)` (или в catch при timeout) читает:
```ts
const logs = await driver.executeScript<unknown[]>(
    "return (window).__BENCH_LOGS || [];",
);
for (const log of logs) console.error("[browser]", log);
```

Не теряем диагностику, +5-10 строк в bootstrap.

#### Process cleanup

`driver.quit()` корректно отрабатывает geckodriver/chromedriver subprocess'ы. Не нужны manual kill (в отличие от Vite preview process'а в `run-matrix.ts`).

#### CLI interface unchanged

`parseCli`, args (`--benchmark=`, `--language=`, etc.), output path — без изменений. `scripts/run-matrix.ts` driver invocation тот же.

### 2.5 Package.json swap — `apps/runner-web/package.json`

```diff
-    "@playwright/test": "^1.50.0",
+    "selenium-webdriver": "~4.27.0",
+    "@types/selenium-webdriver": "~4.1.0",
```

Pin to minor version (`~`, не `^`) — selenium-webdriver mature, но breaking-in-minor исторически случались. Конкретные patch версии — placeholder; при имплементации lock latest stable.

### 2.6 Sanity-checks Wave 2

1. `pnpm setup-tools` идемпотентен (повторный запуск skip'ит уже установленные browsers).
2. `pnpm setup-tools` после `pnpm clear:all` устанавливает всё заново.
3. `pnpm smoke` зелёный.
4. `pnpm bench --envs=firefox --sizes=M --mode=quick` для `cpp/emscripten/size`: numbers в range 4-7 ms (sanity vs manual real-FF runs).
5. `pnpm bench --envs=chromium --sizes=M --mode=quick`: numbers в пределах ±5% от Phase 1.0.5 baseline (sanity: Chrome for Testing + prod bundle ≡ Playwright Chromium + dev для wasm; prod-bundle effect на Chrome ~0% per Wave 4).
6. Manual cross-check: запустить тот же downloaded FF binary manually через `?debug=1` URL → compare numbers. Если selenium-imposed prefs ломают JIT — fix.

### 2.7 Wave 2 deliverable

- `tool-versions.json` — новая `browsers` секция.
- `scripts/setup.ts`, `scripts/lib/setup-tools.ts` — новые функции `ensureFirefox`, `ensureGeckodriver`, `ensureChromeForTesting`; убран `ensurePlaywrightBrowsers`.
- `apps/runner-web/src/driver.ts` — full rewrite.
- `apps/runner-web/src/browser-paths.ts` — новый файл.
- `apps/runner-web/index.html` (или bootstrap) — добавлены `__BENCH_LOGS` capture hooks.
- `apps/runner-web/package.json` — swap dependency.
- `scripts/clear.ts` — optional cleanup: убрать `apps/runner-web/test-results` и `apps/runner-web/playwright-report` из `ALWAYS_PATHS` (Playwright artifacts больше не создаются). Не критично.
- Tag: `phase-1-0-6-wave-2`.

---

## Wave 3 — Combined re-baseline + finalization

Цель: пересчитать все Phase 1.0 numbers под finalным setup (prod-bundle + real engines), обновить артефакты, закрыть phase.

### 3.1 Re-baseline run

```bash
pnpm clear           # удалить старые dist/, results/
pnpm bench:all       # = setup-tools + build:all + bench --mode=eval + report
```

`bench:all` — full sweep всех 60 кейсов, ~1 час под прежним setup. После Wave 2 cycle time может измениться (вероятно сократится, потому что FF cases теперь 5ms а не 125ms).

### 3.2 Артефакты, генерируемые run'ом

- `results/raw/<new-timestamp>/` — raw JSON results 60 кейсов.
- `dist/results/` (aggregated) — генерится `pnpm report`.
- `report.html` — генерится `pnpm report`.

Перед commit'ом: review numbers, sanity check (см. §3.4).

### 3.3 Документация

**README** обновляется:
- Убирается секция "Известные ограничения" про FF wasm artifact (Phase 1.0.5 disclaimer больше не нужен).
- Добавляется секция "Browser versions" со ссылкой на `tool-versions.json` browsers section.
- Раздел про `pnpm dev` (apps/runner-web manual debugging) — без изменений или slightly обновляется.

**Notes file** — опционально: `docs/superpowers/notes/2026-05-12-phase-1-0-6-rebaseline.md` с before/after table канонических кейсов:

| combo | env | Phase 1.0.5 (Playwright dev) | Phase 1.0.6 (Selenium prod) | delta |
|---|---|---|---|---|
| cpp/emscripten/size | firefox M | ~125 ms | ~5 ms expected | ~25× faster (artifact removed) |
| cpp/wasi-sdk/speed | firefox M | ~97 ms | ~5 ms expected | ~19× faster |
| cpp/emscripten/size | chromium M | ~5 ms | ~5 ms expected | unchanged |
| js/typed-array/speed | firefox M | ~13 ms | ~13 ms expected | unchanged |
| rust/raw/speed | firefox M | ~130 ms | ~5 ms expected | ~26× faster |

(Точные numbers — заполняются по факту bench:all.)

### 3.4 Success criteria

1. **Все 60 кейсов** проходят checksum validation: `S = 8505.752465030815`, `M = 275996.81878375803`. Это invariant — ничего в numerical algorithm не меняется.
2. **FF wasm combos**: same order of magnitude как Chrome (нет 20× gap'а). Конкретный target: FF `cpp/emscripten/size M` в range 4-7 ms.
3. **Chrome numbers**: в пределах ±5% от Phase 1.0.5 baseline (sanity check — Chrome for Testing ≡ Playwright Chromium для wasm).
4. **JS combos** (FF и Chrome): без significant изменения (JS path не зависит от wasm tier'ов, и prod-bundle effect там был ~0%).
5. **`pnpm setup-tools` идемпотентен** на fresh checkout и на existing `.tools/`.
6. **`pnpm clear:all` + `pnpm setup-tools`** — clean full reinstall работает.
7. **`pnpm smoke`** зелёный на каждом из waves 1, 2, 3.

### 3.5 Wave 3 deliverable

- Updated `dist/results/`, `report.html` под finalным setup.
- Updated README.
- Optional notes file с before/after.
- Tag: `phase-1-0-6` (final).

---

## Future Safari (placeholder, не имплементируется в этой фазе)

Архитектура подготовлена. Когда придёт момент:

1. **Driver:** в `apps/runner-web/src/driver.ts` добавляется ветка:
   ```ts
   else if (env === "webkit" || env === "safari") {
       const opts = new safari.Options();
       return new Builder().forBrowser("safari").setSafariOptions(opts).build();
   }
   ```
2. **safaridriver** — system binary `/usr/bin/safaridriver`. Один раз `sudo safaridriver --enable` на машине.
3. **`tool-versions.json` `browsers` section** — ничего добавлять (system driver, version implicit от macOS).
4. **`scripts/run-matrix.ts`** — добавляется `"safari"` (или `"webkit"`) в `ALL_ENVS`.
5. **Re-baseline** — отдельный mini-cycle, не requires phase boundary.

Если на тот момент нужен будет Safari Technology Preview (newer WebKit): downloadable DMG, тот же `ensureFirefox`-like flow в `setup-tools.ts`, новый entry в `browsers` (`safari-tp`).

---

## Risk матрица

| Risk | Wave | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Vite preview не serveит publicDir с `copyPublicDir=false` без custom plugin | 1 | Medium | Medium | Plugin path — primary. Fallback: `copyPublicDir=true` (дублирование, но работает). Verify в первые часы Wave 1. |
| `vite build` ломает что-то в worker dynamic imports | 1 | Low | Medium | Smoke test catches. Source maps inline для debugging. |
| Firefox auto-update пытается обновиться при launch | 2 | Medium | High (numbers становятся nondeterministic) | Prefs `app.update.auto=false`, `app.update.enabled=false` в `firefox.Options`. Selenium создаёт ephemeral profile, prefs передаются через API. |
| Firefox first-run dialogs / telemetry prompt | 2 | Medium | Medium (тайм-аут на bench) | Prefs `toolkit.telemetry.reportingpolicy.firstRun=false`, `browser.shell.checkDefaultBrowser=false`, plus `--headless`. |
| Chrome first-run / signin / default browser prompts | 2 | Low | Medium | Flags `--no-first-run`, `--no-default-browser-check`, `--disable-default-apps`. |
| macOS Gatekeeper блокирует downloaded `.app` | 2 | Medium | High (browser не launch'ится) | `xattr -d com.apple.quarantine -r <path>` после extract; verify в setup. |
| Selenium-imposed prefs ломают JIT (повтор Playwright проблемы) | 2 | Low | Critical (повторение исходной проблемы) | Manual verification рано: тот же downloaded FF binary запускается manually + через selenium на одном и том же бенчмарке → cross-check numbers совпадают. Если расхождение — investigate какие prefs Selenium auto-sets. |
| Chrome for Testing manifest URL изменяется или version disappears | 2 | Low | Low | Google maintains stable JSON-manifest с 2023. sha256 в `tool-versions.json` — invariant snapshot. Если URL ломается, мы знаем сразу при `setup-tools` (404 fail). |
| selenium-webdriver npm 4.x breaking changes в minor releases | 2 | Low | Low | Pin `~4.27.0` (только patch flow). Pnpm lockfile фиксирует exact. |
| DMG mount fails (macOS issue) | 2 | Low | Critical | `hdiutil` standard в macOS. Если падает — system-level issue, не наша проблема. Fail-fast с сообщением. |
| Re-baseline numbers неожиданно расходятся с manual-run expectations | 3 | Low | High | Sanity check Wave 2 step 6 catches это раньше. В случае расхождения — debug через `?debug=1` + manual run на том же binary. |

---

## Open questions / Decision log

Решено в brainstorm sessions:

| Решение | Обоснование |
|---|---|
| Single framework (selenium-webdriver), не hybrid | Per user input — избегаем "two frameworks side-by-side". |
| Explicit binaries в `tool-versions.json`, не library-managed | Aligned с rest of project ethos (wasi-sdk/binaryen pinning). Полный контроль над exact version. |
| Atomic switch обоих browsers (FF + Chrome), не FF-only | Per user input — single framework state с day 1. Избегаем transitional dual-framework period. |
| Always prod-bundle, без dev fallback в pipeline | Per user input — не поддерживаем dual-mode. `pnpm dev` остаётся как manual convenience. |
| Prod-bundle before real-engine (Wave 1 → Wave 2) | Per user input — smaller blast radius first. Если prod-bundle вводит subtle issue, ловим до browser switch. |
| Classic WebDriver, не BiDi | Минимальный API surface достаточен для "open URL, wait, read". BiDi features не нужны. |
| Не deferred — Safari только архитектурно подготовлен, имплементация Phase 1.1+ | Не overengineer. Selenium supports — future change minimal. |
| Версии (FF, geckodriver, Chrome for Testing) — placeholder'ы, latest stable при имплементации | Конкретный pin делается в момент имплементации (точный URL + sha256 из upstream). |

Open (на момент написания, не блокирует start):

- Точные версии Firefox / geckodriver / Chrome for Testing на момент имплементации. Resolve'ятся первой задачей Wave 2 (lookup latest stable + sha256).
- Vite plugin для preview-serving publicDir — sirv vs custom Connect middleware vs встроенное Vite API. Resolve в первой задаче Wave 1 (smallest working solution).
- Бутстрап `__BENCH_LOGS` capture — в `index.html` inline `<script>` vs в `src/main.ts`. Resolve по структуре существующего `index.html` (read during implementation).

---

## Чтение перед стартом сессии (порядок)

1. **Этот файл** — primary design.
2. `docs/superpowers/session-state-2026-05-06-wave-4.md` — context, открытые задачи на момент Wave 4 closeout.
3. `docs/superpowers/notes/2026-05-05-perf-now-precision.md` — root cause analysis FF artifact'а (главное для понимания, почему делаем real-engine migration).
4. `docs/superpowers/specs/2026-05-04-housekeeping-design.md` — общий housekeeping spec для Phase 1.0.5 (контекст всего проекта).
5. `tool-versions.json` — текущая schema для tools, к которой добавится `browsers` секция.

---

## Stop point

После landing'а `phase-1-0-6` tag в `master`:
- Phase 1.0.6 closed.
- Web pipeline стабильный, single canonical, real engines.
- Готовность к Phase 1.1 (новые workloads + Safari implementation).
