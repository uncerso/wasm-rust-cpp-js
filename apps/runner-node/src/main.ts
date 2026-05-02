import { argv, exit } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCase } from "./run-case.js";
import type { Language, Toolchain, Profile, InputSize } from "@bench/result-schema";

interface CliArgs {
  benchmark: string;
  language: Language;
  toolchain: Toolchain;
  profile: Profile;
  size: InputSize;
  outDir: string;
  mode: "quick" | "eval";
}

function parse(args: string[]): CliArgs {
  const get = (name: string): string => {
    const v = args.find((a) => a.startsWith(`--${name}=`));
    if (!v) throw new Error(`missing --${name}`);
    return v.slice(name.length + 3);
  };
  return {
    benchmark: get("benchmark"),
    language: get("language") as Language,
    toolchain: get("toolchain") as Toolchain,
    profile: get("profile") as Profile,
    size: get("size") as InputSize,
    outDir: get("out"),
    mode: get("mode") as "quick" | "eval",
  };
}

async function main() {
  const a = parse(argv.slice(2));
  const config = a.mode === "quick"
    ? { warmupIterations: 3, innerIterations: 1, minSamples: 5, maxSamples: 10, cvThreshold: 0.05 }
    : { warmupIterations: 10, innerIterations: 1, minSamples: 30, maxSamples: 100, cvThreshold: 0.05 };
  const r = await runCase({
    benchmarkId: a.benchmark,
    language: a.language,
    toolchain: a.toolchain,
    profile: a.profile,
    inputSize: a.size,
    measureConfig: config,
  });
  await mkdir(a.outDir, { recursive: true });
  const fname = `${a.benchmark}__${a.language}-${a.toolchain}-${a.profile}__${a.size}__node.json`;
  await writeFile(join(a.outDir, fname), JSON.stringify(r, null, 2));
  console.log(`wrote ${join(a.outDir, fname)}`);
}

main().catch((e) => { console.error(e); exit(1); });
