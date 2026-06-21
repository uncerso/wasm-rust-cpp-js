import type { SizeComposition, FacilityShare } from "@bench/result-schema";
import { categorize, type CategorizeCtx } from "./facilities.js";
import type { TwiggyRow } from "./twiggy.js";

export interface ProductionTotal { rawBytes: number; gzipBytes: number; brotliBytes: number; }

export function buildComposition(
    rows: readonly TwiggyRow[],
    ctx: CategorizeCtx,
    productionTotal: ProductionTotal,
): SizeComposition {
    const byFacility = new Map<string, { bytes: number; scaling: FacilityShare["scaling"] }>();
    let preOptTotal = 0;
    let unattributedBytes = 0;
    for (const row of rows) {
        const { facility, scaling } = categorize(row.name, ctx);
        if (facility === "__excluded") {
            continue;
        }
        preOptTotal += row.shallowSize;
        if (facility === "unattributed") {
            unattributedBytes += row.shallowSize;
            continue;
        }
        const cur = byFacility.get(facility) ?? { bytes: 0, scaling };
        cur.bytes += row.shallowSize;
        byFacility.set(facility, cur);
    }
    const factor = preOptTotal === 0 ? 1 : productionTotal.rawBytes / preOptTotal;
    const facilities: FacilityShare[] = [...byFacility.entries()]
        .map(([facility, v]) => ({
            facility,
            scaling: v.scaling,
            share: preOptTotal === 0 ? 0 : v.bytes / preOptTotal,
            approxBytes: Math.round(v.bytes * factor),
        }))
        .sort((a, b) => b.approxBytes - a.approxBytes);
    return {
        source: "pre-opt-twiggy",
        productionTotal,
        preOptTotalBytes: preOptTotal,
        calibrationFactor: factor,
        unattributedShare: preOptTotal === 0 ? 0 : unattributedBytes / preOptTotal,
        facilities,
    };
}
