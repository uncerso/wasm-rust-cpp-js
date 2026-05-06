# performance.now() precision investigation — Wave 4

**Дата:** 2026-05-05 (started) → 2026-05-06 (finalized)
**Ветка:** feature/phase-1-0-5
**Base SHA:** 2657d4a (HEAD before Task 15)
**Tags:** `wave-3-done` (start), `wave-4-done` (after closeout commit)

---

## TL;DR

Wave 4 расследовало **20–25× FF wasm slowdown** vs Chrome, наблюдаемый в Phase 1.0.

**Главный финдинг:** Slowdown — это **artifact Playwright's patched Firefox Nightly build**,
а не свойство реального Firefox SpiderMonkey. Real Firefox (запущенный manually на той же странице
через ту же Vite dev server) показывает wasm matmul ≈ **5 ms** — эквивалентно Chrome V8.

**Полезный side-effect investigation:** добавлен Cross-Origin Isolation (COI) для Vite
dev/preview servers → высокая precision `performance.now()` (Chromium 100µs → 5µs;
Firefox 1ms → 20µs). Закоммичено отдельно (`0466c51`).

**Plan-задуманные fix'ы (Task 16 quantization fix, Task 17 Liftoff JIT pref) НЕ применены** —
Gate 1 + manual test перевернули hypothesis space до их применения. Подробности в Conclusions.

---

## Gate 1 — baseline данные (без COI, без diagnostic, dev mode, headless Playwright)

Workload: matmul M-size, quick mode (3 warmup, 5–10 samples, CV ≤ 0.05), все 10 combos.
Probe: busy-loop пока `performance.now()` не сдвинется; первая non-zero delta — резолюция.
Focus combo для сравнения: `cpp/emscripten/size`.

### Node
- resolution: ~0.0004 ms (range across runs: 0.000333–0.00125 ms; sub-microsecond, true high-res)
- per-sample timings: [5.151, 5.124, 5.136, 5.181, 4.847]
- Все sample values **fractional** (non-integer ms) — Node uses un-jittered `CLOCK_MONOTONIC`.

### Chromium (Playwright headless)
- resolution: ~0.1 ms (observed: 0.09999990463256836 и 0.10000002384185791 ms — float representation 100 µs)
- per-sample timings: [5.0, 4.9, 4.9, 4.9, 5.0]
- Все sample values — **multiples of 0.1 ms**. Chromium quantizes performance.now() до 100 µs increments (Spectre mitigation).

### Firefox (Playwright headless)
- resolution: **1 ms** (exact integer; busy-loop exits at +1.0 ms tick)
- per-sample timings: [107, 107, 106, 107, 109]
- Все sample values — **whole integers**. Firefox quantizes до 1 ms granularity in Workers.
- ⚠️ **Wasm timings ~20–25× выше** чем Node/Chromium на том же workload.

### Сравнение

| env | resolution (ms) | cpp/emscripten/size warm samples (ms) | observation |
|---|---|---|---|
| node | ~0.0004 | [5.151, 5.124, 5.136, 5.181, 4.847] | sub-µs precision, fractional values |
| chromium (Playwright) | ~0.1 | [5.0, 4.9, 4.9, 4.9, 5.0] | 100 µs quantization |
| firefox (Playwright) | **1.0** | [107, 107, 106, 107, 109] | **1 ms quantization; wasm 20× slower** |

---

## Gate 2 — quantization hypothesis (skipped on data analysis)

Plan'овская гипотеза: bumping `innerIterations` до 100 в eval mode → каждая sample ≥ 10 ms → quantization noise irrelevant.

**Не применено.** Анализ Gate 1 показал:
- FF samples (107 ms на M cpp/emscripten/size) уже много раз выше 1 ms quantization (0.9% relative error).
- Quantization — measurement precision issue, не bottleneck для этого workload.
- Real bottleneck — execution time. Bumping innerIterations:
  - Не решит execution slowdown (107 × 100 = 10.7 s/sample).
  - FF eval run превратится в ~50 минут.
  - Displayed timings × 100 (breaking change в reported metric).

Перешли к alternative diagnostic путям.

---

## Gate "COI" — cross-origin isolation (committed)

Гипотеза: COOP+COEP headers → page становится `crossOriginIsolated` → SpiderMonkey/V8 ослабляют Spectre mitigation на performance.now() → высокая precision.

**Подтверждено.** `apps/runner-web/vite.config.ts` обновлен (commit `0466c51`):

```ts
server: {
    headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
    },
},
preview: { /* same headers */ },
```

Все benchmark artifacts уже served same-origin через `publicDir`, так что `require-corp` тривиален.

| env | без COI | с COI | improvement |
|---|---|---|---|
| Chromium | 0.1 ms (100µs quant) | 5–10 µs | **20×** |
| Firefox | 1.0 ms (binary 0/1 ms) | 20 µs | **50×** |

⚠️ **COI не закрыл 20× FF wasm gap** — улучшил только measurement precision. FF M cpp/emscripten/size с COI = 104–107 ms vs Chrome 5 ms.

Diagnostic side-finding на S-size FF: без COI samples были 0/1 ms binary (workload < 1 ms quantum); с COI — реальные 0.2–0.4 ms (comparable Chrome).

---

## Gate "module vs classic worker" — refuted

Гипотеза: SpiderMonkey может subprocess module workers иначе → Liftoff stuck / no tier-up в Ion.

Test: Vite config `worker.format: "iife"` + `?worker` import suffix → real classic worker (verified).

**Result: identical numbers** module vs classic worker для всех combos. Gate refuted.

| combo (FF M-size) | module worker (ms) | classic worker (ms) |
|---|---|---|
| cpp/emscripten/size | 125–128 | 125–127 |
| cpp/wasi-sdk/speed | 97 | 97 |
| rust/raw/speed | 130 | 124 |
| rust/bindgen/speed | 127–130 | 127–130 |

> **Caveat:** Detection через `typeof importScripts === "function"` ненадёжно — `importScripts` определена в обоих типах dedicated workers (просто в module — её call throws). Worker kind detection нужно делать через `import.meta` или попытку `importScripts(...)` с catch. Не существенно для этого Gate (verification осуществили через end-to-end behavior).

---

## Gate "dev vs prod build" — partial improvement, не root cause

Гипотеза: HMR/source maps overhead в Vite dev → JS-to-wasm call site медленнее → cumulative cost через many iterations.

Test: `vite build` для runner-web → `vite preview` (с COI headers added для preview server).

Result для FF M-size:

| combo | dev | prod | delta | vs Chrome |
|---|---|---|---|---|
| cpp/emscripten/size | 125–128 | 104 | **-17%** | still 20× |
| cpp/wasi-sdk/speed | 97 | 71 | **-27%** | still 19× |
| rust/raw/speed | 130 | 124 | -5% | still 18× |
| rust/bindgen/speed | 127–130 | 125–128 | ~0% | still 18× |
| js/typed-array/speed | 12.2–13.9 | 12.5–14.3 | ~0% | ~2× |

Improvement реальный (заметнее для C++ combos), но **20× gap остаётся**. Bundling — не root cause, но **secondary improvement worth pursuing** (см. session-state, Open work A).

---

## Gate "headed vs headless Firefox" — refuted

Гипотеза: headless mode disables compositing/JIT optimizations.

Test: `firefox.launch({ headless: false })` (FF window открывается на экране при run).

Result для FF M-size:

| combo | headless | headed |
|---|---|---|
| js-idiomatic | 16.7 | 16.9 |
| cpp/emscripten | 125–128 | 127–129 |
| rust/* | 130–132 | 130–133 |
| cpp/wasi-sdk/speed | 97–104 | 98–100 |

Identical (в пределах run-to-run noise). Не root cause.

---

## ⭐ KEY FINDING — manual browser test

User вручную открыл `http://localhost:5174/?case=...&debug=1` в **обычном Firefox и Chrome** (не Playwright-controlled), скопировал DevTools console output для **cpp/emscripten/size, M-size, eval mode** (30+ samples). Несколько прогонов, в пределах погрешности.

**Numbers (mean per-sample):**

| browser | resolution | per-sample (ms) | mean |
|---|---|---|---|
| Real Chrome (manual) | 0.005 ms | 4.57–4.975 | ~4.85 |
| **Real Firefox (manual)** | **0.04 ms** | **4.74–5.24** | **~5.00** |
| Playwright Chromium (headless) | 0.005–0.010 ms | 4.9–5.0 | ~4.95 |
| **Playwright Firefox (headless)** | 0.020 ms | **104–128** | **~125** ⚠️ |

**Real Firefox практически identical Chrome (~3% slower).** No 20× SpiderMonkey vs V8 gap. The gap is Playwright-Firefox-specific.

Real Firefox files: `chrome-console.txt`, `firefox-console.txt` (в repo root, untracked — input от user'а).

---

## Investigation: Playwright Firefox internals

Inspected `~/Library/Caches/ms-playwright/firefox-1511/firefox/Nightly.app`:

- **Build:** Firefox **148.0.2 Nightly**, BuildID `20260313151409`. Patched с **Juggler** protocol (Mozilla's automation patch maintained by Playwright team — это специальная сборка, не stable Firefox).
- **Default prefs (`Contents/Resources/playwright.cfg`):** 134 prefs, **0 JIT-related**. Nothing disabling Ion/optimizing JIT explicitly.
- **Launch args:** `firefox -no-remote -headless -profile <userDataDir> -juggler-pipe -silent`. Nothing JIT-related.
- **В FF 148 Nightly default prefs (`omni.ja/greprefs.js`):** только `wasm_baselinejit` существует, **нет `wasm_optimizingjit`**.
  - Disabling baseline через `firefoxUserPrefs: { "javascript.options.wasm_baselinejit": false }` → FF выбрасывает **"no WebAssembly compiler available"** при загрузке wasm.
  - Это означает: **Ion (optimizing tier) либо не скомпилирован в этот Nightly build, либо контролируется механизмом не через prefs**. Real Firefox stable builds имеют Ion enabled by default — это объясняет manual-test paritет с Chrome.
- **executablePath = system Firefox** не работает: system FF не понимает `-juggler-pipe` (Juggler — Playwright's patch). Process exits with code 0 + "You are running in headless mode" сразу. Playwright требует patched build.

**Internal BiDi support:** `node_modules/.../playwright-core@1.59.1/lib/server/bidi/bidiFirefox.js` существует. WebDriver BiDi protocol — это standardized, supported by system Firefox через geckodriver, без необходимости Juggler patches. Но Playwright 1.59 **не exposes BiDi через public `firefox.launch()` API** — это internal/experimental.

---

## Conclusions

1. **Original 20× FF/Chrome wasm gap is Playwright-Firefox-Nightly artifact**, NOT a SpiderMonkey-vs-V8 difference. Real Firefox runs wasm at Chrome speeds. Это major correction: предыдущие interpretations Phase 1.0 results были на ложной premise.

2. **Phase 1.0 baseline numbers для FF env не репрезентативны** реальному Firefox engine performance — они отражают specific Playwright Nightly build characteristics. Useful as "automation environment under realistic constraints" reading, но **misleading if presented as "Firefox engine performance"**.

3. **COI fix is independently valuable** — improves measurement precision в обоих Chromium и Firefox без breaking change в schema. Закрывает Phase 1.0 sub-issue "FF samples were quantized to integer ms".

4. **Real automation alternatives для Firefox** (для measuring real SpiderMonkey performance):
    - **WebDriver BiDi via geckodriver** + system Firefox. Playwright 1.59 имеет `bidiFirefox.js` internally; может exposed publicly в более поздних 1.60+.
    - **Selenium WebDriver + geckodriver** — отдельная зависимость, проверенный путь.
    - **Manual runs** (как user сделал в этом investigation) — single-shot для diagnostic, без автоматизации matrix.

5. **Hypotheses, проверенные и исключённые** (но investigation процесс полезен sам по себе): timer quantization, module vs classic worker, dev vs prod build, headed vs headless mode, firefoxUserPrefs forcing Ion JIT.

---

## Handling recommendation

### Short-term — в этом Wave 4 closeout (committed на `feature/phase-1-0-5`)

✅ **Закоммичено `0466c51`:** COI fix для Vite dev/preview servers. Полезно независимо от FF investigation results.

✅ **Закоммичено `551e744`:** instrumentation (probe + per-sample log) поведением gated на `BENCH_DEBUG_TIMINGS=1` env var (Node) или `?debug=1` URL param (browser). Нет overhead когда off.

📝 **README "Известные ограничения" update нужен** (отдельный commit Wave 4 closeout):

> Browser env'ы измеряются через Playwright. Playwright поставляет patched Firefox Nightly build,
> который для wasm workloads может работать ~20× медленнее реального Firefox того же поколения
> (root cause: optimizing JIT тира не accessible в этом Nightly build — investigation
> в `docs/superpowers/notes/2026-05-05-perf-now-precision.md`). Manual runs в реальном Firefox
> показывают паритет с Chrome для matmul/M. Эта artifact'ность учитывается при интерпретации FF cells.
> Migration на BiDi+geckodriver+system Firefox — план Phase 1.0.6 / 1.1.

🔒 **Не drop'ать FF env** — текущие Playwright FF numbers всё ещё имеют value (показывают what end users get when running через Playwright tooling). Просто пометить и не интерпретировать как Firefox engine performance.

### Medium-term — Phase 1.0.6 или 1.1

Brainstorm + plan FF automation switch — см. session-state Open work B.

Рассматриваемые опции:
- **BiDi через Playwright public API** (если Playwright 1.60+ exposes).
- **Selenium WebDriver + geckodriver** dependency.
- **Dual-env**: keep `firefox` (Playwright artifact) + add `firefox-real` (BiDi).
- **Drop FF entirely** для wasm benchmarks; keep для JS-only.

### Long-term — Phase 1.1+

- Если decided on BiDi: **re-baseline всех Phase 1.0 results** для FF env (отдельный artifact).
- Update docs / charts / interpretations.
- Возможно symmetric for Chromium (хотя Playwright Chromium ≡ stable Chrome generally — проверить).

---

## Open follow-ups (carry to Phase 1.0.6+)

- Worker-kind detection через `typeof importScripts` нужно либо удалить, либо заменить на reliable check (`import.meta` test). Текущая логика misleading; в этом session не использована в final code.
- Explore Playwright 1.60+ или внутренний `bidiFirefox.js` API для system Firefox.
- Document `BENCH_DEBUG_TIMINGS=1` + `?debug=1` в README или внутренний debugging guide.
- Prod-bundle build transition — отдельная задача, не блокер для FF investigation. Дает 17-27% improvement в C++ wasm combos. См. session-state Open work A.
