import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scanner = fileURLToPath(new URL("./scan-markers.mjs", import.meta.url));
const marker = "› capture: tech-debt — example-gap: Fix the example";

function scan(records) {
    const dir = mkdtempSync(join(tmpdir(), "capture-markers-"));
    const transcript = join(dir, "current.jsonl");
    try {
        writeFileSync(transcript, records.map((r) => JSON.stringify(r)).join("\n") + "\ninvalid partial record\n");
        const result = spawnSync(process.execPath, [scanner, transcript], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        return JSON.parse(result.stdout);
    } finally {
        rmSync(dir, { recursive: true });
    }
}

test("collects Claude assistant markers, including inline-code wrapping", () => {
    const result = scan([
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `Done.\n\`${marker}\`` }] } },
    ]);
    assert.equal(result.count, 1);
    assert.deepEqual(result.byType["tech-debt"], [{ type: "tech-debt", slug: "example-gap", note: "Fix the example" }]);
});

test("collects Codex response markers once, ignoring duplicate event records", () => {
    const result = scan([
        { type: "event_msg", payload: { type: "agent_message", message: marker } },
        { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: marker }] } },
    ]);
    assert.equal(result.count, 1);
    assert.equal(result.byType["tech-debt"][0].slug, "example-gap");
});

test("ignores quoted user markers and tool output in both formats", () => {
    const result = scan([
        { type: "user", message: { role: "user", content: [{ type: "text", text: marker }] } },
        { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: marker }] } },
        { type: "response_item", payload: { type: "function_call_output", output: marker } },
    ]);
    assert.equal(result.count, 0);
    assert.deepEqual(result.byType, {});
});
