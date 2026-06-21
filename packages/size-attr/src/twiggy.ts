import { z } from "zod";

const RowSchema = z.object({
    name: z.string(),
    shallow_size: z.number().int().nonnegative(),
    shallow_size_percent: z.number(),
});
const OutputSchema = z.array(RowSchema);

export interface TwiggyRow { name: string; shallowSize: number; }

export function parseTwiggyJson(json: string): TwiggyRow[] {
    const rows = OutputSchema.parse(JSON.parse(json));
    return rows.map((r) => ({ name: r.name, shallowSize: r.shallow_size }));
}
