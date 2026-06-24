# Size Attribution Toolchain Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать facility-атрибуцию всем wasm-тулчейнам (rust/bindgen, cpp/wasi-sdk, cpp/emscripten) и честно показать per-binary JS-glue bindgen/emscripten в Size-виде отчёта.

**Architecture:** Метод Phase 1.3 без изменений — доли из name-bearing pre-wasm-opt сборки через `twiggy top -f json` → facility-реестр (`@bench/size-attr`) → калибровка к точному production-тоталу. Каждый тулчейн поставляет name-bearing сборку своим способом. Reporter добавляет «glue (JS)»-сегмент из уже измеренного `meta.jsGlue`.

**Tech Stack:** TypeScript (tsx-оркестраторы, esm), pnpm-workspace, zod-схема (`@bench/result-schema`), twiggy 0.8.0 + wasm-tools 1.249.0 (build-инструменты), wasi-sdk-25 clang, wasm-pack/wasm-bindgen, emscripten.

## Global Constraints

- **TS:** 4-space indent, double quotes, semicolons, trailing comma (multiline), `curly: all`, `verbatimModuleSyntax` + strict. Enforced by `eslint.config.js`.
- **Schema changes only via `packages/result-schema`** — но эта фаза изменений схемы НЕ требует (reporter собирает glue-band из существующих `meta.composition` + `meta.jsGlue`).
- **Never edit** `**/glue.mjs`, `**/glue.js` (Emscripten/wasm-bindgen output).
- **wasm-opt** MUST run with `--enable-bulk-memory --enable-nontrapping-float-to-int`.
- **Production-бинари не меняются** — атрибуция read-only; gate: `meta.wasm.hashSha256` для каждого (binary×profile) byte-идентичен до/после (кроме случаев, где production-бинарь и так не трогается — здесь все).
- **Cargo workspace target** — артефакты в workspace-root `target/`, не per-crate.
- **tsx/build под sandbox** — `pnpm build:*` / `smoke` / `tsx` запускать с `dangerouslyDisableSandbox: true` (Unix-pipe bind блокируется sandbox'ом). `typecheck`/`test`/`lint` работают в sandbox.
- **Commits:** `--no-gpg-sign`. Push/PR — действие пользователя.

---

## Execution Protocol

**Routing (hybrid inline/subagent — `docs/workflow.md`, feedback_execution_strategy):**

- **[S] subagent** — Task 1 (bindgen attribution: build-wiring + facility rules + probe), Task 4 (reporter glue-band: data + view-model + render + tests), Task 5 (emscripten probe + attribution/fallback). Тяжёлые, многофайловые, с эмпирическими пробами.
- **[I] inline** — Task 2 (PATH-фикс в build-cpp.ts — точечно, понятно), Task 3 (раскатка attr-ветки по wasi-sdk-скриптам — механический паттерн), Task 6 (guidelines + roadmap + bug-report close — прозаические правки).

**Static break-points (рекомендовать `/finish-session`, пользователь решает):**
- После Task 3 (wasi-sdk полностью атрибутирован — естественный чекпойнт, можно мерить).
- После Task 5 (все тулчейны покрыты, до reporter-полировки — если W4 шла раньше, скорректировать).
- После Task 6 (фаза закрыта).

**Per-task break-check:** после каждой задачи — гейты зелёные? deliverable независимо тестируем? Если задача вскрыла незапланированную связанность/риск из спеки (§ Риски) — эскалировать пользователю с альтернативами (feedback_surface_planned_risks), не применять молча.

**Wave-0 baseline gate (перед Task 1):** на ветке прогнать `pnpm typecheck && pnpm lint:all && pnpm test` (sandbox-ok) — убедиться, что база зелёная ДО изменений. Зафиксировать текущие `meta.wasm.hashSha256` для wasi-sdk-бинарей (для production-byte-identity gate).

**Landing audit (перед закрытием, Task 6):** all-gates pre-flight `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke` (build/smoke — `dangerouslyDisableSandbox`); визуальный чек отчёта (открыть HTML — bindgen/emscripten разложены + glue-band; raw/wasi-sdk без glue; emscripten section-only честно помечен, если fallback); spec-coverage diff (назвать любой § In scope, не реализованный).

---

## File Structure

- `packages/size-attr/src/facilities.ts` — +правила для wasm-bindgen/emscripten glue-in-wasm (`__wbindgen`, `__wbg`, emscripten runtime). Modify.
- `scripts/lib/size-attr-build.ts` — +`attributeRustBindgen`, +`attributeEmscripten`; правка `attributeWasiSdk` (PATH-гигиена не здесь — в build-cpp.ts). Modify.
- `scripts/build-rust.ts` — `buildBindgen` вызывает `attributeRustBindgen` (было `composition: null`). Modify.
- `scripts/build-cpp.ts` — PATH-гигиена для wasi-sdk (WASM_OPT abspath, без `.tools/bin`); `buildEmscripten` вызывает `attributeEmscripten`; attr-output в изолированный dir. Modify.
- `benches/*/cpp/build-wasi-sdk.sh` (7 без ветки) — +SIZE_ATTR attr-build-ветка. `benches/hashmap_string/cpp/build-wasi-sdk.sh` — выровнять под изолированный attr-output + `$WASM_OPT`. Modify.
- `benches/*/cpp/build-emscripten.sh` — +name-preservation флаг под `SIZE_ATTR`. Modify.
- `packages/reporter/src/size-data.ts` — `SizeBinary` несёт `glue: CellBytes | null`. Modify.
- `packages/reporter/src/size-view-model.ts` — +glue-сегмент (band `glue`). Modify.
- `packages/reporter/src/render-size.ts` — +`.seg-glue` CSS + легенда. Modify.
- `packages/size-attr/tests/*`, `packages/reporter/tests/*` — TDD для правил и glue-сегмента. Create/Modify.
- `docs/guidelines.md`, `docs/roadmap.md`, `docs/superpowers/bug-reports/2026-06-21-...md` — финал. Modify.

---

## Task 1 [S]: rust/bindgen attribution

**Files:**
- Modify: `packages/size-attr/src/facilities.ts` (wbindgen rule)
- Test: `packages/size-attr/tests/facilities-bindgen.test.ts` (create)
- Modify: `scripts/lib/size-attr-build.ts` (`attributeRustBindgen`)
- Modify: `scripts/build-rust.ts` (`buildBindgen` — wire composition)

**Interfaces:**
- Consumes: `buildComposition(rows, ctx, productionTotal)`, `parseTwiggyJson(json)`, `categorize(name, ctx)` from `@bench/size-attr`; `run`/`capture` from `./exec.js`; `twiggyPath()`, `wasmPackPath()` from `./tool-paths.js`; `BinaryCombination` from `./matrix.js`.
- Produces: `attributeRustBindgen(c: BinaryCombination, productionTotal: ProductionTotal): Promise<SizeComposition | null>`.

- [ ] **Step 1: Failing test — wasm-bindgen glue symbols categorize as `toolchain-runtime`**

Create `packages/size-attr/tests/facilities-bindgen.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { categorize } from "../src/facilities.js";

const ctx = { exportNames: new Set<string>(), workloadPrefixes: [] };

describe("wasm-bindgen glue facility", () => {
    it("maps __wbindgen_* and __wbg_* to toolchain-runtime", () => {
        expect(categorize("__wbindgen_malloc", ctx).facility).toBe("toolchain-runtime");
        expect(categorize("__wbg_log_abc123", ctx).facility).toBe("toolchain-runtime");
        expect(categorize("__wbindgen_realloc", ctx).facility).toBe("toolchain-runtime");
    });
});
```

- [ ] **Step 2: Run test — expect FAIL** (`__wbindgen_malloc` currently hits `allocator` via `realloc`/`malloc`? verify actual)

Run: `pnpm --filter @bench/size-attr test facilities-bindgen` (or `pnpm test`)
Expected: FAIL — `__wbindgen_malloc` falls through to `unattributed` or mis-categorizes.

- [ ] **Step 3: Add wbindgen rule to registry (ordered BEFORE allocator so `__wbindgen_malloc` wins)**

In `packages/size-attr/src/facilities.ts`, in `RULES`, insert as the SECOND rule (after `panic-fmt`, before `toolchain-runtime`'s LazyLock or merge into it). Extend the existing `toolchain-runtime` rule's regex and move it above `allocator`:

```typescript
    { facility: "toolchain-runtime", scaling: "paid-once", re: /__wbindgen|__wbg_|LazyLock|thread::local|LocalKey|FnOnce::call_once|core::cell::.*borrow|RefCell<.*borrow/ },
```

(Place this rule BEFORE the `allocator` rule in the array so `__wbindgen_malloc`/`__wbindgen_realloc` are caught here, not by the allocator's `malloc`/`realloc` patterns.)

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @bench/size-attr test facilities-bindgen`
Expected: PASS. Also run full `pnpm --filter @bench/size-attr test` — no regressions (existing rust/raw attribution still categorizes; if a prior test asserted `__rust_alloc`→allocator, that's unaffected — wbindgen patterns don't match it).

- [ ] **Step 5: Add `attributeRustBindgen` (name-bearing wasm-pack build, STRIP=false, twiggy the `_bg.wasm` BEFORE wasm-opt)**

In `scripts/lib/size-attr-build.ts`, add (mirrors `attributeRustRaw`; bindgen ctx treats `#[wasm_bindgen]` exports + crate path as observed):

```typescript
import { rm, readdir } from "node:fs/promises";
import { wasmPackPath } from "./tool-paths.js";

function rustBindgenObservedCtx(c: BinaryCombination): CategorizeCtx {
    return {
        exportNames: new Set([
            "alloc", "load_input", "reset", "wasm_memory",
            c.sourceBench, "matmul",
            `${c.sourceBench}_insert`, `${c.sourceBench}_lookup`, `${c.sourceBench}_delete`,
            `${c.sourceBench}_insert_reset`, `${c.sourceBench}_lookup_reset`, `${c.sourceBench}_delete_reset`,
        ]),
        workloadPrefixes: [`${c.sourceBench}`, "matmul_shared::", "parse_pairs", "with_slices"],
    };
}

export async function attributeRustBindgen(
    c: BinaryCombination,
    productionTotal: ProductionTotal,
): Promise<SizeComposition | null> {
    const crateDir = `benches/${c.sourceBench}/rust/bindgen`;
    const profile = c.profile === "speed" ? "release" : "release-size";
    const pkgDir = join(crateDir, "pkg-attr");
    await rm(pkgDir, { recursive: true, force: true });
    // Name-bearing: STRIP=false keeps the wasm name section; wasm-pack's internal
    // wasm-opt is disabled via Cargo metadata, so _bg.wasm is pre-opt + named.
    await run(wasmPackPath(), ["build", "--target=web", `--${profile === "release" ? "release" : "profiling"}`, "--out-dir=pkg-attr"], {
        cwd: crateDir,
        env: { [stripEnvKey(profile)]: "false" },
    });
    const files = await readdir(pkgDir);
    const wasmFile = files.find((f) => f.endsWith("_bg.wasm"));
    if (!wasmFile) {
        return null;
    }
    const wasm = join(pkgDir, wasmFile);
    const json = await capture(twiggyPath(), ["top", "-f", "json", "-n", "1000", wasm]);
    const rows = parseTwiggyJson(json);
    const composition = buildComposition(rows, rustBindgenObservedCtx(c), productionTotal);
    if (composition.unattributedShare > 0.5) {
        console.warn(`[size-attr] ${c.sourceBench} ${c.toolchain}/${c.profile}: bindgen attribution unusable (unattributed ${(composition.unattributedShare * 100).toFixed(1)}%); writing null.`);
        return null;
    }
    return composition;
}
```

NOTE on `--profiling`: `wasm-pack build --profiling` keeps names + debug for the size profile’s base build. If `--release` already keeps names with `STRIP=false`, prefer `--release` for both and drop the `--profiling` branch. **Probe in Step 6 decides.**

- [ ] **Step 6: Probe name survival (verify `_bg.wasm` has names before wiring)**

Run (dangerouslyDisableSandbox):
```bash
cd benches/matmul/rust/bindgen && CARGO_PROFILE_RELEASE_STRIP=false $(node -e "...wasmPackPath") build --target=web --release --out-dir=pkg-attr
twiggy top -f json -n 50 pkg-attr/*_bg.wasm | grep -c '"code\['
```
Expected: `0` anonymous `code[N]` (names present). If nonzero → switch to `--profiling`, or add `--keep-debug`; re-probe. Document the working flag in a code comment.

- [ ] **Step 7: Wire into `buildBindgen`**

In `scripts/build-rust.ts`: import `attributeRustBindgen`; replace `composition: null` (line ~95) with:

```typescript
    const composition = await attributeRustBindgen(c, {
        rawBytes: wasmStat.rawBytes, gzipBytes: wasmStat.gzipBytes, brotliBytes: wasmStat.brotliBytes,
    });
```
(declare `const composition = ...` before the `meta` object, set `composition` in meta).

- [ ] **Step 8: Build + verify composition not null**

Run (dangerouslyDisableSandbox): `pnpm build:rust matmul hashmap_string`
Then: `node -e 'const m=require("./dist/matmul/rust-bindgen-size/meta.json"); console.log("unattr%", (m.composition?.unattributedShare*100).toFixed(2))'`
Expected: composition present, unattributed < 50% (target single digits).

- [ ] **Step 9: gitignore pkg-attr; commit**

Ensure `pkg-attr/` is gitignored (add to `benches/*/rust/bindgen/.gitignore` or root `.gitignore` if `pkg-tmp` already is — mirror it).
```bash
git add packages/size-attr scripts/lib/size-attr-build.ts scripts/build-rust.ts .gitignore
git commit --no-gpg-sign -m "feat(size-attr): rust/bindgen facility attribution (wbindgen glue -> toolchain-runtime)"
```

---

## Task 2 [I]: PATH hygiene for cpp/wasi-sdk attr build

**Files:**
- Modify: `scripts/build-cpp.ts` (`buildWasiSdk` — drop `.tools/bin` from PATH, pass `WASM_OPT` abspath, isolated attr-output dir)
- Modify: `benches/hashmap_string/cpp/build-wasi-sdk.sh` (use `$WASM_OPT`; write attr to `$ATTR_OUT`)
- Modify: `scripts/lib/size-attr-build.ts` (`attributeWasiSdk` reads from isolated attr path)

**Interfaces:**
- Consumes: `wasmOptPath()` from `./tool-paths.js` (abspath to wasm-opt); existing `attributeWasiSdk(c, attrDir, productionTotal)`.
- Produces: wasi-sdk builds where the attr clang invocation does NOT see `wasm-opt` on PATH → name section survives.

- [ ] **Step 1: Root-cause recap (no test — integration-verified)**

Root cause (spec § Root-cause): with `.tools/bin` on PATH, wasi-sdk clang `-flto` auto-runs `wasm-opt` post-link, stripping the name section. Fix: don't put `.tools/bin` on PATH for the wasi-sdk build; give the script's explicit production `wasm-opt` an absolute path via `WASM_OPT` env.

- [ ] **Step 2: `build-cpp.ts buildWasiSdk` — remove toolsBin from PATH, pass WASM_OPT abspath + isolated attr dir**

In `scripts/build-cpp.ts`, `buildWasiSdk`, replace the env block:

```typescript
    const attrDir = resolve("target/attr-cpp", `${c.sourceBench}-${c.toolchain}-${c.profile}`);
    await mkdir(attrDir, { recursive: true });
    await run("bash", [script, c.profile, resolve(out)], {
        env: {
            WASI_SDK_PATH: wasiSdkPath(),
            SIZE_ATTR: "1",
            WASM_OPT: wasmOptPath(),       // absolute path; script no longer relies on PATH
            ATTR_OUT: attrDir,             // name-bearing attr.wasm goes here, not dist
            // NOTE: .tools/bin intentionally NOT prepended to PATH — otherwise wasi-sdk
            // clang auto-runs wasm-opt during -flto link and strips the name section.
        },
    });
```
Remove the `toolsBin`/`mergedPath` lines in `buildWasiSdk`. Import `wasmOptPath` from `./lib/tool-paths.js`.

- [ ] **Step 3: `attributeWasiSdk` reads from ATTR_OUT (isolated), not dist**

In `scripts/lib/size-attr-build.ts`, change `attributeWasiSdk` signature to take the attr dir:
```typescript
export async function attributeWasiSdk(
    c: BinaryCombination,
    attrDir: string,
    productionTotal: ProductionTotal,
): Promise<SizeComposition | null> {
    const named = join(attrDir, "module.attr.wasm");
    // ... rest unchanged (existsSync guard, twiggy, buildComposition, >0.5 null guard)
```
Update the call in `build-cpp.ts buildWasiSdk` to pass `attrDir` instead of `out`.

- [ ] **Step 4: `hashmap_string/cpp/build-wasi-sdk.sh` — use `$WASM_OPT` + write attr to `$ATTR_OUT`**

Production `wasm-opt` line → `"${WASM_OPT:-wasm-opt}" -Oz ...`. SIZE_ATTR block: output `-o "${ATTR_OUT:-$OUT_DIR}/module.attr.wasm"`; ensure `mkdir -p "${ATTR_OUT:-$OUT_DIR}"` first. Remove the now-obsolete comment block claiming "MUST stay flat, NOT a shared helper" (that was the misdiagnosis — real cause was PATH/wasm-opt); replace with a one-line note: `# attr build keeps names because build-cpp.ts runs us WITHOUT wasm-opt on PATH (else clang -flto auto-runs it and strips names). Do NOT add -g (DWARF also suppresses the name subsection).`

- [ ] **Step 5: Build + verify wasi-sdk composition not null**

Run (dangerouslyDisableSandbox): `pnpm build:cpp hashmap_string`
Then: `node -e 'const m=require("./dist/hashmap_string/cpp-wasi-sdk-size/meta.json"); console.log("unattr%", (m.composition?.unattributedShare*100).toFixed(2), "facilities", m.composition?.facilities?.length)'`
Expected: composition present, unattributed ≈ 0.66%, facilities ≈ 8. And `dist/hashmap_string/cpp-wasi-sdk-size/module.attr.wasm` should NOT exist (attr now in `target/attr-cpp/`).

- [ ] **Step 6: Production byte-identity gate**

Compare `meta.wasm.hashSha256` for `cpp-wasi-sdk-size` + `-speed` against the Wave-0 baseline.
Expected: IDENTICAL (production binary unchanged; only attr path + PATH changed).

- [ ] **Step 7: Commit**

```bash
git add scripts/build-cpp.ts scripts/lib/size-attr-build.ts benches/hashmap_string/cpp/build-wasi-sdk.sh .gitignore
git commit --no-gpg-sign -m "fix(size-attr): PATH hygiene for cpp/wasi-sdk attr build (no wasm-opt on PATH -> name section survives)"
```

---

## Task 3 [I]: Roll out attr-build branch to remaining wasi-sdk scripts

**Files:**
- Modify: `benches/{matmul,interop_calls,hashmap_int,shape_dispatch_homo_static,shape_dispatch_homo_dyn,shape_dispatch_mixed_static,shape_dispatch_mixed_dyn}/cpp/build-wasi-sdk.sh`

**Interfaces:**
- Consumes: `WASM_OPT`, `ATTR_OUT`, `SIZE_ATTR` env (from Task 2 build-cpp.ts).
- Produces: every wasi-sdk workload emits a name-bearing `module.attr.wasm` → real composition.

- [ ] **Step 1: For each of the 7 scripts, apply the same transform as hashmap_string**

Per script (mechanical, identical pattern; exports differ per workload — copy from that script's own production `-Wl,--export=...` lines):
1. Production `wasm-opt` line (size profile) → `"${WASM_OPT:-wasm-opt}"`.
2. Append the SIZE_ATTR block: the production `clang++` invocation **minus `-Wl,--strip-all`**, output to `"${ATTR_OUT:-$OUT_DIR}/module.attr.wasm"`, wrapped in `if [[ "${SIZE_ATTR:-0}" == "1" ]]; then ... fi`, with `mkdir -p "${ATTR_OUT:-$OUT_DIR}"`. Same exports as that script's production block. No `-g`. No `wasm-opt` (and clang won't auto-run it — `.tools/bin` not on PATH).

Reference template (matmul example — adapt exports + sources per script):
```bash
if [[ "${SIZE_ATTR:-0}" == "1" ]]; then
  mkdir -p "${ATTR_OUT:-$OUT_DIR}"
  "$WASI_SDK_PATH/bin/clang++" \
    --target=wasm32-wasi $STD_FLAG $WARN_FLAGS -DNDEBUG -nostdlib $OPT \
    -fno-exceptions -fno-rtti -fvisibility=hidden -mbulk-memory \
    "$HERE/src/<workload>.cpp" "$HERE/src/wasi-shims.cpp" \
    "$SYSROOT_LIB/libc++.a" "$SYSROOT_LIB/libc++abi.a" "$SYSROOT_LIB/libc.a" "$WASI_BUILTINS" \
    -Wl,--no-entry <SAME --export= lines as production block> -Wl,--export-memory \
    -o "${ATTR_OUT:-$OUT_DIR}/module.attr.wasm"
fi
```
(Some workloads omit `wasi-shims.cpp` or have different sources — copy the exact source/lib args from that script's production invocation.)

- [ ] **Step 2: Build all wasi-sdk + verify each composition not null**

Run (dangerouslyDisableSandbox): `pnpm build:cpp matmul interop_calls hashmap_int shape_dispatch_homo_static shape_dispatch_homo_dyn shape_dispatch_mixed_static shape_dispatch_mixed_dyn`
Then for each, check `meta.composition` present and `unattributedShare < 0.5`:
```bash
for d in dist/*/cpp-wasi-sdk-size/meta.json; do node -e "const m=require('./$d'); console.log('$d', m.composition? (m.composition.unattributedShare*100).toFixed(1)+'%':'NULL')"; done
```
Expected: all show a percentage (none `NULL`). Any `NULL` → that script's attr block has a flaw (likely a mismatched export/source arg) → fix per Step 1.

- [ ] **Step 3: Production byte-identity gate (all wasi-sdk)**

Verify every `cpp-wasi-sdk-*` `meta.wasm.hashSha256` matches Wave-0 baseline. Expected: identical.

- [ ] **Step 4: Commit**

```bash
git add benches/*/cpp/build-wasi-sdk.sh
git commit --no-gpg-sign -m "feat(size-attr): roll out name-bearing attr build to all cpp/wasi-sdk workloads"
```

**BREAK-POINT:** wasi-sdk fully attributed — recommend `/finish-session` (user decides).

---

## Task 4 [S]: Reporter glue-band (honest shipped total for bindgen/emscripten)

**Files:**
- Modify: `packages/reporter/src/size-data.ts` (`SizeBinary.glue`)
- Modify: `packages/reporter/src/size-view-model.ts` (glue segment, band `glue`)
- Modify: `packages/reporter/src/render-size.ts` (`.seg-glue` CSS + legend)
- Test: `packages/reporter/tests/size-view-model.test.ts` (glue segment), `packages/reporter/tests/size-data.test.ts` (glue carried)

**Interfaces:**
- Consumes: `ArtifactMeta` (`m.jsGlue: {rawBytes,gzipBytes,brotliBytes,hashSha256} | null`, `m.wasm`, `m.composition`).
- Produces: `SizeBinary.glue: CellBytes | null`; `Band` adds `"glue"`; bar total = wasm + glue; glue segment uses measured `jsGlue` bytes (NOT a wasm-ratio).

- [ ] **Step 1: Failing test — glue segment appears with measured bytes; facility gz uses wasm total, not wasm+glue**

In `packages/reporter/tests/size-view-model.test.ts`, add:

```typescript
import { buildSizeViewModel } from "../src/size-view-model.js";

it("adds a glue band from measured jsGlue (not derived from wasm)", () => {
    const data = { binaries: [{
        id: "x", language: "rust", toolchain: "bindgen", profile: "size",
        label: "rust/bindgen/size", isJs: false,
        totals: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 400 },     // wasm only
        glue: { rawBytes: 5000, gzipBytes: 1500, brotliBytes: 1300 },     // measured glue
        composition: {
            source: "pre-opt-twiggy", productionTotal: { rawBytes: 1000, gzipBytes: 500, brotliBytes: 400 },
            preOptTotalBytes: 1000, calibrationFactor: 1, unattributedShare: 0,
            facilities: [{ facility: "observed", scaling: "observed", share: 1, approxBytes: 1000 }],
        },
    }] };
    const vm = buildSizeViewModel(data as never);
    const glue = vm.binaries[0]!.segments.find((s) => s.facility === "glue (JS)");
    expect(glue).toBeDefined();
    expect(glue!.band).toBe("glue");
    expect(glue!.rawBytes).toBe(5000);     // measured, not 1000*ratio
    expect(glue!.gzBytes).toBe(1500);
});
```

- [ ] **Step 2: Run test — expect FAIL** (`glue` not on type, no glue segment)

Run: `pnpm --filter @bench/reporter test size-view-model`
Expected: FAIL (compile error on `glue` / segment undefined).

- [ ] **Step 3: `size-data.ts` — carry glue**

In `packages/reporter/src/size-data.ts`, add to `SizeBinary`: `glue: { rawBytes: number; gzipBytes: number; brotliBytes: number } | null;`. In `buildSizeData`, set `glue: m.jsGlue ? { rawBytes: m.jsGlue.rawBytes, gzipBytes: m.jsGlue.gzipBytes, brotliBytes: m.jsGlue.brotliBytes } : null`. Keep `totals` = wasm (`stat`) as the composition-calibration anchor.

- [ ] **Step 4: `size-view-model.ts` — add `"glue"` band + append glue segment in BOTH paths**

Add `"glue"` to `Band`. In `BAND_ORDER`: `{ floor: 0, glue: 1, observed: 2, unattributed: 3, unknown: 4 }`. Add a helper that pushes a glue segment (facility `"glue (JS)"`, scaling `"paid-once"`, band `"glue"`, bytes from `b.glue`) when `b.glue` is present — call it at the end of BOTH the no-composition and composition branches of `modelFor`, before the `sort`. Facility gz/brotli stay `f.share * b.totals.*` (wasm) — unchanged. The displayed bar total = segment sum = wasm facilities + glue (correct, measured).

```typescript
function withGlue(segments: Segment[], b: SizeBinary): Segment[] {
    if (!b.glue) { return segments; }
    return [...segments, {
        facility: "glue (JS)", scaling: "paid-once", band: "glue" as Band,
        rawBytes: b.glue.rawBytes, gzBytes: b.glue.gzipBytes, brotliBytes: b.glue.brotliBytes,
        share: 0,
    }];
}
```
Apply: composition branch `segments` and no-comp branch `segments` → `withGlue(segments, b)` before sort/return.

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm --filter @bench/reporter test size-view-model`
Expected: PASS. Run full `pnpm --filter @bench/reporter test` — fix any snapshot/segment-count assertions that now include the glue segment.

- [ ] **Step 6: `render-size.ts` — `.seg-glue` color + legend entry**

In `SIZE_CSS` add `.seg-glue { background: #d8c27a; }` (amber, distinct from floor blue/observed green). In `controls()` legend, append: `<span class="legend-band" style="background:#d8c27a"></span>glue (JS) `. The render JS already sums all `.seg` by `data-raw/gz/brotli`, so the glue segment is included automatically.

- [ ] **Step 7: Commit**

```bash
git add packages/reporter
git commit --no-gpg-sign -m "feat(reporter): glue (JS) band for bindgen/emscripten — bar = wasm + measured glue"
```

---

## Task 5 [S]: cpp/emscripten attribution (name-preservation probe + fallback)

**Files:**
- Modify: `benches/*/cpp/build-emscripten.sh` (name-preservation flag under SIZE_ATTR)
- Modify: `scripts/lib/size-attr-build.ts` (`attributeEmscripten`)
- Modify: `scripts/build-cpp.ts` (`buildEmscripten` — wire composition, pass SIZE_ATTR + ATTR_OUT)

**Interfaces:**
- Consumes: `buildComposition`, `parseTwiggyJson`, `capture`, `twiggyPath`; `cppObservedCtx` (reuse from this file).
- Produces: `attributeEmscripten(c, attrDir, productionTotal): Promise<SizeComposition | null>` — real composition if names survive emcc, else `null` (section-only fallback).

- [ ] **Step 1: Probe — does emscripten keep names with `-g2` / `--profiling-funcs`?**

Manually build one emscripten attr wasm with name-preservation and check (dangerouslyDisableSandbox). Pick the flag empirically:
```bash
# in benches/matmul/cpp, adapt build-emscripten.sh to add `-g2` (or `--profiling-funcs`) to a throwaway output
# then:
twiggy top -f json -n 50 <attr>.wasm | grep -c '"code\['
```
Expected: `0` anonymous → names survive. Record which flag works (`-g2` keeps the name section without full DWARF; `--profiling-funcs` keeps function names). If NEITHER yields names → emscripten stays section-only (`composition: null`), document, and SKIP Steps 3-5 (only wire the glue-band via Task 4, which already covers emscripten glue).

- [ ] **Step 2: Add name-preservation flag under SIZE_ATTR in build-emscripten.sh (all emscripten workloads)**

Add a SIZE_ATTR branch emitting a name-bearing `module.attr.wasm` to `${ATTR_OUT:-$OUT_DIR}` with the working flag from Step 1, mirroring the production emcc command but adding the name-preservation flag and NOT overwriting `glue.wasm`. (Emscripten always runs Binaryen; the flag tells it to keep names.)

- [ ] **Step 3: Add `attributeEmscripten`**

In `scripts/lib/size-attr-build.ts` (reuses `cppObservedCtx`, with emscripten `_`-prefixed exports — extend ctx exportNames to include `_alloc`, `_load_input`, `_<bench>_*` forms):

```typescript
export async function attributeEmscripten(
    c: BinaryCombination,
    attrDir: string,
    productionTotal: ProductionTotal,
): Promise<SizeComposition | null> {
    const named = join(attrDir, "module.attr.wasm");
    if (!existsSync(named)) {
        return null;
    }
    const json = await capture(twiggyPath(), ["top", "-f", "json", "-n", "1000", named]);
    const composition = buildComposition(parseTwiggyJson(json), emscriptenObservedCtx(c), productionTotal);
    if (composition.unattributedShare > 0.5) {
        console.warn(`[size-attr] ${c.sourceBench} ${c.toolchain}/${c.profile}: emscripten attribution unusable (unattributed ${(composition.unattributedShare * 100).toFixed(1)}%); writing null.`);
        return null;
    }
    return composition;
}
```
Add `emscriptenObservedCtx(c)` — same as `cppObservedCtx` but exportNames carry `_`-prefixed forms (`_alloc`, `_load_input`, `_${c.sourceBench}_insert`, …) per the emscripten EXPORTED_FUNCTIONS convention; add an emscripten-runtime rule to `facilities.ts` if `_emscripten_`/`stackSave`/`emscripten_` symbols land in `unattributed` (probe-driven).

- [ ] **Step 4: Wire into `buildEmscripten` (pass SIZE_ATTR/ATTR_OUT, set composition)**

In `scripts/build-cpp.ts buildEmscripten`: add `SIZE_ATTR: "1"`, `ATTR_OUT: attrDir` to env (create `attrDir` like Task 2); replace `composition: null` with `await attributeEmscripten(c, attrDir, { rawBytes: wasmStat.rawBytes, gzipBytes: wasmStat.gzipBytes, brotliBytes: wasmStat.brotliBytes })`.

- [ ] **Step 5: Build + verify (real composition OR documented section-only)**

Run (dangerouslyDisableSandbox): `pnpm build:cpp matmul hashmap_string` ; check emscripten meta.composition. Expected: real composition (unattr < 50%) OR `null` if Step 1 found names don't survive (then this is the documented fallback — acceptable per spec).

- [ ] **Step 6: Production byte-identity gate (emscripten) + commit**

Verify `cpp-emscripten-*` `meta.wasm.hashSha256` unchanged vs baseline.
```bash
git add scripts benches/*/cpp/build-emscripten.sh packages/size-attr
git commit --no-gpg-sign -m "feat(size-attr): cpp/emscripten attribution (name-preservation) or documented section-only fallback"
```

**BREAK-POINT:** all toolchains covered — recommend `/finish-session`.

---

## Task 6 [I]: Guidelines, roadmap, bug-report close, landing audit

**Files:**
- Modify: `docs/guidelines.md` (§ Artifact size — grounded cross-toolchain composition + glue cost)
- Modify: `docs/roadmap.md` (remove `size-attr-toolchain-coverage`)
- Modify: `docs/superpowers/bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md` (mark RESOLVED)

**Interfaces:** none (prose).

- [ ] **Step 1: Update `docs/guidelines.md` § Artifact size**

Add grounded claims (follow the file's format convention — read header first): cross-toolchain floor composition (rust `panic-fmt` ≈24.7% vs cpp ≈0.4%; cpp/wasi-sdk hashmap_string: allocator 44%, hash-map 21%, observed 18%); bindgen is heaviest (wasm 14–17 KB + glue ≈5.3 KB raw / ≈1.6 KB gz); **glue is a real paid-once cost for bindgen/emscripten that raw/wasi-sdk don't carry** (raw needs only a tiny generic host loader — see roadmap `size-attr-raw-host-glue`). Use real numbers from this phase's builds, not the dummy figures above — re-read meta.json after Task 5.

- [ ] **Step 2: Remove graduated roadmap entry**

In `docs/roadmap.md` TBD, delete the `size-attr-toolchain-coverage` bullet (graduated). Leave `path-hygiene-build-isolation`, `size-attr-raw-host-glue`, `size-attr-math-table`, `size-bar-per-facility-color`, `perf-view-redesign`.

- [ ] **Step 3: Mark bug-report RESOLVED**

In `docs/superpowers/bug-reports/2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md`, change Status to **RESOLVED (Phase 1.4)** and add a short root-cause section: PATH-injected `wasm-opt` auto-run by wasi-sdk clang `-flto` strips the name section; fix = PATH hygiene (build-cpp.ts no longer prepends `.tools/bin`; production wasm-opt via abspath). Confirmed end-to-end (unattributed 0.66%).

- [ ] **Step 4: Landing audit — all-gates + visual + spec-coverage**

Run (build/smoke dangerouslyDisableSandbox): `pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke`
Expected: all green, smoke 0 correctness failures.
Then `pnpm report` and OPEN the HTML: Size tab — bindgen/emscripten bars decomposed + amber glue-band; raw/wasi-sdk no glue-band; emscripten section-only honestly labelled if fallback. Note any spec § In-scope item not implemented.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit --no-gpg-sign -m "docs(size-attr): grounded cross-toolchain guidelines; close heisenbug bug-report; graduate roadmap entry"
```

---

## Self-Review

**Spec coverage:** rust/bindgen (Task 1) ✓; cpp/wasi-sdk PATH fix + rollout (Tasks 2-3) ✓; cpp/emscripten probe+fallback (Task 5) ✓; reporter glue-band (Task 4) ✓; guidelines/roadmap/bug-report (Task 6) ✓; schema unchanged (stated) ✓; out-of-scope items left to roadmap ✓.

**Placeholder scan:** facility rule, attribute functions, view-model glue, render CSS — all shown with code. Per-script rollout (Task 3) shows the exact transform + template; per-workload exports are "copy this script's own production export lines" (mechanical, not vague). emscripten flag is probe-decided (Step 1) with both candidates named + fallback path explicit.

**Type consistency:** `attributeRustBindgen`/`attributeEmscripten`/`attributeWasiSdk` all return `Promise<SizeComposition | null>`; `Band` adds `"glue"` consistently across `BAND_ORDER`, `withGlue`, CSS `.seg-glue`; `SizeBinary.glue: CellBytes | null` consumed in view-model; `ProductionTotal` shape matches `meta.wasm`.
