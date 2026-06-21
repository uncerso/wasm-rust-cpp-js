import { z } from "zod";

export const ScalingKindSchema = z.enum(["paid-once", "per-type", "observed"]);

export const FacilityShareSchema = z.object({
    facility: z.string().min(1),
    scaling: ScalingKindSchema,
    share: z.number().min(0).max(1),
    approxBytes: z.number().int().nonnegative(),
});

export const SizeCompositionSchema = z.object({
    source: z.literal("pre-opt-twiggy"),
    productionTotal: z.object({
        rawBytes: z.number().int().nonnegative(),
        gzipBytes: z.number().int().nonnegative(),
        brotliBytes: z.number().int().nonnegative(),
    }),
    preOptTotalBytes: z.number().int().nonnegative(),
    calibrationFactor: z.number().positive(),
    unattributedShare: z.number().min(0).max(1),
    facilities: z.array(FacilityShareSchema),
});

export type ScalingKind = z.infer<typeof ScalingKindSchema>;
export type FacilityShare = z.infer<typeof FacilityShareSchema>;
export type SizeComposition = z.infer<typeof SizeCompositionSchema>;
