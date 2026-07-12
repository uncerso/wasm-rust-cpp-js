# Phase 1.2 — sorted-map workload (`sorted_map_int`) — execution design

**Status:** ready for implementation plan
**Refines:** roadmap entry `stdlib-containers` — «sorted map» ветка ([→ § Workload expansion](../../roadmap.md); [→ design spec § Открытые вопросы](2026-05-01-wasm-benchmarks-design.md))
**Sibling template:** `hashmap_int` workload (spec [`2026-05-23-phase-1-1-2-hashmap-design.md`](2026-05-23-phase-1-1-2-hashmap-design.md) + no-glue [`2026-06-13-hashmap-stdlib-no-glue-design.md`](2026-06-13-hashmap-stdlib-no-glue-design.md)). `sorted_map_int` — near-exact сиблинг: тот же fixture-формат, state-model и матрица; меняется контейнер (hash → ordered) и набор entry (добавлен range-запрос).

## Purpose

Новый workload `sorted_map_int` меряет **ordered-контейнер под range-запрос** — то, для чего hash-map структурно непригоден. Два evidence-сигнала:

1. **Size — ordered-floor vs hash-floor.** `BTreeMap` (B-дерево) / `std::map` (RB-дерево) не тянут hash-machinery (`RandomState`/SipHash / `std::hash`). Прямое сравнение с `hashmap_int` (тот же тулчейн, тот же key-type) изолирует стоимость дерева против хеша. Гипотеза «ordered меньше» — **проверяется замером, не постулируется**.
2. **Perf — три контрастных режима.** `build` (tree-insert vs JS sort), `lookup` (ordered `O(log n)` **против** hash `O(1)` — cross-workload guideline vs `hashmap_int`), `range` (ordered-only: нативный `range()`/`lower_bound` против JS binary-search + scan).

int-ключи × S/M/L × {speed,size} × полная тулчейн-матрица → планка для **confirmed** guideline (≥2 sizes consistent signal; cross-workload contrast с hashmap).

## Scope

**In scope:**

- Новый workload-каталог `benches/sorted_map_int/` — полная матрица, как у `interop_calls`:
  `js:[idiomatic, typed-array]`, `rust:[raw, bindgen]`, `cpp:[emscripten, wasi-sdk]`, `profiles:[speed, size]`, sizes `S/M/L`.
- 3 entry: `sorted_map_int_build`, `sorted_map_int_lookup`, `sorted_map_int_range` (+ reset-компаньоны).
- `validate/reference.ts` — эталонные checksum'ы для всех 3 entry × 3 sizes.
- `spec.json` v2 (`entries: string[]` + `expectedChecksums`).
- Guidelines harvest — target ≥1 confirmed claim (ordered vs hash: size-floor и/или lookup-perf).

**Out of scope:**

- **string-ключи** (`sorted_map_string`) — отдельный кандидат, поднимаем только если int-версия даст сигнал.
- **`delete`-entry** — ordered erase не задействует range и дублирует hashmap-delete-логику; низкий маржинальный вклад.
- **no_std+alloc `BTreeMap` raw-вариант** — отдельный контролируемый size-differential (см. § Rejected + roadmap `btreemap-no-std-alloc-floor`); загрязнил бы apples-to-apples сравнение выбором аллокатора.
- **Изменения loader'ов** — оба wasm-варианта грузятся существующими loader'ами без правок (см. § Loaders).
- **prefix-sum шорткат в JS** — дал бы `O(1)` range-sum → нечестно быстрый JS; все тулчейны делают `O(log n + k)`.

**Rejected explicitly:**

- **exact-key зеркало hashmap** (insert/lookup/delete по точному ключу) — checksum'ы совпали бы с hashmap, JS выродился бы в `Map`, результат «ordered медленнее» известен. Range-запрос — то, что делает workload отличимым.
- **новый fixture-генератор** — переиспользуем `genIntPairs53` (DRY + встроенный кросс-чек, см. § Fixture).

## I/O contract

### Fixture

Переиспользуем `benches/common/fixtures.ts::genIntPairs53(n, seed)` с **теми же** параметрами, что `hashmap_int`:

| size | n (пар) | seed | bytes |
|---|---|---|---|
| S | 1000 | `0xBEEF_0001` | 16000 |
| M | 10000 | `0xBEEF_0002` | 160000 |
| L | 100000 | `0xBEEF_0003` | 1600000 |

Layout: `N` пар `(u64 key_le ∈ [0, 2^53), u64 value_le ∈ [0, 2^32))`, 16·N байт. Байт-идентична `hashmap_int` (одинаковый sha256) → `build`/`lookup` checksum'ы **обязаны** совпасть с `hashmap_int_insert`/`hashmap_int_lookup` — встроенный кросс-чек корректности. `.bin` gitignored, генерируются `pnpm fixtures`.

### Entries (3)

| entry | что делает (за `iters` операций) | checksum | reset-компаньон |
|---|---|---|---|
| `sorted_map_int_build` | строит sorted-структуру из `pairs[0..iters]` (last-wins по dup-ключу) | размер структуры (# уникальных ключей) | clear |
| `sorted_map_int_lookup` | `iters` точечных exact-key лукапов `pairs[i].key`, Σ найденных values | Σ values | no-op |
| `sorted_map_int_range` | `iters` range-запросов, каждый — Σ values в окне `[lo, hi]` | Σ по всем окнам | no-op |

**Iter-семантика:** iter-dependent; `expectedChecksum` валиден только при `N = innerIterations[size]` = `{S:1000, M:10000, L:100000}` (как `hashmap_int`).

**State-model** (как hashmap): `load_input` парсит пары в `state.pairs` **и** строит структуру. `build` пересобирает структуру (после `build_reset`→clear, чтобы каждая итерация мерила стройку с нуля); `lookup`/`range` читают уже построенную (их reset — no-op).

### Range-окно (детерминированно, cross-toolchain идентично)

Для запроса `i ∈ [0, iters)`:

```
anchor = pairs[i].key
span   = floor((2^53 / n) * WINDOW_KEYS)      // WINDOW_KEYS = 16 (spec-константа), n = число пар
lo     = anchor
hi     = min(anchor + span, 2^53 - 1)          // saturating; ключи < 2^53
Σ_i    = Σ value для всех ключей k ∈ [lo, hi] в ПОСТРОЕННОЙ (deduped, last-wins) структуре
```

- `span` подобран так, что окно содержит ~16 ключей в среднем (uniform-random ключи, плотность `n/2^53`) → cost `O(log n + k)`, тотал ограничен (L: ~10⁵ запросов × ~16 добавлений). Никакого `O(n²)`.
- Range-sum считается по **построенной** структуре (не по сырым парам): dedup last-wins, как build. Reference строит map → извлекает sorted-пары → суммирует окна тем же способом.
- Σ по всем окнам < 2^53: value < 2³², слагаемых ≤ n·WINDOW_KEYS; worst-case при L ≈ 2¹⁶·⁶·2⁴·2³² ≈ 2⁵²·⁶ < 2⁵³ (запас ~0.4 бита, тонкий но валидный; realistic mean-value 2³¹ → ~2⁵¹·⁶). → точна во всех тулчейнах в f64. **Гейт Wave-0 подтверждает фактическим замером; если Σ подойдёт к 2⁵³ вплотную — уменьшить `WINDOW_KEYS`.**

### Output

Единый скаляр-checksum на entry (нативно возвращается `double`, как hashmap): `build`→size, `lookup`→Σ values, `range`→Σ окон.

## Компоненты

### A. cpp — shared `.cpp` + 2 build-скрипта (emscripten + wasi-sdk)

`benches/sorted_map_int/cpp/src/sorted_map_int.{cpp,h}` + `wasi-shims.cpp` (trap-shim TU, паттерн от hashmap). Контейнер `std::map<uint64_t, uint64_t>`.
- build: `m.clear(); for i<iters: m[pairs[i].k] = pairs[i].v;` → `m.size()`.
- lookup: `auto it = m.find(k); if (it != end) acc += it->second;`.
- range: `auto it = m.lower_bound(lo); while (it != end && it->first <= hi) { acc += it->second; ++it; }`.

`std::map` тянет libc++ RB-tree (как `unordered_map` тянул hash-контейнер). `build-{emscripten,wasi-sdk}.sh` — копии hashmap-скриптов с новым TU-именем; wasi-sdk наследует shim-паттерн + wasm-opt-free PATH (build-hygiene).

### B. rust/raw — крейт `benches/sorted_map_int/rust/raw/`

`std` cdylib, ручные `#[unsafe(no_mangle)] extern "C"` экспорты, `#[allow(unsafe_code)]`. Структурная копия `hashmap_int/rust/raw` (`SyncCell<RefCell<State>>` + `LazyLock`), контейнер `std::collections::BTreeMap<u64, u64>`. range: `for (_k, v) in m.range(lo..=hi) { acc += *v as f64; }`.

### C. rust/bindgen — крейт `benches/sorted_map_int/rust/bindgen/`

`std` крейт, `#[wasm_bindgen]`-экспорты. Структурная копия `hashmap_int/rust/bindgen`, контейнер `std::collections::BTreeMap<u64, u64>`. **Отличается от raw только слоем связывания** (`#[wasm_bindgen]` + генерируемый glue vs `extern "C"` + рукописный loader); контейнер/стейт идентичны. `pkg-tmp`/`pkg-attr` через wasm-pack; size-профиль `opt-level=z` (bindgen-size finding, PR #16).

### D. js/idiomatic — `benches/sorted_map_int/js/idiomatic/`

Sorted массив пар `{key, value}` (dedup last-wins при build, затем sort по key). build → длина. lookup → binary-search exact key. range → binary-search нижней границы (`lo`) + линейный проход, пока `key <= hi`. Без prefix-sum.

### E. js/typed-array — `benches/sorted_map_int/js/typed-array/`

Параллельные `Float64Array` `keys` / `values` (u64<2^53, val<2^32 → точно в f64), отсортированы по key. Та же алгоритмика (binary-search + scan), плотное представление. Даёт intra-JS контраст object-array vs typed-arrays на range-scan.

### F. spec.json (v2)

```jsonc
{
  "id": "sorted_map_int", "version": 2,
  "description": "...ordered-map (std::map / BTreeMap / userland sorted-array) workload; range-query core...",
  "entries": ["sorted_map_int_build", "sorted_map_int_lookup", "sorted_map_int_range"],
  "inputSizes": { "S": {...}, "M": {...}, "L": {...} },   // bytes/sha256 от genIntPairs53, innerIterations 1000/10000/100000
  "expectedChecksums": {
    "sorted_map_int_build":  { "S": 1000, "M": 10000, "L": 99996 },                          // == hashmap_int_insert (та же фикстура)
    "sorted_map_int_lookup": { "S": 2078117175396, "M": 21674342192136, "L": 213944096178963 }, // == hashmap_int_lookup (определимо сейчас)
    "sorted_map_int_range":  { "S": ..., "M": ..., "L": ... }                                // вычисляется в Wave-0 reference'ом, пиннится
  },
  "supported": { "languages": ["js","rust","cpp"], "toolchains": { "js":["idiomatic","typed-array"], "rust":["raw","bindgen"], "cpp":["emscripten","wasi-sdk"] }, "profiles": ["speed","size"] },
  "ioContract": { ... }
}
```

`build`/`lookup` checksum-значения копируются из `hashmap_int/spec.json` (кросс-чек: если reference выдаст другое — баг). `range` — из reference-прогона Wave-0.

### G. Loaders — без изменений

`plain-js` (js-варианты), `rust-bindgen`, `raw-wasm` (rust/raw + cpp/wasi-sdk), `emscripten` — все возвращают унифицированный `BenchModule`; per-entry reset через `bind-reset.ts`. Новых loader'ов не нужно (маршалинг тривиальный: `u32 iters`→`f64`, данные раз через `load_input` ptr+len). `scripts/build-all.ts` авто-обнаружит workload через `glob("benches/*/spec.json")`.

## Поток данных

`fixtures/generate.ts` → `.bin` → `load_input(ptr,len)` парсит + строит структуру → harness гоняет `<entry>(iters)` с per-entry reset → `BenchResult` (checksum сверяется с `expectedChecksums`, mismatch → correctness-fail halt) → reporter.

## Корректность

`validate/reference.ts` — TS-эталон: `parsePairs` (как hashmap), `computeBuild`/`computeLookup` (копия hashmap-логики) + `computeRange` (построить `Map` last-wins → sorted unique-пары → для каждого anchor суммировать окно тем же span-правилом). Печатает `{entry: {S,M,L}}` → значения пиннятся в `spec.json`. `build`/`lookup` — авто-кросс-чек против hashmap_int.

## Риски / Wave-0 спайки (жёсткий гейт перед полной матрицей)

1. **Range-окно: ограниченность + детерминизм.** Прогнать `reference.ts` на S/M/L; проверить (а) распределение размеров окон (нет патологических «полбазы» окон), (б) Σ range < 2^53, (в) детерминизм. Если span-правило даёт вырожденные окна (0 или тысячи ключей) — скорректировать `WINDOW_KEYS`/формулу **до** матрицы.
2. **JS-safe арифметика фактически.** Подтвердить замером, что `range`-Σ при L < 2^53 (спека рассуждает аналитически; Wave-0 меряет).
3. **cpp/wasi-sdk `std::map` под shim-сетапом.** Собрать один cpp/wasi-sdk бинарь; проверить, что libc++ RB-tree компилится с trap-shim TU и wasm имеет **только** `memory`-импорт (как hashmap unordered_map). Риск: `std::map` тянет иные libc++-символы, чем `unordered_map`.
4. **Кросс-тулчейн identity checksum.** Один бинарь на язык (rust/raw, cpp/emscripten, js/idiomatic) должен выдать `build`/`lookup` == hashmap_int и `range` == reference. Расхождение = баг раньше полной матрицы.
5. **js/typed-array binary-search.** Отдельный unit-тест паритета idiomatic ↔ typed-array ↔ reference (частая ошибка — off-by-one в нижней границе).

**Гейт:** все 5 зелёные → Wave 1 (полная матрица). Иначе STOP + rethink (retry-бюджет ≤2).

## Структура волн

- **Wave 0 — feasibility + reference.** `fixtures/generate.ts` + `validate/reference.ts`; прогнать reference (пиннит range-checksums, кросс-чек build/lookup); по одному спайку на риск 3/4/5 (один cpp/wasi-sdk, один rust/raw, оба js). Гейт выше.
- **Wave 1 — полная матрица.** Все крейты/скрипты/js-варианты + `spec.json` + `build:all` + node-корректность по всей матрице (все combos × S чисто, `failures.txt` пуст).
- **Wave 2 — bench + guidelines + close.** `bench:all` (user-действие для heavy-прогона по договорённости) → reporter eyeball (size-бар + perf-табы новый workload) → harvest ≥1 confirmed claim в `docs/guidelines.md` (ordered vs hash) → roadmap-апдейт (снять stdlib-containers/sorted-map ветку) → PR.

## Тестирование

- Unit: `reference.ts` детерминизм; idiomatic↔typed-array↔reference паритет (риск 5).
- Матрица: node-корректность все (toolchain × entry × S) — checksum == pinned.
- Все существующие гейты: `pnpm build:all && typecheck && lint:all && test && smoke`.

## References

- Sibling: `hashmap_int` (`benches/hashmap_int/`), specs `2026-05-23-phase-1-1-2-hashmap-design.md`, `2026-06-13-hashmap-stdlib-no-glue-design.md`.
- Core contracts: `docs/superpowers/specs/2026-05-01-wasm-benchmarks-design.md` (§ workloads: sorted map — открытый вопрос).
- Fixtures: `benches/common/fixtures.ts::genIntPairs53`.
- Guidelines target: `docs/guidelines.md` § Artifact size (std-container floor) + perf (dispatch/lookup).
- Deferred: roadmap `btreemap-no-std-alloc-floor` (no_std+alloc size-differential).
