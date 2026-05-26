# Pitfalls — V8 deopt root-cause investigation + chromedriver triage (2026-05-26)

Lessons from session `2e385e9 v8-deopt-bug-reproduce` — root-causing V8 12.4 deopt
bug at bytecode level + closing chromedriver session-loss tech-debt to roadmap.

## Process

### Ephemeral-path references in committed scripts/docs

**What happened.** Initial `docs/superpowers/bug-reports/2026-05-23-v8-deopt-repro/manual-runner.mjs`
импортировал из `dist/hashmap_int/js-idiomatic-speed/module.js` и читал
`benches/hashmap_int/fixtures/s.bin`. Оба пути gitignored (build outputs +
fixture binaries). На моей working copy эти артефакты были (после `pnpm build:js`
+ `pnpm fixtures`), и script "работал". User спросил "где запускать и что
будет" — заметил, что для fresh clone эти пути отсутствуют, script сломается
без шума. Пришлось переписывать на self-contained shape.

**Root cause.** При copy'е script'а bug-branch → master не проверил, что
transitively-referenced paths сами committed. Working-copy state маскировал
проблему. Gitignored paths внутри committed file — typical anti-pattern для
артефактов, которые думают что "ну, после build они появятся".

**Prevention.** Inline-applied в `CLAUDE.md` § "Spec & plan conventions" >
"Committed scripts/docs — ephemeral-path audit": перед commit'ом scripts или
docs, которые `import` / `read` external paths, audit каждый referenced path —
`git check-ignore <path>` выдаёт red flag для gitignored. Red flags в этом
репо: `dist/`, `target/`, `.tools/`, `benches/*/fixtures/*.bin`. Чек один
короткий, экономит ловушку для anyone running на fresh clone.
