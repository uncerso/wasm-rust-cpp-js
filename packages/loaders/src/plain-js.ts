import type { BenchModule } from "@bench/harness";
import type { Loader, LoaderInput, LoadedModule } from "./types.js";
import { TimingRecorder, timed } from "./timings.js";

interface JsModuleFactory {
    default: (entry: string) => BenchModule;
}

export const plainJsLoader: Loader = {
    async load(input: LoaderInput): Promise<LoadedModule> {
        const tr = new TimingRecorder();
        const fetched = await timed(() => import(input.artifactUrl));
        tr.recordFetch(fetched.ms);

        const factory = fetched.value as JsModuleFactory;
        if (typeof factory.default !== "function") {
            throw new Error(`plainJsLoader: module ${input.artifactUrl} has no default export`);
        }

        const compiled = await timed(() => factory.default(input.entry));
        tr.recordCompile(compiled.ms);
        tr.recordInstantiate(0);

        return {
            module: compiled.value,
            timings: tr.finalize(),
            memoryRef: null,
            wasmRawBytes: null,
            jsGlueRawBytes: null,
        };
    },
};
