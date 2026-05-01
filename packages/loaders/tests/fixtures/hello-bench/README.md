# hello-bench

Minimal wasm module exporting the raw-wasm contract.

Re-build:

```bash
node -e 'import("wabt").then(async (m) => { const w = await m.default(); const fs = await import("node:fs"); const wat = fs.readFileSync("packages/loaders/tests/fixtures/hello-bench/hello.wat", "utf8"); const mod = w.parseWat("hello.wat", wat); const { buffer } = mod.toBinary({}); fs.writeFileSync("packages/loaders/tests/fixtures/hello-bench/hello.wasm", Buffer.from(buffer)); })'
```

The `wabt` package is in root devDependencies. The compiled `.wasm` is committed to avoid re-running this step at test time.
