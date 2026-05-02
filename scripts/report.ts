import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { aggregate, renderHtml } from "@bench/reporter";
import { BenchResultSchema } from "@bench/result-schema";

async function newestSubdir(dir: string): Promise<string> {
  const entries = await readdir(dir);
  let best: { name: string; mtimeMs: number } | null = null;
  for (const e of entries) {
    const s = await stat(join(dir, e));
    if (s.isDirectory() && (!best || s.mtimeMs > best.mtimeMs)) {
      best = { name: e, mtimeMs: s.mtimeMs };
    }
  }
  if (!best) throw new Error(`no result dirs in ${dir}`);
  return join(dir, best.name);
}

function getArg(name: string): string | undefined {
  const v = process.argv.find((a) => a.startsWith(`--${name}=`));
  return v ? v.slice(name.length + 3) : undefined;
}

async function main() {
  const inDir = getArg("in") ?? await newestSubdir("results/raw");
  const outDir = getArg("out") ?? `results/summarized/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(inDir)).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error(`no JSON results in ${inDir}`);
  const results = await Promise.all(files.map(async (f) => {
    const buf = await readFile(join(inDir, f), "utf8");
    return BenchResultSchema.parse(JSON.parse(buf));
  }));
  const html = renderHtml(aggregate(results));
  const outFile = join(outDir, "index.html");
  await writeFile(outFile, html);
  console.log(`report -> ${outFile} (${results.length} results)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
