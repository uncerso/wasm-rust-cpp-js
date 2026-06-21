import { z } from "zod";
import { LanguageSchema, ToolchainSchema, ProfileSchema } from "./schema.js";
import { SizeCompositionSchema } from "./size-composition.js";

export const ArtifactStatSchema = z.object({
    rawBytes: z.number().int().nonnegative(),
    gzipBytes: z.number().int().nonnegative(),
    brotliBytes: z.number().int().nonnegative(),
    hashSha256: z.string(),
});

export const ArtifactMetaSchema = z.object({
    combination: z.object({
        benchmarkId: z.string(),
        language: LanguageSchema,
        toolchain: ToolchainSchema,
        profile: ProfileSchema,
    }),
    wasm: ArtifactStatSchema.nullable(),
    jsGlue: ArtifactStatSchema.nullable(),
    jsModule: ArtifactStatSchema.nullable(),
    totalTransferGzipBytes: z.number().int().nonnegative(),
    toolchainVersions: z.record(z.string(), z.string()),
    composition: SizeCompositionSchema.nullable(),
});

export type ArtifactStat = z.infer<typeof ArtifactStatSchema>;
export type ArtifactMeta = z.infer<typeof ArtifactMetaSchema>;
