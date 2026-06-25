# Pitfalls — 2026-06-25 cpp/wasi-sdk name-section (env-diff, not argv-diff)

## Tooling

### «Не воспроизводится standalone» при pipeline-фейле → дифай ENV (особенно PATH), не только argv

**What happened.** Bug-report `2026-06-21-cpp-wasi-sdk-name-section-heisenbug.md` неделю числился «механизм не изолирован»: name-bearing attr-сборка cpp/wasi-sdk через `build-wasi-sdk.sh` давала анонимные `code[N]` (~98% unattributed → `composition: null`), но **тот же argv, проигранный standalone, давал имена**. Прошлая сессия захватила 40-арговый argv, подтвердила его идентичность, исключила `-g`/`wasm-opt`/`-flto`/`$WARN_FLAGS`/TMPDIR и зафиксировала ложный дискриминатор «файл-скрипт vs `bash -c`». В дизайн-фазе Phase 1.4 (`/systematic-debugging`) корень изолирован за ~10 единично-переменных билдов: name-секция присутствует ⟺ `wasm-opt` НЕ на `PATH`. `clang -###` показал план линковки с `.tools/bin/wasm-opt` — **драйвер wasi-sdk clang при `-flto` авто-находит `wasm-opt` на PATH и прогоняет его post-link**, а `wasm-opt` без `-g` срезает name-секцию. `build-cpp.ts buildWasiSdk` инжектил `.tools/bin` в `PATH` (чтобы скрипт мог звать `wasm-opt` для production-сборки) — отсюда расхождение pipeline-vs-standalone.

**Root cause.** Дебаг сравнивал **argv**, но не **окружение**. Standalone-репро шли с дефолтным `PATH` (без `.tools/bin`) → авто-`wasm-opt` не срабатывал → имена были; pipeline инжектил `.tools/bin` → срабатывал → имён нет. Argv был идентичен, переменная сидела в `PATH`. Собственный open-question #1 того bug-report'а («diff the *environment*, not just argv: `env`, `PWD`, open fds, `umask`») указывал ровно сюда, но не был выполнен.

**Prevention.** Когда сборка/инструмент даёт разный вывод в pipeline vs standalone при якобы идентичной команде — **сравни окружение (в первую очередь `PATH`), не только argv**. Конкретно для wasm-тулинга: тул на `PATH` (`wasm-opt`) может авто-подхватываться драйвером компилятора и менять артефакт. CLAUDE.md § Tooling gotchas несёт one-liner; полный разбор — здесь. Системно: PATH-инъекции `.tools/bin` → roadmap `path-hygiene-build-isolation` (абсолютные пути к тулам вместо PATH-инъекции).

## Process

### Незакоммиченный экспериментальный флаг искажает дебаг

**What happened.** В ходе дебага в `build-wasi-sdk.sh` рабочего дерева мелькал `-g` (добавлен пользователем между сообщениями, потом удалён). `bash -x`-трасса его поймала и едва не увела диагноз в сторону `-g` (он тоже глушит name-секцию, но через DWARF — отдельный, не основной, механизм).

**Root cause.** Конкурентная правка рабочего дерева во время дебаг-сессии + чтение «текущего файла» в разные моменты дали несогласованные снимки.

**Prevention.** При дебаге, чувствительном к содержимому файла, фиксируй состояние (`git diff` / hash) в начале и не доверяй «текущему файлу» между шагами, если он может правиться извне. Воспроизводи root cause на **изолированной** копии команды (как сделали R1–R5 в `$TMPDIR`), а не на живом скрипте.
