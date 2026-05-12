# Phase 1.0.6 — Web pipeline finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть два carry-over'а из Phase 1.0.5 в одном phase'е: (1) prod-bundle pipeline для runner-web вместо Vite dev, (2) replace Playwright stack на selenium-webdriver + Firefox stable + Chrome for Testing pinned через `tool-versions.json`. Re-baseline всех 60 кейсов под real production engines.

**Architecture:** Три sequential wave'а. Wave 1 — prod-bundle (low risk, contained). Wave 2 — real-engine automation (medium risk, larger changeset). Wave 3 — re-baseline + finalization. Каждая wave закрывается до старта следующей. Tag `phase-1-0-6` в финале.

**Tech Stack:** TypeScript (tsx, esbuild, vite 6+), selenium-webdriver 4.x (W3C classic mode), Firefox stable (Mozilla archives, DMG), Chrome for Testing stable (Google JSON manifest, ZIP), geckodriver (Mozilla GitHub releases, tar.gz), sirv (для preview public-dir middleware), execa, hdiutil (macOS DMG mount).

**Spec:** `docs/superpowers/specs/2026-05-12-web-pipeline-finalize-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `apps/runner-web/src/browser-paths.ts` | Wave 2: utility to resolve absolute paths to Firefox/Chrome binaries и chromedriver/geckodriver из `tool-versions.json` + verify existence |
| `docs/superpowers/notes/2026-05-12-phase-1-0-6-rebaseline.md` (optional) | Wave 3: before/after numbers table |

### Modified files

| Path | What changes |
|---|---|
| `apps/runner-web/vite.config.ts` | Wave 1: explicit `build.outDir`, `build.copyPublicDir=false`, custom preview-middleware plugin (sirv) для serving `repo/dist` |
| `apps/runner-web/package.json` | Wave 1: добавить `"preview"` script + `sirv` devDep. Wave 2: replace `@playwright/test` → `selenium-webdriver` + `@types/selenium-webdriver` |
| `apps/runner-web/src/page.ts` | Wave 2: добавить `window.__BENCH_LOGS` capture hooks (error + unhandledrejection) |
| `apps/runner-web/src/driver.ts` | Wave 2: full rewrite на selenium-webdriver (W3C classic) — launch FF/Chrome через downloaded binaries + geckodriver/chromedriver, navigate, wait for `__BENCH_RESULT`, read logs |
| `scripts/run-matrix.ts` | Wave 1: до launch'а server'а делать `vite build`, launch `vite preview` вместо `vite` dev |
| `scripts/setup.ts` | Wave 2: добавить вызовы новых `ensureFirefox`/`ensureGeckodriver`/`ensureChromeForTesting`; убрать `ensurePlaywrightBrowsers` |
| `scripts/lib/setup-tools.ts` | Wave 2: добавить функции `ensureFirefox` (DMG), `ensureGeckodriver` (reuse tarball pattern), `ensureChromeForTesting` (ZIP + paired chromedriver); убрать `ensurePlaywrightBrowsers` |
| `tool-versions.json` | Wave 2: добавить top-level секцию `browsers` с entry для `firefox`, `geckodriver`, `chrome-for-testing` (url + sha256 + path metadata) |
| `scripts/clear.ts` | Wave 2 (optional): удалить `apps/runner-web/test-results`, `apps/runner-web/playwright-report` из `ALWAYS_PATHS` |
| `dist/results/`, `report.html` | Wave 3: regenerate под finalным setup |
| `README.md` | Wave 3: убрать FF artifact disclaimer, добавить browser-versions reference |

### Deleted files

Никаких удалений — только модификации.

---

## Setup — branch и spec/plan commit

- [ ] **Step 0.1: Confirm clean working tree on master**

Run: `git status`
Expected: `On branch master, nothing to commit, working tree clean` (за исключением spec/plan markdown — этого файла и spec'а, которые уже закоммичены отдельно — и `chrome-console.txt`/`firefox-console.txt`/`Какие есть...md` untracked, их игнорируем).

- [ ] **Step 0.2: Create feature branch**

Run: `git switch -c feature/phase-1-0-6`
Expected: `Switched to a new branch 'feature/phase-1-0-6'`.

- [ ] **Step 0.3: Commit plan**

```bash
git add docs/superpowers/plans/2026-05-12-web-pipeline-finalize.md
git commit --no-gpg-sign -m "docs(plan): Phase 1.0.6 web pipeline finalization plan"
```

Expected: коммит создан. `--no-gpg-sign` обязателен для агентских коммитов в этом репо (см. memory).

Spec уже закоммичен в master отдельным коммитом `08095ae` — он merges автоматически через master history.

---

## Wave 1 — Prod-bundle migration

### Task 1: Install sirv dep

**Files:**
- Modify: `apps/runner-web/package.json`

- [ ] **Step 1.1: Add sirv to devDependencies**

В `apps/runner-web/package.json` добавить `"sirv": "^3.0.0"` (или latest stable patch на момент имплементации) в `devDependencies`:

```json
"devDependencies": {
    "@playwright/test": "^1.50.0",
    "sirv": "^3.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.3",
    "vite": "^6.0.0"
}
```

(Selenium swap делаем в Wave 2 — пока Playwright остаётся.)

- [ ] **Step 1.2: pnpm install**

Run: `pnpm install`
Expected: sirv добавлен в `apps/runner-web/node_modules` + обновлён `pnpm-lock.yaml`. Никаких ошибок.

- [ ] **Step 1.3: Verify sirv import**

Run: `node -e "import('sirv').then(m => console.log(typeof m.default))" --input-type=module` из `apps/runner-web/`.
Expected: `function` (sirv export'ит function as default).

### Task 2: Update vite.config.ts — outDir, copyPublicDir, preview plugin

**Files:**
- Modify: `apps/runner-web/vite.config.ts`

- [ ] **Step 2.1: Add explicit build.outDir и copyPublicDir=false**

В `apps/runner-web/vite.config.ts` обновить `build` block:

```ts
build: {
    target: "es2022",
    outDir: resolve(__dirname, "dist"),
    copyPublicDir: false,
    emptyOutDir: true,
},
```

`emptyOutDir: true` — вычистит старые build artifacts при rebuild'е. Безопасно потому что outDir эксплицитно `apps/runner-web/dist`, а не repo root.

- [ ] **Step 2.2: Add preview-serve-publicdir plugin**

В `apps/runner-web/vite.config.ts` добавить import sirv в начало и плагин:

```ts
import { defineConfig, type PluginOption } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sirv from "sirv";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function servePublicDirInPreview(publicDirPath: string): PluginOption {
    return {
        name: "serve-public-dir-in-preview",
        configurePreviewServer(server) {
            server.middlewares.use(sirv(publicDirPath, { dev: true, etag: true }));
        },
    };
}

export default defineConfig({
    root: __dirname,
    publicDir: resolve(__dirname, "../../dist"),
    plugins: [servePublicDirInPreview(resolve(__dirname, "../../dist"))],
    // ... остальной конфиг ниже
});
```

`sirv({ dev: true })` — не кеширует aggressively (мы хотим always-fresh artifacts), `etag: true` — нормальная HTTP etag для conditional reqs.

- [ ] **Step 2.3: Verify config syntax**

Run: `pnpm --filter @bench-app/runner-web typecheck`
Expected: no errors. Если sirv types отсутствуют — `pnpm add -D @types/sirv` (хотя sirv 3+ ships own types, обычно не нужно).

- [ ] **Step 2.4: Add preview script in package.json**

В `apps/runner-web/package.json` `scripts`:

```json
"scripts": {
    "typecheck": "tsc --noEmit",
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "drive": "tsx src/driver.ts"
},
```

- [ ] **Step 2.5: Manual smoke — build + preview + curl benchmark artifact**

Run в terminal 1:
```bash
cd apps/runner-web && pnpm build
```
Expected: build completes successfully, `apps/runner-web/dist/index.html` существует. **Не должно** быть копий `matmul/cpp-emscripten-size/` в `apps/runner-web/dist/` (это means copyPublicDir=false работает).

Run в terminal 1:
```bash
pnpm preview --port=5174 &
sleep 2
```

Run в terminal 2:
```bash
# Verify HTML serves
curl -sf http://localhost:5174/ | head -3
# Verify benchmark artifact serves через preview middleware
curl -sfI http://localhost:5174/matmul/cpp-emscripten-size/manifest.json
```
Expected: HTML head ok; manifest.json returns 200 OK (sirv middleware рулит).

Cleanup: `kill %1` (preview server).

- [ ] **Step 2.6: Commit vite.config + preview script**

```bash
git add apps/runner-web/vite.config.ts apps/runner-web/package.json pnpm-lock.yaml
git commit --no-gpg-sign -m "feat(runner-web): prod-bundle support via vite preview + sirv middleware"
```

### Task 3: Update run-matrix.ts — build before launch, preview instead of dev

**Files:**
- Modify: `scripts/run-matrix.ts`

- [ ] **Step 3.1: Replace dev-launch с build + preview**

В `scripts/run-matrix.ts` найти block (~lines 60-77) с launch'ом сервера и заменить:

```ts
async function main() {
    const args = parseArgs(process.argv.slice(2));
    await mkdir(args.out, { recursive: true });

    const needWebServer = args.envs.some((e) => e !== "node");
    let serverProc: ResultPromise | null = null;
    if (needWebServer) {
        const viteBin = resolve("apps/runner-web/node_modules/.bin/vite");
        // Wave 1 Phase 1.0.6: prod-bundle. Build synchronously, then launch preview.
        console.log("[run-matrix] building runner-web for preview...");
        await execa(viteBin, ["build"], {
            cwd: "apps/runner-web",
            stdio: "inherit",
        });
        console.log("[run-matrix] launching vite preview...");
        serverProc = execa(viteBin, ["preview", "--port=5174", "--strictPort"], {
            cwd: "apps/runner-web",
            stdio: "inherit",
            detached: true,
        });
        // Detach the unhandled rejection: when we SIGTERM the process the promise
        // rejects, but we want to swallow that and only surface real failures.
        serverProc.catch(() => { /* expected on shutdown */ });
        await waitForServer("http://localhost:5174/");
    }
    // ... rest unchanged
```

- [ ] **Step 3.2: Verify TS typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3.3: Smoke test**

Run: `pnpm smoke`
Expected: passes. `[run-matrix] building runner-web...` в логах. Затем `[run-matrix] launching vite preview...`. Все smoke cases checksums validated.

- [ ] **Step 3.4: Quick bench FF M cpp/emscripten/size — sanity vs Wave 4 prod numbers**

Run: `pnpm bench --envs=firefox --sizes=M --mode=quick --out=/tmp/p106-wave1-ff`
Expected: passes. Сheck `/tmp/p106-wave1-ff/matmul__cpp-emscripten-size__M__firefox.json` → `quality.samples` mean ~100-110 ms (Wave 4 prod measurement showed 104 ms для FF dev artifact + prod bundle).

Если numbers >120 ms или <90 ms — что-то сломалось в prod-bundle pipeline, debug.

- [ ] **Step 3.5: Commit run-matrix changes**

```bash
git add scripts/run-matrix.ts
git commit --no-gpg-sign -m "feat(run-matrix): use vite build + preview instead of dev server"
```

### Task 4: Full validation — bench:all under Wave 1 stack

- [ ] **Step 4.1: Full bench:all run**

Run: `pnpm bench:all`
Expected: ~1 hour. 60 кейсов all pass validation (checksum S=8505.752465030815, M=275996.81878375803). `pnpm report` regenerates `dist/results/` + `report.html` под Wave 1 stack (Playwright + prod bundle).

Это intermediate baseline — финальный re-baseline сделаем в Wave 3.

- [ ] **Step 4.2: Verify report.html opens locally**

Run: `open dist/results/report.html` (macOS).
Expected: report загружается, все 60 cells заполнены, FF numbers для C++ wasm ~17-27% lower чем были в Phase 1.0.5 baseline (Wave 4 expectation).

- [ ] **Step 4.3: Tag Wave 1**

```bash
git tag phase-1-0-6-wave-1
```

Wave 1 done. **Не коммитим `dist/results/` или `report.html`** — это intermediate baseline, перегенерим в Wave 3.

---

## Wave 2 — Real-engine automation

### Task 5: Resolve concrete browser versions + sha256

**Files:** none yet (lookup только)

- [ ] **Step 5.1: Lookup latest Firefox stable**

Run: `curl -sf https://product-details.mozilla.org/1.0/firefox_versions.json | grep LATEST_FIREFOX_VERSION`
Expected: JSON line like `"LATEST_FIREFOX_VERSION": "<ver>"`. Записать `FF_VERSION = <ver>` для следующих шагов.

- [ ] **Step 5.2: Get Firefox macOS DMG sha256**

Run: `curl -sf "https://ftp.mozilla.org/pub/firefox/releases/${FF_VERSION}/SHA256SUMS" | grep "mac/en-US/Firefox ${FF_VERSION}.dmg"`
Expected: один line с sha256-hex + filename. Записать `FF_SHA256 = <hex>`.

- [ ] **Step 5.3: Lookup latest geckodriver**

Run: `curl -sf -L https://api.github.com/repos/mozilla/geckodriver/releases/latest | grep -E '"tag_name"|browser_download_url.*macos-aarch64'`
Expected: `"tag_name": "v<ver>"` + URL для macos-aarch64 tarball. Записать `GD_VERSION = <ver>` и `GD_URL = <url>`.

- [ ] **Step 5.4: Get geckodriver sha256**

Geckodriver releases публикуют SHA256 в release body. Открыть в browser: `https://github.com/mozilla/geckodriver/releases/tag/v${GD_VERSION}` → найти `macos-aarch64.tar.gz` sha256. Alternative — compute локально:

```bash
curl -sfL "${GD_URL}" -o /tmp/gd.tar.gz && shasum -a 256 /tmp/gd.tar.gz && rm /tmp/gd.tar.gz
```

Записать `GD_SHA256 = <hex>`.

- [ ] **Step 5.5: Lookup latest Chrome for Testing stable**

Run: `curl -sf https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json > /tmp/cft.json`
Expected: JSON file. Parse:

```bash
node -e "
const j = require('/tmp/cft.json');
const v = j.channels.Stable;
console.log('version:', v.version);
console.log('chrome:', v.downloads.chrome.find(d => d.platform === 'mac-arm64').url);
console.log('chromedriver:', v.downloads.chromedriver.find(d => d.platform === 'mac-arm64').url);
"
```

Записать `CFT_VERSION = <ver>`, `CFT_CHROME_URL`, `CFT_CD_URL`.

- [ ] **Step 5.6: Get Chrome for Testing chrome + chromedriver sha256**

Chrome for Testing manifest НЕ публикует sha256 в JSON. Compute локально:

```bash
curl -sfL "${CFT_CHROME_URL}" -o /tmp/chrome.zip && shasum -a 256 /tmp/chrome.zip
curl -sfL "${CFT_CD_URL}" -o /tmp/cd.zip && shasum -a 256 /tmp/cd.zip
rm /tmp/chrome.zip /tmp/cd.zip
```

Записать `CFT_CHROME_SHA256` и `CFT_CD_SHA256`.

Все resolved values используем в Task 6.

### Task 6: Update tool-versions.json — browsers section

**Files:**
- Modify: `tool-versions.json`

- [ ] **Step 6.1: Add browsers top-level section**

В `tool-versions.json` добавить рядом с `tools` (подставляя resolved values из Task 5):

```jsonc
{
    "comment": "Внешние тулы, не управляемые pnpm. ...",
    "rustup": "1.29.0",
    "rustc": "1.95.0",
    "node": "22",
    "esbuild": "0.24.0",
    "tools": { /* unchanged */ },
    "browsers": {
        "_comment": "Phase 1.0.6: explicit browser binaries для selenium-webdriver. macOS arm64 only.",
        "firefox": {
            "version": "<FF_VERSION>",
            "url": "https://ftp.mozilla.org/pub/firefox/releases/<FF_VERSION>/mac/en-US/Firefox%20<FF_VERSION>.dmg",
            "sha256": "<FF_SHA256>",
            "appPath": "Firefox.app",
            "binaryInApp": "Contents/MacOS/firefox"
        },
        "geckodriver": {
            "version": "<GD_VERSION>",
            "url": "<GD_URL>",
            "sha256": "<GD_SHA256>"
        },
        "chrome-for-testing": {
            "version": "<CFT_VERSION>",
            "chromeUrl": "<CFT_CHROME_URL>",
            "chromeSha256": "<CFT_CHROME_SHA256>",
            "chromedriverUrl": "<CFT_CD_URL>",
            "chromedriverSha256": "<CFT_CD_SHA256>",
            "appPath": "chrome-mac-arm64/Google Chrome for Testing.app",
            "binaryInApp": "Contents/MacOS/Google Chrome for Testing",
            "chromedriverBinaryPath": "chromedriver-mac-arm64/chromedriver"
        }
    }
}
```

URL для Firefox должен иметь `%20` (URL-encoded space) — `curl` понимает корректно.

- [ ] **Step 6.2: Verify JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('tool-versions.json','utf8'))"`
Expected: no output (validates OK).

### Task 7: Add ensureFirefox, ensureGeckodriver, ensureChromeForTesting в setup-tools.ts

**Files:**
- Modify: `scripts/lib/setup-tools.ts`

- [ ] **Step 7.1: Add type interfaces для browsers manifest**

В `scripts/lib/setup-tools.ts` после существующего `TarballSpec` interface добавить:

```ts
export interface FirefoxSpec {
    version: string;
    url: string;
    sha256: string;
    appPath: string;       // e.g. "Firefox.app"
    binaryInApp: string;   // e.g. "Contents/MacOS/firefox"
}

export interface GeckodriverSpec {
    version: string;
    url: string;
    sha256: string;
}

export interface ChromeForTestingSpec {
    version: string;
    chromeUrl: string;
    chromeSha256: string;
    chromedriverUrl: string;
    chromedriverSha256: string;
    appPath: string;                 // e.g. "chrome-mac-arm64/Google Chrome for Testing.app"
    binaryInApp: string;             // e.g. "Contents/MacOS/Google Chrome for Testing"
    chromedriverBinaryPath: string;  // e.g. "chromedriver-mac-arm64/chromedriver"
}
```

- [ ] **Step 7.2: Add download+verify helper (reusable)**

Расширить файл reusable helper'ом для download + sha256 verify (текущий `ensureTarball` уже инлайнит этот pattern, но для browsers нам понадобится в разных функциях):

```ts
async function downloadAndVerify(url: string, expectedSha256: string, destPath: string): Promise<void> {
    console.log(`[setup] downloading ${url}`);
    await run("curl", [
        "-fsSL",
        "--retry", "5",
        "--retry-all-errors",
        "--retry-delay", "2",
        url,
        "-o", destPath,
    ]);
    const buf = await readFile(destPath);
    const actual = createHash("sha256").update(buf).digest("hex");
    if (actual !== expectedSha256) {
        await rm(destPath, { force: true });
        throw new Error(`sha256 mismatch for ${url}: expected ${expectedSha256}, got ${actual}`);
    }
}
```

(Опционально — рефакторить `ensureTarball` чтобы использовать этот helper. Не обязательно, можно оставить как есть.)

- [ ] **Step 7.3: Add ensureFirefox function**

В `scripts/lib/setup-tools.ts` (рядом с другими `ensure*`):

```ts
export async function ensureFirefox(spec: FirefoxSpec): Promise<void> {
    const state = await readState();
    const targetDir = join(TOOLS_DIR, `firefox-${spec.version}`);
    const appPath = join(targetDir, spec.appPath);
    const binaryPath = join(appPath, spec.binaryInApp);

    if (state["firefox"] === spec.version && await pathExists(binaryPath)) {
        console.log(`[setup] firefox ${spec.version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing firefox ${spec.version}`);
    await mkdir(TOOLS_DIR, { recursive: true });

    const tmpDmg = join(TOOLS_DIR, "firefox.download.dmg");
    await downloadAndVerify(spec.url, spec.sha256, tmpDmg);

    // Mount DMG into a temp mountpoint
    const mountPoint = join(TOOLS_DIR, "firefox.mount");
    await mkdir(mountPoint, { recursive: true });
    console.log(`[setup] mounting firefox dmg`);
    await run("hdiutil", ["attach", "-nobrowse", "-mountpoint", mountPoint, tmpDmg]);

    try {
        await rm(targetDir, { recursive: true, force: true });
        await mkdir(targetDir, { recursive: true });
        console.log(`[setup] copying ${spec.appPath} from dmg`);
        await run("cp", ["-R", join(mountPoint, spec.appPath), targetDir]);
    } finally {
        // Always detach the DMG, even if copy failed
        await run("hdiutil", ["detach", mountPoint]).catch(() => { /* best effort */ });
        await rm(mountPoint, { recursive: true, force: true });
    }

    await rm(tmpDmg, { force: true });

    // Remove macOS quarantine attribute so Gatekeeper doesn't block launch
    console.log(`[setup] clearing quarantine attr`);
    await run("xattr", ["-d", "-r", "com.apple.quarantine", appPath]).catch(() => { /* not all builds have it */ });

    if (!await pathExists(binaryPath)) {
        throw new Error(`firefox binary not found at expected path: ${binaryPath}`);
    }

    state["firefox"] = spec.version;
    await writeState(state);
    console.log(`[setup] firefox ${spec.version} installed`);
}
```

- [ ] **Step 7.4: Add ensureGeckodriver function**

```ts
export async function ensureGeckodriver(spec: GeckodriverSpec): Promise<void> {
    const state = await readState();
    const targetDir = join(TOOLS_DIR, `geckodriver-${spec.version}`);
    const binaryPath = join(targetDir, "geckodriver");

    if (state["geckodriver"] === spec.version && await pathExists(binaryPath)) {
        console.log(`[setup] geckodriver ${spec.version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing geckodriver ${spec.version}`);
    await mkdir(TOOLS_DIR, { recursive: true });

    const tmpFile = join(TOOLS_DIR, "geckodriver.download.tar.gz");
    await downloadAndVerify(spec.url, spec.sha256, tmpFile);

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    await run("tar", ["-xzf", tmpFile, "-C", targetDir]);
    await rm(tmpFile, { force: true });

    if (!await pathExists(binaryPath)) {
        throw new Error(`geckodriver binary not found at expected path: ${binaryPath}`);
    }

    state["geckodriver"] = spec.version;
    await writeState(state);
    console.log(`[setup] geckodriver ${spec.version} installed`);
}
```

- [ ] **Step 7.5: Add ensureChromeForTesting function**

```ts
export async function ensureChromeForTesting(spec: ChromeForTestingSpec): Promise<void> {
    const state = await readState();
    const targetDir = join(TOOLS_DIR, `chrome-${spec.version}`);
    const chromeBinaryPath = join(targetDir, spec.appPath, spec.binaryInApp);
    const chromedriverBinaryPath = join(targetDir, spec.chromedriverBinaryPath);

    if (
        state["chrome-for-testing"] === spec.version
        && await pathExists(chromeBinaryPath)
        && await pathExists(chromedriverBinaryPath)
    ) {
        console.log(`[setup] chrome-for-testing ${spec.version} already installed, skipping`);
        return;
    }

    console.log(`[setup] installing chrome-for-testing ${spec.version}`);
    await mkdir(TOOLS_DIR, { recursive: true });

    const chromeZip = join(TOOLS_DIR, "chrome.download.zip");
    const cdZip = join(TOOLS_DIR, "chromedriver.download.zip");
    await downloadAndVerify(spec.chromeUrl, spec.chromeSha256, chromeZip);
    await downloadAndVerify(spec.chromedriverUrl, spec.chromedriverSha256, cdZip);

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    console.log(`[setup] extracting chrome.zip`);
    await run("unzip", ["-q", chromeZip, "-d", targetDir]);
    console.log(`[setup] extracting chromedriver.zip`);
    await run("unzip", ["-q", cdZip, "-d", targetDir]);
    await rm(chromeZip, { force: true });
    await rm(cdZip, { force: true });

    // Clear quarantine attr on chrome .app
    const appPath = join(targetDir, spec.appPath);
    await run("xattr", ["-d", "-r", "com.apple.quarantine", appPath]).catch(() => { /* not all builds have it */ });
    await run("xattr", ["-d", "-r", "com.apple.quarantine", chromedriverBinaryPath]).catch(() => { /* not all builds have it */ });

    if (!await pathExists(chromeBinaryPath)) {
        throw new Error(`chrome binary not found: ${chromeBinaryPath}`);
    }
    if (!await pathExists(chromedriverBinaryPath)) {
        throw new Error(`chromedriver binary not found: ${chromedriverBinaryPath}`);
    }

    state["chrome-for-testing"] = spec.version;
    await writeState(state);
    console.log(`[setup] chrome-for-testing ${spec.version} installed`);
}
```

- [ ] **Step 7.6: Remove ensurePlaywrightBrowsers function**

Из `scripts/lib/setup-tools.ts` удалить функцию `ensurePlaywrightBrowsers` (она больше не нужна, Playwright уходит в Wave 2 task 11).

- [ ] **Step 7.7: TS typecheck**

Run: `pnpm typecheck`
Expected: errors про `ensurePlaywrightBrowsers` reference в `scripts/setup.ts` (это нормально — fix в Task 8). Других errors быть не должно.

### Task 8: Update setup.ts — call new browser ensure-functions

**Files:**
- Modify: `scripts/setup.ts`

- [ ] **Step 8.1: Add browsers manifest interface**

В `scripts/setup.ts` обновить interface `VersionsManifest`:

```ts
interface BrowsersManifest {
    firefox: FirefoxSpec;
    geckodriver: GeckodriverSpec;
    "chrome-for-testing": ChromeForTestingSpec;
}

interface VersionsManifest {
    tools: {
        "wasi-sdk": TarballEntry;
        binaryen: TarballEntry;
        emsdk: EmsdkEntry;
        "wasm-pack": WasmPackEntry;
    };
    browsers: BrowsersManifest;
}
```

И imports:

```ts
import {
    type TarballSpec,
    type FirefoxSpec,
    type GeckodriverSpec,
    type ChromeForTestingSpec,
    ensureTarball,
    ensureEmsdk,
    ensureWasmPackViaCargo,
    ensureRustTarget,
    ensureFirefox,
    ensureGeckodriver,
    ensureChromeForTesting,
    createSymlinks,
} from "./lib/setup-tools.js";
```

(Убрать `ensurePlaywrightBrowsers` из импорта.)

- [ ] **Step 8.2: Replace ensurePlaywrightBrowsers call**

В `main()` функции `scripts/setup.ts` заменить:

```diff
    await ensureTarball(wasiSdk);
    await ensureTarball(binaryen);
    await ensureEmsdk(manifest.tools.emsdk.version);
    await ensureWasmPackViaCargo(manifest.tools["wasm-pack"].version);
    await createSymlinks();
    await ensureRustTarget("wasm32-unknown-unknown");
-   await ensurePlaywrightBrowsers();
+   await ensureFirefox(manifest.browsers.firefox);
+   await ensureGeckodriver(manifest.browsers.geckodriver);
+   await ensureChromeForTesting(manifest.browsers["chrome-for-testing"]);
    console.log("[setup] all tools ready");
```

- [ ] **Step 8.3: TS typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8.4: Run setup-tools — verify installation**

Run: `pnpm setup-tools`
Expected:
- `[setup] installing firefox <ver>` → `[setup] firefox <ver> installed`
- `[setup] installing geckodriver <ver>` → `[setup] geckodriver <ver> installed`
- `[setup] installing chrome-for-testing <ver>` → `[setup] chrome-for-testing <ver> installed`
- Final: `[setup] all tools ready`

Verify paths:
```bash
ls -la .tools/firefox-*/Firefox.app/Contents/MacOS/firefox
ls -la .tools/geckodriver-*/geckodriver
ls -la .tools/chrome-*/chrome-mac-arm64/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing
ls -la .tools/chrome-*/chromedriver-mac-arm64/chromedriver
```
Expected: все 4 files exist и executable.

- [ ] **Step 8.5: Verify state.json updated**

Run: `cat .tools/state.json`
Expected: JSON содержит `"firefox": "<ver>"`, `"geckodriver": "<ver>"`, `"chrome-for-testing": "<ver>"` в дополнение к существующим entries.

- [ ] **Step 8.6: Verify idempotency**

Run: `pnpm setup-tools` второй раз.
Expected: `[setup] firefox <ver> already installed, skipping` (и аналогично для остальных).

- [ ] **Step 8.7: Commit setup pipeline**

```bash
git add tool-versions.json scripts/setup.ts scripts/lib/setup-tools.ts
git commit --no-gpg-sign -m "feat(setup): add ensureFirefox/Geckodriver/ChromeForTesting installers"
```

### Task 9: Create browser-paths.ts utility

**Files:**
- Create: `apps/runner-web/src/browser-paths.ts`

- [ ] **Step 9.1: Create browser-paths.ts**

`apps/runner-web/src/browser-paths.ts`:

```ts
import { readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

interface FirefoxEntry {
    version: string;
    url: string;
    sha256: string;
    appPath: string;
    binaryInApp: string;
}

interface GeckodriverEntry {
    version: string;
    url: string;
    sha256: string;
}

interface ChromeForTestingEntry {
    version: string;
    chromeUrl: string;
    chromeSha256: string;
    chromedriverUrl: string;
    chromedriverSha256: string;
    appPath: string;
    binaryInApp: string;
    chromedriverBinaryPath: string;
}

interface VersionsFile {
    browsers: {
        firefox: FirefoxEntry;
        geckodriver: GeckodriverEntry;
        "chrome-for-testing": ChromeForTestingEntry;
    };
}

export interface BrowserPaths {
    firefoxBinary: string;
    geckodriver: string;
    chromeBinary: string;
    chromedriver: string;
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

export async function getBrowserPaths(): Promise<BrowserPaths> {
    const raw = await readFile(join(REPO_ROOT, "tool-versions.json"), "utf8");
    const tv = JSON.parse(raw) as VersionsFile;
    const b = tv.browsers;

    const firefoxBinary = join(
        REPO_ROOT, ".tools", `firefox-${b.firefox.version}`,
        b.firefox.appPath, b.firefox.binaryInApp,
    );
    const geckodriver = join(
        REPO_ROOT, ".tools", `geckodriver-${b.geckodriver.version}`, "geckodriver",
    );
    const chromeBinary = join(
        REPO_ROOT, ".tools", `chrome-${b["chrome-for-testing"].version}`,
        b["chrome-for-testing"].appPath, b["chrome-for-testing"].binaryInApp,
    );
    const chromedriver = join(
        REPO_ROOT, ".tools", `chrome-${b["chrome-for-testing"].version}`,
        b["chrome-for-testing"].chromedriverBinaryPath,
    );

    for (const [name, path] of [
        ["firefox", firefoxBinary],
        ["geckodriver", geckodriver],
        ["chrome", chromeBinary],
        ["chromedriver", chromedriver],
    ] as const) {
        if (!await pathExists(path)) {
            throw new Error(
                `${name} binary not found at ${path}. Run 'pnpm setup-tools' from repo root.`,
            );
        }
    }

    return { firefoxBinary, geckodriver, chromeBinary, chromedriver };
}
```

- [ ] **Step 9.2: TS typecheck**

Run: `pnpm --filter @bench-app/runner-web typecheck`
Expected: no errors.

### Task 10: Add __BENCH_LOGS capture в page.ts

**Files:**
- Modify: `apps/runner-web/src/page.ts`

- [ ] **Step 10.1: Add error capture hooks at module top**

В `apps/runner-web/src/page.ts` обновить `declare global` и добавить hooks ДО `main()`:

```ts
import type { WorkerInput } from "./worker.js";
import type { BenchResult } from "@bench/result-schema";

interface BenchLogEntry {
    type: "error" | "unhandledrejection";
    msg: string;
    stack?: string;
}

declare global {
    interface Window {
        __BENCH_RESULT?: BenchResult | { error: string };
        __BENCH_LOGS?: BenchLogEntry[];
    }
}

// Phase 1.0.6: capture page-level errors for selenium driver diagnostic forwarding.
// Selenium classic WebDriver has no cross-browser console event API (geckodriver
// doesn't support logs()), so we accumulate into window.__BENCH_LOGS and the
// driver reads via executeScript at the end.
window.__BENCH_LOGS = [];
window.addEventListener("error", (e) => {
    window.__BENCH_LOGS!.push({
        type: "error",
        msg: e.message,
        stack: e.error instanceof Error ? e.error.stack : undefined,
    });
});
window.addEventListener("unhandledrejection", (e) => {
    window.__BENCH_LOGS!.push({
        type: "unhandledrejection",
        msg: String(e.reason),
        stack: e.reason instanceof Error ? e.reason.stack : undefined,
    });
});

function setStatus(msg: string) {
    // ... rest unchanged
```

- [ ] **Step 10.2: TS typecheck**

Run: `pnpm --filter @bench-app/runner-web typecheck`
Expected: no errors.

### Task 11: Swap @playwright/test → selenium-webdriver

**Files:**
- Modify: `apps/runner-web/package.json`

- [ ] **Step 11.1: Update package.json deps**

В `apps/runner-web/package.json`:

```diff
"devDependencies": {
-    "@playwright/test": "^1.50.0",
+    "selenium-webdriver": "~4.27.0",
+    "@types/selenium-webdriver": "~4.1.0",
    "sirv": "^3.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.3",
    "vite": "^6.0.0"
}
```

(Конкретные patch версии — latest stable на момент имплементации. `~` lock'ит только patch.)

- [ ] **Step 11.2: pnpm install**

Run: `pnpm install`
Expected: `@playwright/test` removed from `apps/runner-web/node_modules`, `selenium-webdriver` and `@types/selenium-webdriver` added. `pnpm-lock.yaml` обновлён.

### Task 12: Rewrite driver.ts на selenium-webdriver

**Files:**
- Modify: `apps/runner-web/src/driver.ts`

- [ ] **Step 12.1: Replace driver.ts contents**

Полная замена `apps/runner-web/src/driver.ts`:

```ts
import { argv, exit } from "node:process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { totalmem } from "node:os";
import { Builder, type WebDriver } from "selenium-webdriver";
import * as firefox from "selenium-webdriver/firefox";
import * as chrome from "selenium-webdriver/chrome";
import { BenchResultSchema } from "@bench/result-schema";
import type { Language, Toolchain, Profile, InputSize } from "@bench/result-schema";
import type { WorkerInput } from "./worker.js";
import { getBrowserPaths } from "./browser-paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

interface CliArgs {
    benchmark: string;
    language: Language;
    toolchain: Toolchain;
    profile: Profile;
    size: InputSize;
    outDir: string;
    mode: "quick" | "eval";
    browser: "chromium" | "firefox";
    port: number;
}

function parseCli(args: string[]): CliArgs {
    const get = (name: string): string => {
        const v = args.find((a) => a.startsWith(`--${name}=`));
        if (!v) {
            throw new Error(`missing --${name}`);
        }
        return v.slice(name.length + 3);
    };
    const getOpt = (name: string, fallback: string): string => {
        const v = args.find((a) => a.startsWith(`--${name}=`));
        return v ? v.slice(name.length + 3) : fallback;
    };
    return {
        benchmark: get("benchmark"),
        language: get("language") as Language,
        toolchain: get("toolchain") as Toolchain,
        profile: get("profile") as Profile,
        size: get("size") as InputSize,
        outDir: get("out"),
        mode: get("mode") as "quick" | "eval",
        browser: getOpt("browser", "chromium") as "chromium" | "firefox",
        port: parseInt(getOpt("port", "5174"), 10),
    };
}

interface SpecSizeEntry {
    fixtureSha256: string;
    expectedChecksum: number | string;
}

interface SpecFile {
    inputSizes: Record<InputSize, SpecSizeEntry>;
}

async function launchBrowser(env: "chromium" | "firefox"): Promise<WebDriver> {
    const paths = await getBrowserPaths();
    if (env === "firefox") {
        const opts = new firefox.Options();
        opts.setBinary(paths.firefoxBinary);
        opts.addArguments("--headless");
        // Suppress auto-update, telemetry, first-run UI
        opts.setPreference("app.update.auto", false);
        opts.setPreference("app.update.enabled", false);
        opts.setPreference("app.update.staging.enabled", false);
        opts.setPreference("toolkit.telemetry.reportingpolicy.firstRun", false);
        opts.setPreference("datareporting.policy.firstRunURL", "");
        opts.setPreference("browser.shell.checkDefaultBrowser", false);
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

async function main() {
    const a = parseCli(argv.slice(2));

    const measureConfig = a.mode === "quick"
        ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 10, cvThreshold: 0.05 }
        : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 };

    const specPath = join(REPO_ROOT, `dist/${a.benchmark}/spec.json`);
    const spec = JSON.parse(await readFile(specPath, "utf8")) as SpecFile;
    const sizeSpec = spec.inputSizes[a.size];
    if (!sizeSpec) {
        throw new Error(`spec missing inputSize ${a.size}`);
    }

    const baseUrl = `http://localhost:${a.port}`;

    const workerInput: WorkerInput = {
        benchmarkId: a.benchmark,
        language: a.language,
        toolchain: a.toolchain,
        profile: a.profile,
        inputSize: a.size,
        fixtureSha256: sizeSpec.fixtureSha256,
        expectedChecksum: sizeSpec.expectedChecksum,
        measureConfig,
        baseUrl,
    };

    const caseParam = btoa(JSON.stringify(workerInput));
    const debug = process.env["BENCH_DEBUG_TIMINGS"] === "1" ? "&debug=1" : "";
    const url = `${baseUrl}/?case=${encodeURIComponent(caseParam)}${debug}`;

    let driver: WebDriver | undefined;
    let raw: unknown;
    try {
        driver = await launchBrowser(a.browser);
        console.log(`navigating to ${url}`);
        await driver.get(url);

        const timeoutMs = 5 * 60 * 1000;
        try {
            await driver.wait(async () => {
                return await driver!.executeScript<boolean>(
                    "return (window).__BENCH_RESULT !== undefined;",
                );
            }, timeoutMs);
        } catch {
            const status = await driver.executeScript<string>(
                "return document.getElementById('status')?.textContent || '(no status)';",
            ).catch(() => "(eval failed)");
            const logs = await driver.executeScript<unknown[]>(
                "return (window).__BENCH_LOGS || [];",
            ).catch(() => []);
            for (const log of logs) console.error("[browser]", log);
            throw new Error(`timed out waiting for result. Page status: ${status}`);
        }

        raw = await driver.executeScript<unknown>(
            "return (window).__BENCH_RESULT;",
        );

        // Forward any captured logs even on success
        const logs = await driver.executeScript<unknown[]>(
            "return (window).__BENCH_LOGS || [];",
        ).catch(() => []);
        for (const log of logs) console.log("[browser]", log);
    } finally {
        await driver?.quit().catch(() => { /* best effort */ });
    }

    if (
        raw !== null
        && typeof raw === "object"
        && "error" in raw
        && typeof (raw).error === "string"
    ) {
        throw new Error(`benchmark failed: ${(raw as { error: string }).error}`);
    }

    const result = BenchResultSchema.parse(raw);

    const machineCpu = process.env["MACHINE_CPU"] ?? "unknown";
    const patched = {
        ...result,
        machine: {
            os: `${process.platform} ${process.arch}`,
            cpu: machineCpu,
            memoryGb: Math.max(1, Math.round(totalmem() / (1024 ** 3))),
        },
    };
    const final = BenchResultSchema.parse(patched);

    const resolvedOutDir = resolve(REPO_ROOT, a.outDir);
    await mkdir(resolvedOutDir, { recursive: true });
    const fname = `${a.benchmark}__${a.language}-${a.toolchain}-${a.profile}__${a.size}__${a.browser}.json`;
    const outPath = join(resolvedOutDir, fname);
    await writeFile(outPath, JSON.stringify(final, null, 2));
    console.log(`wrote ${outPath}`);
    console.log(`checksum: ${String(final.quality.checksum)}`);
    console.log(`validated: ${String(final.quality.validated)}`);
}

main().catch((e) => {
    console.error(e); exit(1);
});
```

- [ ] **Step 12.2: TS typecheck**

Run: `pnpm --filter @bench-app/runner-web typecheck`
Expected: no errors.

### Task 13: Sanity-check Wave 2 — manual cross-check FF + smoke + quick bench

- [ ] **Step 13.1: Quick FF M cpp/emscripten/size run**

Run:
```bash
pnpm bench --envs=firefox --sizes=M --mode=quick --out=/tmp/p106-wave2-ff
```
Expected: passes. Check `/tmp/p106-wave2-ff/matmul__cpp-emscripten-size__M__firefox.json` → `quality.samples` mean **in range 4-7 ms** (real-FF expectation).

Если numbers >50 ms — selenium-imposed prefs или firefox auto-update сломали Ion. Debug:
- Check Firefox flags via `about:config` (запустить FF binary вручную и проверить prefs).
- Сomprehend которые prefs selenium auto-applies к ephemeral profile.

- [ ] **Step 13.2: Quick Chrome M cpp/emscripten/size run**

Run:
```bash
pnpm bench --envs=chromium --sizes=M --mode=quick --out=/tmp/p106-wave2-ch
```
Expected: passes. Check JSON → mean **in range 4-6 ms** (similar to Playwright Chromium per Wave 4 measurements).

- [ ] **Step 13.3: Full smoke test**

Run: `pnpm smoke`
Expected: all smoke cases pass. Logs показывают selenium driver launching downloaded FF/Chrome (no playwright).

- [ ] **Step 13.4: Manual cross-check FF binary**

Запустить downloaded FF manually:
```bash
cd apps/runner-web && pnpm preview &
sleep 2
# Generate URL для cpp/emscripten/size M eval mode
node -e "
const wi = {
    benchmarkId: 'matmul', language: 'cpp', toolchain: 'emscripten', profile: 'size',
    inputSize: 'M', fixtureSha256: '9808581790a2389ab4263529ac50bbce6c1fc611b26ba11daf61a6a4d1471b94',
    expectedChecksum: 275996.81878375803,
    measureConfig: { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 },
    baseUrl: 'http://localhost:5174',
};
const url = 'http://localhost:5174/?case=' + encodeURIComponent(Buffer.from(JSON.stringify(wi)).toString('base64')) + '&debug=1';
console.log(url);
"
# Открыть напечатанный URL в downloaded Firefox manually:
"$(node -e "const tv = require('./tool-versions.json'); console.log(\`\${require('node:path').resolve('.tools', 'firefox-' + tv.browsers.firefox.version)}/Firefox.app/Contents/MacOS/firefox\`);")" <printed-url>
```
Expected: Firefox window открывается, бенчмарк runs, DevTools console показывает per-sample timings ~5 ms range. Если совпадает с selenium results (Step 13.1) — JIT работает корректно через selenium тоже. Если manual FF показывает 5 ms, а selenium 50 ms — investigate selenium prefs.

Cleanup: `kill %1` (preview).

### Task 14: Optional clear.ts cleanup

**Files:**
- Modify: `scripts/clear.ts`

- [ ] **Step 14.1: Remove Playwright artifact paths**

В `scripts/clear.ts` обновить `ALWAYS_PATHS`:

```ts
const ALWAYS_PATHS = [
    "dist",
    "results",
    "target",
    "benches/matmul/rust/bindgen/pkg-tmp",
    "apps/runner-web/.vite",
];
```

(Удалить `apps/runner-web/test-results` и `apps/runner-web/playwright-report` — больше не создаются.)

- [ ] **Step 14.2: Verify clear работает**

Run: `pnpm clear`
Expected: idempotent (no errors), `dist/` и `results/` removed.

### Task 15: Commit Wave 2 + tag

- [ ] **Step 15.1: Final Wave 2 commit**

```bash
git add apps/runner-web/src/browser-paths.ts \
        apps/runner-web/src/driver.ts \
        apps/runner-web/src/page.ts \
        apps/runner-web/package.json \
        scripts/clear.ts \
        pnpm-lock.yaml
git commit --no-gpg-sign -m "refactor(runner-web): replace Playwright with selenium-webdriver + downloaded browsers"
```

- [ ] **Step 15.2: Tag Wave 2**

```bash
git tag phase-1-0-6-wave-2
```

Wave 2 done. Wave 3 — re-baseline.

---

## Wave 3 — Combined re-baseline + finalization

### Task 16: Re-baseline full bench:all

- [ ] **Step 16.1: Clear stale results**

Run: `pnpm clear`
Expected: `dist/` и `results/` deleted.

- [ ] **Step 16.2: Full bench:all run**

Run: `pnpm bench:all`
Expected: ~30-60 минут (FF cases теперь быстрые, ~5ms vs предыдущих ~125ms — total cycle time снизится для FF wasm combos). 60 кейсов pass validation.

После завершения проверить:
- `dist/results/` существует, содержит aggregated JSON.
- `report.html` сгенерирован.

- [ ] **Step 16.3: Verify success criteria**

Open `dist/results/report.html`. Spot-check:

| Cell | Expected | Source |
|---|---|---|
| FF M cpp/emscripten/size | 4-7 ms | manual real-FF runs Wave 4 |
| FF M cpp/wasi-sdk/speed | 4-7 ms | should match Chrome order of magnitude |
| FF M js/typed-array/speed | ~13 ms | unchanged from Phase 1.0.5 |
| Chromium M cpp/emscripten/size | 4-6 ms | unchanged ±5% from Phase 1.0.5 |
| Chromium M js/typed-array/speed | unchanged ±5% | reference |
| Node M cpp/emscripten/size | ~5 ms | unchanged (Node не трогали) |

Если FF cell ≥ 20 ms — что-то неправильно с JIT в selenium-driven FF. Stop и debug.

Если все cells в expected ranges → success.

### Task 17: Update README — remove FF artifact disclaimer

**Files:**
- Modify: `README.md`

- [ ] **Step 17.1: Remove FF artifact disclaimer**

В `README.md` найти секцию "Известные ограничения" (или "Known limitations"). Удалить параграф про Playwright Firefox Nightly artifact / 20-25× FF wasm slowdown / migration на BiDi.

- [ ] **Step 17.2: Add browser versions reference**

В README в секции про tooling/dependencies (или в новой "Browser versions" sub-section) добавить:

```markdown
### Browser versions

Web envs (`firefox`, `chromium`) запускаются на pinned production builds, скачиваемых
через `pnpm setup-tools` в `.tools/`:

- **Firefox stable** — Mozilla releases (DMG для macOS arm64).
- **Chrome for Testing** — Google's pinnable Chrome builds для automation (ZIP).
- **geckodriver** + **chromedriver** — версии управляются `tool-versions.json` browsers section.

См. `tool-versions.json` `browsers` для точных версий.
```

- [ ] **Step 17.3: TS typecheck не нужен (.md)**

(Skip)

### Task 18: Optional — write before/after notes file

**Files:**
- Create: `docs/superpowers/notes/2026-05-12-phase-1-0-6-rebaseline.md` (optional)

- [ ] **Step 18.1: Write notes file**

Если хочется зафиксировать before/after сравнение (для historical reference):

```markdown
# Phase 1.0.6 re-baseline notes

Date: 2026-05-XX
Branch: feature/phase-1-0-6
Tag: phase-1-0-6

## Changes

1. Vite dev → prod-bundle pipeline (vite build + vite preview).
2. Playwright → selenium-webdriver + Firefox stable + Chrome for Testing.

## Before/after канонические combos (M-size)

| combo | env | Phase 1.0.5 baseline | Phase 1.0.6 final | delta |
|---|---|---|---|---|
| cpp/emscripten/size | firefox | <N1> ms | <N2> ms | <ratio>× |
| cpp/wasi-sdk/speed | firefox | <N1> | <N2> | <ratio>× |
| rust/raw/speed | firefox | <N1> | <N2> | <ratio>× |
| cpp/emscripten/size | chromium | <N1> | <N2> | within ±5% |
| js/typed-array/speed | firefox | <N1> | <N2> | within noise |

Главное: FF wasm gap closed. Real production Firefox engine now measured.
```

Заполнить `<N1>`/`<N2>` actual numbers из dist/results JSON.

(Эта задача opt-in — можно пропустить, если не нужен historical artifact.)

### Task 19: Final commit + merge + tag

- [ ] **Step 19.1: Stage и commit Wave 3 artifacts**

```bash
git add dist/results/ README.md
# Если делали Task 18:
# git add docs/superpowers/notes/2026-05-12-phase-1-0-6-rebaseline.md
git commit --no-gpg-sign -m "chore(phase-1-0-6): re-baseline under real engines + prod bundle"
```

- [ ] **Step 19.2: Verify clean working tree**

Run: `git status`
Expected: nothing to commit, branch ahead of master by N commits.

- [ ] **Step 19.3: Verify final smoke**

Run: `pnpm smoke`
Expected: passes (last sanity check before merge).

- [ ] **Step 19.4: Switch to master and merge**

```bash
git switch master
git merge --no-ff --no-gpg-sign -m "merge: Phase 1.0.6 (Web pipeline finalization)" feature/phase-1-0-6
```
Expected: merge commit создан.

- [ ] **Step 19.5: Tag final**

```bash
git tag phase-1-0-6
```

- [ ] **Step 19.6: Cleanup intermediate tags (optional)**

`phase-1-0-6-wave-1` и `phase-1-0-6-wave-2` можно оставить как historical breadcrumbs. Не обязательно удалять.

Phase 1.0.6 closed.

---

## Self-review summary

**Spec coverage:**
- ✓ Wave 1 prod-bundle (spec §1.1-1.5) → Tasks 1-4
- ✓ Wave 2 real-engine (spec §2.1-2.7) → Tasks 5-15
- ✓ Wave 3 re-baseline (spec §3.1-3.5) → Tasks 16-19
- ✓ tool-versions.json browsers section (spec §2.2) → Task 6
- ✓ ensureFirefox/Geckodriver/ChromeForTesting (spec §2.3) → Task 7
- ✓ driver.ts rewrite (spec §2.4) → Task 12
- ✓ __BENCH_LOGS capture (spec §2.4) → Task 10
- ✓ Re-baseline + README update (spec §3.3) → Tasks 16-17
- ✓ Risks mitigations (spec risk matrix) — prefs/flags в driver.ts Task 12 + xattr in setup-tools Task 7

**Placeholder scan:**
- Version values (`<FF_VERSION>`, `<GD_VERSION>`, `<CFT_VERSION>`, etc.) — intentional placeholders, resolved in Task 5 lookup steps. Each has concrete command to fetch actual value.
- No `TBD`, `TODO`, `implement later` etc. in code blocks.

**Type consistency:**
- `FirefoxSpec`/`GeckodriverSpec`/`ChromeForTestingSpec` — defined in setup-tools.ts Task 7.1, used in setup.ts Task 8.1 + browser-paths.ts Task 9.1 (consistent field names).
- `BrowserPaths` interface — defined in browser-paths.ts Task 9.1, consumed in driver.ts Task 12 (consistent: `firefoxBinary`, `geckodriver`, `chromeBinary`, `chromedriver`).
- `BenchLogEntry` — defined in page.ts Task 10.1, read as `unknown[]` in driver.ts Task 12.1 (loose typing on driver side OK — we just log).
