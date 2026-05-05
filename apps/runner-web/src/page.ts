import type { WorkerInput } from "./worker.js";
import type { BenchResult } from "@bench/result-schema";

// Extend window with our result slot (for Playwright polling)
declare global {
    interface Window {
        __BENCH_RESULT?: BenchResult | { error: string };
    }
}

function setStatus(msg: string) {
    const el = document.getElementById("status");
    if (el) {
        el.textContent = msg;
    }
}

// eslint-disable-next-line @typescript-eslint/require-await -- async is needed to return a Promise so .catch() works at call site
async function main() {
    const params = new URLSearchParams(location.search);
    const caseParam = params.get("case");
    if (!caseParam) {
        setStatus("idle — no ?case= param");
        return;
    }

    let input: WorkerInput;
    try {
        input = JSON.parse(atob(caseParam)) as WorkerInput;
    } catch (e) {
        setStatus(`error: bad ?case= param: ${String(e)}`);
        return;
    }

    // Wave 4: forward debug flag from main page (set by addInitScript) into the worker
    if ((globalThis as { __BENCH_DEBUG_TIMINGS__?: boolean }).__BENCH_DEBUG_TIMINGS__) {
        input.debugTimings = true;
    }

    setStatus(`running ${input.language}/${input.toolchain}/${input.profile}/${input.inputSize}…`);

    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (evt: MessageEvent<{ ok: true; result: BenchResult } | { ok: false; error: string }>) => {
        if (evt.data.ok) {
            window.__BENCH_RESULT = evt.data.result;
            setStatus(`done — checksum: ${String(evt.data.result.quality.checksum)}`);
        } else {
            window.__BENCH_RESULT = { error: evt.data.error };
            setStatus(`error: ${evt.data.error}`);
        }
        worker.terminate();
    };

    worker.onerror = (e) => {
        const msg = `worker error: ${e.message}`;
        window.__BENCH_RESULT = { error: msg };
        setStatus(msg);
        worker.terminate();
    };

    worker.postMessage(input);
}

main().catch((e) => {
    const msg = `page error: ${String(e)}`;
    window.__BENCH_RESULT = { error: msg };
    setStatus(msg);
});
