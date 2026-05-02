import { readFile } from "node:fs/promises";
import { capture } from "./exec.js";

export async function readPinned(): Promise<Record<string, string>> {
  const buf = await readFile("tool-versions.json", "utf8");
  const obj = JSON.parse(buf) as Record<string, string>;
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "comment"));
}

export async function detectActual(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try { out.rustc = (await capture("rustc", ["--version"])).trim(); } catch {}
  try { out["wasm-pack"] = (await capture("wasm-pack", ["--version"])).trim(); } catch {}
  try { out["wasm-opt"] = (await capture("wasm-opt", ["--version"])).trim(); } catch {}
  try {
    const emccOut = await capture("emcc", ["--version"]);
    const firstLine = emccOut.split("\n")[0];
    if (firstLine) out.emcc = firstLine.trim();
  } catch {}
  out.node = process.version;
  return out;
}
