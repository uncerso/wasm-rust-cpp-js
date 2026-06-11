#!/usr/bin/env node
// Scan a Claude Code transcript for in-session capture markers (PB6).
// Usage: node scripts/scan-markers.mjs [transcript.jsonl]
// Default: newest .jsonl in ~/.claude/projects/<cwd-slug>/
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MARKER = /^›\s*capture:\s*(\S+)\s*—\s*([^:]+):\s*(.+)$/;

function resolveTranscript(argPath) {
    if (argPath) {
        return argPath;
    }
    const slug = process.cwd().replaceAll("/", "-");
    const dir = join(homedir(), ".claude", "projects", slug);
    const files = readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files.length === 0) {
        throw new Error(`no .jsonl transcript in ${dir}`);
    }
    return files[0];
}

const path = resolveTranscript(process.argv[2]);
const markers = [];
for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) {
        continue;
    }
    let rec;
    try {
        rec = JSON.parse(line);
    } catch {
        continue;
    }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) {
        continue;
    }
    for (const block of content) {
        if (block?.type !== "text") {
            continue;
        }
        for (const textLine of block.text.split("\n")) {
            const m = MARKER.exec(textLine.trim());
            if (m) {
                markers.push({ type: m[1], slug: m[2].trim(), note: m[3].trim() });
            }
        }
    }
}
const byType = {};
for (const mk of markers) {
    (byType[mk.type] ??= []).push(mk);
}
console.log(JSON.stringify({ transcript: path, count: markers.length, byType }, null, 2));
