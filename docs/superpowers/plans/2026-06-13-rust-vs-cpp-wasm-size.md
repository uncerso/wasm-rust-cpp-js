# rust-vs-cpp wasm size+perf — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan — analysis/judgment-heavy, serial browser benches) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Атрибутировать побайтово разрыв raw-wasm размера `rust/raw` vs `cpp/wasi-sdk` по 8 бинарям, применить найденные size-рычаги, и для каждого замерить size↔perf трейд (L, 3 env) — вытащив confirmed guideline по обеим осям.

**Architecture:** Read-only атрибуция (`wasm-tools` section/data + `twiggy` code) → список рычагов → per-рычаг код-эксперимент с протоколом (size + perf + re-eval + классификация adopt/revert) → синтез guideline. Spec: [`2026-06-13-rust-vs-cpp-wasm-size-design.md`](../specs/2026-06-13-rust-vs-cpp-wasm-size-design.md).

**Tech Stack:** `wasm-tools` (установлен), `twiggy` (global, ставится в W0), wasi-sdk clang, cargo (wasm32-unknown-unknown), pnpm bench harness (`run-matrix`, `--benchmarks=` фильтр), eval-mode.

---

## Pre-flight notes (read once)

- **Sandbox:** `pnpm build:*` / `bench` / `smoke` / любой `tsx` биндят Unix-pipe → запускать с `dangerouslyDisableSandbox: true` (CLAUDE.md § Tooling gotchas). Чистые `typecheck`/`lint`/`test` работают в sandbox.
- **Логи:** писать в `$TMPDIR`, не `/tmp`. Пайплайны — `${pipestatus[1]}` (zsh) для статуса producer'а.
- **Commits:** `--no-gpg-sign`. Push/PR — действие пользователя.
- **Артефакты атрибуции** (twiggy-дампы, section-таблицы) — рабочие, в `$TMPDIR/size-attr/`; в репо персистится только синтез в guidelines.md.
- **Перф-замеры browsers (chromium/firefox)** — серийные (один Vite на :5174), долгие → запускать в фоне (`run_in_background`).

---

## Wave 0 — tooling + feasibility gate

### Task 0.1: Установить twiggy глобально

**Files:** none (global install).

- [ ] **Step 1: Install**

Run (crates.io → вероятно нужен `dangerouslyDisableSandbox: true`; если упадёт по сети — попросить пользователя `! cargo install twiggy`):
```bash
cargo install twiggy
```
Expected: `Installed package twiggy ... (executable twiggy)` в `~/.cargo/bin`.

- [ ] **Step 2: Verify + записать версию**

```bash
twiggy --version
```
Expected: `twiggy X.Y.Z`. Вписать точную версию в spec § Инструментарий (заменить «фиксируется при установке»).

- [ ] **Step 3: Подтвердить ноль следов в репо**

```bash
git -C /Users/uncerso/src/wasm-rust-cpp-js status --short
```
Expected: только spec-правка версии (Cargo.lock/Cargo.toml НЕ изменены).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-13-rust-vs-cpp-wasm-size-design.md
git commit --no-gpg-sign -m "docs(spec): pin twiggy version (W0)"
```

### Task 0.2: Feasibility — name-bearing analysis build + twiggy на rust matmul

**Files:** none (reads `target/`).

- [ ] **Step 1: Собрать name-bearing rust matmul (pre-wasm-opt, имена не срезаны)**

Production-сборка стрипает имена через wasm-opt. Берём cargo-выход ДО wasm-opt из workspace-root `target/`:
```bash
cd /Users/uncerso/src/wasm-rust-cpp-js
cargo build -p matmul-rust-raw --release --target wasm32-unknown-unknown 2>&1 | tail -3
ls -la target/wasm32-unknown-unknown/release/*.wasm
```
Expected: `.wasm` присутствует (имя крейта — проверить `Cargo.toml` matmul/rust/raw `[package].name`; подставить реальное в `-p`).
Note: имя крейта = из `benches/matmul/rust/raw/Cargo.toml`.

- [ ] **Step 2: twiggy top — подтвердить читаемые имена**

```bash
mkdir -p "$TMPDIR/size-attr"
twiggy top target/wasm32-unknown-unknown/release/<matmul-raw>.wasm | tee "$TMPDIR/size-attr/matmul-rust-twiggy-top.txt" | head -30
```
Expected: список функций с РЕАЛЬНЫМИ именами (не `code[7]`) — `core::fmt::*`, panic-символы, alloc, matmul-функции. Если только безымянные `code[N]` → имена всё-таки срезаны: fallback — добавить `[profile.release] strip=false` локально или `RUSTFLAGS="-C debuginfo=1"` rebuild; перепроверить.

- [ ] **GATE (W0):** twiggy даёт читаемую разбивку → W1 code-level атрибуция выполнима. Если нет (имена недоступны даже после fallback) — STOP, эскалировать пользователю: code-level rust-атрибуция деградирует до section-only. **Break-point — доложить результат gate.**

---

## Wave 1 — полная size-атрибуция + список рычагов

### Task 1.1: Section-split ×8 бинарей × 2 toolchain

**Files:** none (reads `dist/`).

- [ ] **Step 1: Sweep section-байтов**

```bash
cd /Users/uncerso/src/wasm-rust-cpp-js
for w in matmul interop_calls hashmap_int hashmap_string \
         shape_dispatch_homo_static shape_dispatch_homo_dyn \
         shape_dispatch_mixed_static shape_dispatch_mixed_dyn; do
  for v in rust-raw-size cpp-wasi-sdk-size; do
    f=$(ls dist/$w/$v/*.wasm 2>/dev/null | head -1)
    [ -z "$f" ] && continue
    echo "### $w / $v ($(wc -c < "$f") B)"
    wasm-tools objdump "$f" 2>/dev/null | grep -E "code|data|^  custom|globals|elem|table"
  done
done | tee "$TMPDIR/size-attr/section-split.txt"
```
Expected: на каждый бинарь — байты code/data/прочее. **Контроль:** сумма секций ≈ размер файла (header overhead мал).

- [ ] **Step 2: Построить таблицу total/code/data ×8×2**

Свести вывод в markdown-таблицу (workload | rust code/data/total | cpp code/data/total | направление). Сохранить в `$TMPDIR/size-attr/table.md`. Это черновик headline-таблицы для guidelines.

### Task 1.2: Data-content ID где data доминирует

**Files:** none.

- [ ] **Step 1: cpp shape_dispatch ×4 — подтвердить musl log-таблицу per-variant**

```bash
for w in shape_dispatch_homo_static shape_dispatch_homo_dyn \
         shape_dispatch_mixed_static shape_dispatch_mixed_dyn; do
  f=$(ls dist/$w/cpp-wasi-sdk-size/*.wasm | head -1)
  echo "### $w cpp data-size:"
  wasm-tools objdump "$f" 2>/dev/null | grep data
done
```
Expected: у всех 4 крупная (~4 KB) data-секция (musl `__log_data`, т.к. все зовут `__builtin_log`). Подтверждает: bloat = libm `log`-таблица, консистентно по вариантам.

- [ ] **Step 2: rust matmul 520 B data @0x100002 — ID содержимого**

```bash
wasm-tools print dist/matmul/rust-raw-size/*.wasm 2>/dev/null | grep "(data" | head -c 600
twiggy top target/wasm32-unknown-unknown/release/<matmul-raw>.wasm | grep -iE "data|table|const|__" | head
```
Identify: что за таблица пар мелких int (`\01\00\01\01\01\02\02\00...`). Гипотеза — компилятор-генерированная (напр. char-class/digit-таблица из числа-форматирования в panic-пути, или lookup из matmul). Зафиксировать вывод в `$TMPDIR/size-attr/notes.md`.

### Task 1.3: twiggy code-атрибуция rust (matmul + hashmap)

**Files:** none.

- [ ] **Step 1: rust matmul code breakdown**

```bash
twiggy top -n 25 target/wasm32-unknown-unknown/release/<matmul-raw>.wasm \
  | tee "$TMPDIR/size-attr/matmul-rust-top.txt"
twiggy dominators target/wasm32-unknown-unknown/release/<matmul-raw>.wasm \
  | tee "$TMPDIR/size-attr/matmul-rust-dom.txt" | head -40
```
Identify доминирующие code-контрибьюторы: panic-машинерия / `core::fmt` / alloc-bump / собственно matmul. **Калибровка:** twiggy на pre-opt сборке — это композиция, не production-байты; абсолют берём из section-split (1.1).

- [ ] **Step 2: rust hashmap_int code breakdown (опционально, если код доминирует разрыв)**

```bash
cargo build -p <hashmap-int-raw> --release --target wasm32-unknown-unknown 2>&1 | tail -2
twiggy top -n 25 target/wasm32-unknown-unknown/release/<hashmap-int-raw>.wasm \
  | tee "$TMPDIR/size-attr/hashmap-int-rust-top.txt" | head -30
```
Identify: SipHash (`RandomState`) / HashMap probe / dlmalloc / std-floor. Сверить с уже существующим std-container claim (не дублировать).

### Task 1.4: Синтез — per-workload механизм + список рычагов

**Files:** Create `$TMPDIR/size-attr/synthesis.md` (рабочий; финальная версия пойдёт в guidelines в W3).

- [ ] **Step 1: Написать per-workload нарратив**

Для каждого workload — направление + доминирующий контрибьютор + механизм. Минимум покрыть: matmul (rust code+data overhead), shape_dispatch (cpp musl-log-таблица vs rust polynomial-log, 0 imports у обоих), hashmap (оба std-floor, rust чуть выше), interop (оба минимальны).

- [ ] **Step 2: Зафиксировать список рычагов**

Таблица: рычаг | бинарь(и) | механизм | гипотетическое изменение | ожидаемая size-дельта | риск. Заранее известные: (A) cpp shape_dispatch musl-log → компактный log; (B) rust matmul fixed-overhead (контингентно twiggy-выводу 1.3); (C) rust hashmap drop staging-buffer.

- [ ] **GATE (W1):** Список рычагов готов. **Break-point — показать пользователю таблицу атрибуции + список рычагов до применения** (рычаг B контингентен; подтвердить, какие рычаги исполняем в W2).

---

## Wave 2 — применить рычаги + замерить size↔perf

### Task 2.0: Baseline perf-замер затронутых workload'ов (L, 3 env)

**Files:** Create `results/raw/2026-06-13-size-perf-baseline/` (ephemeral run).

- [ ] **Step 1: Build + baseline bench (фон, ~долго)**

`dangerouslyDisableSandbox: true`, `run_in_background: true`:
```bash
cd /Users/uncerso/src/wasm-rust-cpp-js
pnpm build:all
pnpm bench --benchmarks=shape_dispatch_homo_static,shape_dispatch_homo_dyn,shape_dispatch_mixed_static,shape_dispatch_mixed_dyn,matmul,hashmap_int,hashmap_string \
  --envs=node,chromium,firefox --sizes=L --mode=eval \
  --out=results/raw/2026-06-13-size-perf-baseline
```
Expected: 0 failures (`failures.txt` пуст/отсутствует). Сохранить warm-median + CV по затронутым (workload × {rust-raw, cpp-wasi-sdk}).

- [ ] **Step 2: Извлечь baseline-числа**

```bash
pnpm report --in=results/raw/2026-06-13-size-perf-baseline
```
Зафиксировать в `$TMPDIR/size-attr/perf-baseline.md`: per (workload, toolchain, env) warm-median + CV. Пометить ячейки с высоким CV (perf-дельта там будет «within noise»).

### Task 2.A: Рычаг A — cpp shape_dispatch musl-log → компактный log

**Files:** Modify `benches/shape_dispatch_homo_static/cpp/src/main.cpp` (+ 3 sibling, если паттерн общий) — заменить `__builtin_log`.

- [ ] **Step 1: Реализовать компактный freestanding `log`**

В `main.cpp` добавить (заменив `__builtin_log(x)` на `approx_log(x)`); кандидат — frexp-декомпозиция + минимакс-полином (степень ~6) на мантиссе:
```cpp
// Compact freestanding ln(x) — drops musl's table-based log (~4KB __log_data).
// log(x) = (e + log2(m)) * ln2, m in [1,2). Polynomial via t=(m-1)/(m+1).
static inline double approx_log(double x) {
    uint64_t bits;
    __builtin_memcpy(&bits, &x, sizeof(bits));
    int e = static_cast<int>((bits >> 52) & 0x7FF) - 1023;
    bits = (bits & 0x000FFFFFFFFFFFFFull) | 0x3FF0000000000000ull; // m in [1,2)
    double m;
    __builtin_memcpy(&m, &bits, sizeof(m));
    if (m > 1.4142135623730951) { m *= 0.5; e += 1; }              // [√½,√2)
    const double t = (m - 1.0) / (m + 1.0);
    const double t2 = t * t;
    // ln(m) = 2t(1 + t²/3 + t⁴/5 + t⁶/7 + t⁸/9 + t¹⁰/11)
    double s = 1.0/11; s = s*t2 + 1.0/9; s = s*t2 + 1.0/7;
    s = s*t2 + 1.0/5; s = s*t2 + 1.0/3; s = s*t2 + 1.0;
    return 2.0*t*s + static_cast<double>(e) * 0.6931471805599453;
}
```
Заменить три `__builtin_log(...)` → `approx_log(...)`. Убрать `libc.a` из линковки в `build-wasi-sdk.sh` если log был единственным его пользователем (проверить: `sqrt` — интринсик; если libc.a больше не нужен — удалить строки 39/52). **Если паттерн идентичен в 4 shape-крейтах — применить ко всем 4** (DRY: source у них отдельные, повторить правку).

- [ ] **Step 2: Rebuild + size-дельта**

```bash
pnpm build:cpp 2>&1 | tail -3
for w in shape_dispatch_homo_static shape_dispatch_homo_dyn shape_dispatch_mixed_static shape_dispatch_mixed_dyn; do
  echo "$w cpp size: $(wc -c < dist/$w/cpp-wasi-sdk-size/*.wasm) B"
  wasm-tools objdump dist/$w/cpp-wasi-sdk-size/*.wasm 2>/dev/null | grep data
done
```
Expected: data-секция сжалась с ~4 KB до ~0; total cpp shape ≈ 1.5–2 KB.

- [ ] **Step 3: Correctness re-eval (ГЕЙТ ТОЧНОСТИ)**

```bash
pnpm bench --benchmarks=shape_dispatch_homo_static --envs=node --sizes=S,M,L --mode=eval \
  --out=results/raw/2026-06-13-logcheck 2>&1 | tail -5
cat results/raw/2026-06-13-logcheck/failures.txt 2>/dev/null || echo "no failures"
```
Expected: 0 correctness failures (quantized checksum совпал). **Если checksum СЛОМАЛСЯ** (polynomial log недостаточно точен для ×1e6-квантования): ≤2 попытки поднять степень полинома; если всё ещё fail → STOP, **finding**: «бит-точный `log` в cpp/wasi-sdk требует musl-таблицы; 4 KB — цена точности, дешёвого рычага нет», revert правку, перейти к классификации.

- [ ] **Step 4: Perf-дельта (L, 3 env, фон)**

`dangerouslyDisableSandbox`, `run_in_background`:
```bash
pnpm bench --benchmarks=shape_dispatch_homo_static,shape_dispatch_homo_dyn,shape_dispatch_mixed_static,shape_dispatch_mixed_dyn \
  --envs=node,chromium,firefox --sizes=L --mode=eval \
  --out=results/raw/2026-06-13-size-perf-leverA
pnpm report --in=results/raw/2026-06-13-size-perf-leverA
```
Сравнить warm-median vs baseline (Task 2.0). Где CV высок — «within noise».

- [ ] **Step 5: Классификация + commit/revert**

- **pure-win** (size↓, perf within-noise-или-лучше на всех env): оставить, commit.
- **трейд** (perf↓ за пределами шума ≥1 env): revert (вернуть `__builtin_log`), записать before/after в synthesis.md как size↔perf трейд.
- **correctness-fail**: revert, записать finding (см. Step 3).

```bash
# если adopt:
git add benches/shape_dispatch_*/cpp/src/main.cpp benches/shape_dispatch_*/cpp/build-wasi-sdk.sh
git commit --no-gpg-sign -m "perf(shape_dispatch/cpp): drop musl log table via polynomial log (lever A)"
```

### Task 2.C: Рычаг C — rust hashmap drop staging-buffer

**Files:** Modify `benches/hashmap_int/rust/raw/src/lib.rs`, `benches/hashmap_string/rust/raw/src/lib.rs`.

- [ ] **Step 1: Baseline initial-memory (min pages)**

```bash
for w in hashmap_int hashmap_string; do
  echo "$w rust min-memory:"; wasm-tools print dist/$w/rust-raw-size/*.wasm 2>/dev/null | grep -E "\(memory"
done
```
Зафиксировать min pages (4 MiB ≈ 64 страницы × 64 KiB).

- [ ] **Step 2: Убрать static STAGING → natural alloc**

В обоих `lib.rs`: удалить `STAGING_SIZE`/`Staging`/`STAGING` (строки ~31-36) и `debug_assert!`-проверку (~57). `alloc()` перевести на global-allocator (`Vec`/`alloc::alloc`), зеркаля cpp `operator new`. Точный паттерн — посмотреть, как `bindgen`-вариант того же workload'а аллоцирует (`benches/hashmap_int/rust/bindgen/src/lib.rs`), и повторить. Loader-fix `89323e2` гарантирует, что detach больше не воспроизводится (re-read `memory.buffer` после alloc).

- [ ] **Step 3: Аудит sibling raw-крейтов**

```bash
grep -rnE "STAGING|static .*\[0u8;|UnsafeCell<\[u8;" benches/*/rust/raw/src/lib.rs
```
matmul/shape используют static HEAP осознанно (bump-allocator, симметрия с cpp static heap) — НЕ трогать (это design-выбор, не redundancy). Только hashmap STAGING был workaround под (исправленный) loader-баг. Зафиксировать решение в synthesis.md.

- [ ] **Step 4: Rebuild + size + initial-memory дельта + re-eval**

```bash
pnpm build:rust 2>&1 | tail -3
for w in hashmap_int hashmap_string; do
  echo "$w rust: $(wc -c < dist/$w/rust-raw-size/*.wasm) B; mem: $(wasm-tools print dist/$w/rust-raw-size/*.wasm 2>/dev/null | grep -E '\(memory')"
done
pnpm bench --benchmarks=hashmap_int,hashmap_string --envs=node --sizes=M,L --mode=eval \
  --out=results/raw/2026-06-13-stagingcheck 2>&1 | tail -5
cat results/raw/2026-06-13-stagingcheck/failures.txt 2>/dev/null || echo "no failures"
```
Expected: file-size почти не двигается (BSS не в `.wasm` — **верифицировать**); min-memory ↓ на ~64 страницы; 0 correctness failures.

- [ ] **Step 5: Perf-дельта (L, 3 env, фон) + классификация**

```bash
pnpm bench --benchmarks=hashmap_int,hashmap_string --envs=node,chromium,firefox --sizes=L --mode=eval \
  --out=results/raw/2026-06-13-size-perf-leverC
pnpm report --in=results/raw/2026-06-13-size-perf-leverC
```
Natural alloc может чуть изменить init/first-call (одноразовый `load_input`); warm `run()` не должен меняться (hot loop не аллоцирует). Классифицировать. Commit если adopt:
```bash
git add benches/hashmap_int/rust/raw/src/lib.rs benches/hashmap_string/rust/raw/src/lib.rs
git commit --no-gpg-sign -m "refactor(hashmap/rust-raw): drop redundant 4MiB staging buffer (lever C)"
```

### Task 2.B: Рычаг B — rust matmul fixed-overhead (контингентно W1)

**Files:** возможно `benches/matmul/rust/raw/src/lib.rs` / build config — определяется выводом Task 1.3.

- [ ] **Step 1: Решить по twiggy-выводу 1.3**

Если 1.3 показал устранимый контрибьютор (напр. `core::fmt` тянется panic-путём → можно ужать) — реализовать минимальное изменение (напр. убедиться panic-handler не тянет fmt; рассмотреть, нужна ли 520B data-таблица). Если доминанта неустранима без `build-std`/nightly (вне скоупа toolchain-контракта) — **зафиксировать как finding** «rust fixed-overhead ~X B irreducible на stable wasm32-unknown-unknown», рычаг не применять.

- [ ] **Step 2 (если есть изменение): size + perf + re-eval + классификация**

Тот же протокол: `pnpm build:rust` → size-дельта → `pnpm bench --benchmarks=matmul --envs=node,chromium,firefox --sizes=L --mode=eval` → re-eval → classify → commit/revert.

- [ ] **Break-point (конец W2):** Свести классификацию всех рычагов (adopt/revert/finding). **Показать пользователю** before/after size+perf сводку до записи guidelines.

---

## Wave 3 — guidelines + close

### Task 3.1: Обновить docs/guidelines.md

**Files:** Modify `docs/guidelines.md`.

- [ ] **Step 1: Headline таблица атрибуции (evidence-блок, формат B-1)**

Добавить в § Artifact size новый claim с per-workload таблицей (rust code/data/total vs cpp + направление) + механизм-нарратив. Сверить формат с существующими claim'ами (header `###`, **Evidence:**, **Caveats:**). Confirmed (≥6 workload'ов, env/size-invariant).

- [ ] **Step 2: size↔perf трейд-guideline(ы)**

На каждый рычаг — дельта обеих осей, включая негативы/findings (напр. «cpp/wasi-sdk `log` тянет 4KB musl-таблицу; polynomial-замена даёт −4KB но [perf-результат/precision-результат]»; «rust hashmap staging-buffer −64 страницы initial-memory, file-size без изменений»). Грепнуть guidelines на related terms (`log`, `staging`, `libm`, `intrinsic`) перед вставкой — не дублировать.

- [ ] **Step 3: writing-standard проверка**

Прогнать новый текст через anti-fluff (`docs/writing-standard.md`): без преамбул, числа с источником, claim фальсифицируем.

### Task 3.2: roadmap removal

**Files:** Modify `docs/roadmap.md`.

- [ ] **Step 1: Удалить graduated/выполненные items**

Удалить `rust-vs-cpp-wasm-size` (TBD) и `rust-raw-drop-staging-buffer` (§ Workload expansion) — по конвенции removal-on-completion. `benchmark-cv-stabilization` оставить.

### Task 3.3: Full pre-flight gates

- [ ] **Step 1: Все гейты** (`dangerouslyDisableSandbox` для build/smoke)

```bash
cd /Users/uncerso/src/wasm-rust-cpp-js
pnpm build:all && pnpm typecheck && pnpm lint:all && pnpm test && pnpm smoke
```
Expected: всё зелёное; smoke без correctness failures.

- [ ] **Step 2: Commit docs + финальный bench (опционально)**

```bash
git add docs/guidelines.md docs/roadmap.md
git commit --no-gpg-sign -m "docs(guidelines): rust-vs-cpp size attribution + size-perf trades (Phase 1.2)"
```

- [ ] **Break-point (конец W3):** Гейты зелёные → готово к push+PR (действие пользователя). Рекомендовать `/finish-session`.

---

## Execution Protocol

**Routing (hybrid inline/subagent):** Этот план — **преимущественно `[I]` inline** (атрибуция = интерактивное reasoning + judgment; классификация рычагов = решения; browser-бенчи серийны через один Vite). Subagent-фан-аут НЕ оправдан (рычаги нельзя гонять параллельно — общий dist/ + Vite :5174). Долгие browser-бенч-команды — `run_in_background: true`, не subagent.

- W0: `[I]`.
- W1: `[I]` (section-split = один bash-loop; twiggy + синтез = reasoning).
- W2: `[I]` код-правки + классификация; bench-команды `run_in_background`.
- W3: `[I]`.

**Static break-points (4):**
1. **Конец W0** — feasibility gate (twiggy читаем?). Доложить.
2. **Конец W1** — таблица атрибуции + список рычагов (рычаг B контингентен). Подтвердить скоуп W2.
3. **Конец W2** — сводка классификации рычагов (adopt/revert/finding). Подтвердить до guidelines.
4. **Конец W3** — гейты зелёные → handoff push+PR.

**Per-task break-check:** после каждой задачи — соответствует ли результат ожиданию шага? Если рычаг ломает корректность/гейт или perf-дельта тонет в шуме на всех env — НЕ хаммерить (≤2 попытки), зафиксировать как finding и идти дальше. Surface planned risks: если materializ-ется риск из spec § Риски (cpp-рычага нет / browser-шум / precision-fail) — эскалировать пользователю с альтернативой, не применять молча pre-planned fix.

**Retry budget:** ≤2 попытки на подход (особенно polynomial-log точность); затем STOP + rethink/finding.

---

## Self-review notes

- **Spec coverage:** W1 = § Метод (атрибуция); W2 = § Рычаги (apply+perf+classify); W3 = § Выход (guidelines+roadmap). twiggy global = Task 0.1. Все 3 env L = Task 2.0/2.A/2.C. apply-политика (pure-win/трейд) = Task 2.*.Step5. ✓
- **Placeholders:** `<matmul-raw>` / `<hashmap-int-raw>` / `<hashmap-int-raw>` — реальные имена крейтов подставляются из `Cargo.toml` в Task 0.2/1.3 (явная инструкция, не TODO). Рычаг B код контингентен W1 — задача честно сформулирована как «решить по выводу + finding если нет рычага», не скрытый placeholder.
- **Type/path consistency:** пути `benches/<w>/{rust/raw,cpp/wasi-sdk}`, `dist/<w>/<variant>/*.wasm`, run-names `results/raw/2026-06-13-*` — единообразны.
