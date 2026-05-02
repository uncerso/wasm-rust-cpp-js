import { readFile } from "node:fs/promises";

/**
 * Resolve a wasm/file URL to a Uint8Array<ArrayBuffer> regardless of whether
 * we're in Node (where fetch doesn't support file://) or a browser.
 *
 * Accepts:
 *   - http(s):// URLs (uses fetch)
 *   - file:// URLs and bare absolute filesystem paths (uses fs.readFile)
 *
 * The result is explicitly Uint8Array<ArrayBuffer> (not ArrayBufferLike) so
 * callers can pass it to WebAssembly.compile / WebAssembly.instantiate.
 */
export async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetchBytes: ${url} -> ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const path = url.startsWith("file://") ? new URL(url).pathname : url;
  const buf = await readFile(path);
  // Copy into a fresh ArrayBuffer so the result is Uint8Array<ArrayBuffer>,
  // not Uint8Array<ArrayBufferLike> (which can be SharedArrayBuffer).
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}
