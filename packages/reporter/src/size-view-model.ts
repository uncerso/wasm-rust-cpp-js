import type { SizeBinary, SizeData } from "./size-data.js";

export type Band = "floor" | "glue" | "observed" | "unattributed" | "unknown";

export interface Segment {
    facility: string;
    scaling: string;
    band: Band;
    rawBytes: number;
    gzBytes: number;
    brotliBytes: number;
    share: number;
}

export interface BinaryViewModel {
    id: string;
    language: string;
    toolchain: string;
    profile: string;
    label: string;
    isJs: boolean;
    totals: { rawBytes: number; gzipBytes: number; brotliBytes: number };
    hasComposition: boolean;
    note: string | null;
    segments: Segment[];
}

export interface SizeViewModel {
    binaries: BinaryViewModel[];
}

export function bandOf(scaling: string): Band {
    return scaling === "observed" || scaling === "per-type" ? "observed" : "floor";
}

const BAND_ORDER: Record<Band, number> = { floor: 0, glue: 1, observed: 2, unattributed: 3, unknown: 4 };

function withGlue(segments: Segment[], b: SizeBinary): Segment[] {
    if (!b.glue) {
        return segments;
    }
    return [...segments, {
        facility: "glue (JS)", scaling: "paid-once", band: "glue" as const,
        rawBytes: b.glue.rawBytes, gzBytes: b.glue.gzipBytes, brotliBytes: b.glue.brotliBytes,
        share: 0,
    }];
}

function modelFor(b: SizeBinary): BinaryViewModel {
    const base = {
        id: b.id, language: b.language, toolchain: b.toolchain, profile: b.profile,
        label: b.label, isJs: b.isJs, totals: b.totals,
    };
    if (!b.composition) {
        const noCompBand: Band = b.isJs ? "observed" : "unknown";
        const segments = withGlue([{
            facility: b.isJs ? "js-bundle" : "(unattributed)",
            scaling: b.isJs ? "observed" : "paid-once",
            band: noCompBand,
            rawBytes: b.totals.rawBytes,
            gzBytes: b.totals.gzipBytes,
            brotliBytes: b.totals.brotliBytes,
            share: 1,
        }], b);
        return {
            ...base,
            hasComposition: false,
            note: b.isJs ? "JS bundle — all observed, floor≈0" : "facility attribution unavailable",
            segments,
        };
    }
    const c = b.composition;
    const segments: Segment[] = c.facilities.map((f) => ({
        facility: f.facility,
        scaling: f.scaling,
        band: bandOf(f.scaling),
        rawBytes: f.approxBytes,
        gzBytes: Math.round(f.share * b.totals.gzipBytes),
        brotliBytes: Math.round(f.share * b.totals.brotliBytes),
        share: f.share,
    }));
    if (c.unattributedShare > 0) {
        const attributedRaw = segments.reduce((a, s) => a + s.rawBytes, 0);
        segments.push({
            facility: "unattributed",
            scaling: "paid-once",
            band: "unattributed",
            rawBytes: Math.max(0, b.totals.rawBytes - attributedRaw),
            gzBytes: Math.round(c.unattributedShare * b.totals.gzipBytes),
            brotliBytes: Math.round(c.unattributedShare * b.totals.brotliBytes),
            share: c.unattributedShare,
        });
    }
    const allSegments = withGlue(segments, b);
    allSegments.sort((x, y) => BAND_ORDER[x.band] - BAND_ORDER[y.band] || y.rawBytes - x.rawBytes);
    return { ...base, hasComposition: true, note: null, segments: allSegments };
}

export function buildSizeViewModel(data: SizeData): SizeViewModel {
    return { binaries: data.binaries.map(modelFor) };
}

export interface CellBytes {
    rawBytes: number;
    gzBytes: number;
    brotliBytes: number;
}

export interface CrossLangRow {
    id: string;
    label: string;
    toolchain: string;
    profile: string;
    isJs: boolean;
    byFacility: Record<string, CellBytes>;
    total: CellBytes;
}

export interface WorkloadTable {
    id: string;
    facilities: string[];
    rows: CrossLangRow[];
}

export function buildCrossLangTables(vm: SizeViewModel): WorkloadTable[] {
    const byWorkload = new Map<string, BinaryViewModel[]>();
    for (const b of vm.binaries) {
        const arr = byWorkload.get(b.id) ?? [];
        arr.push(b);
        byWorkload.set(b.id, arr);
    }
    const tables: WorkloadTable[] = [];
    for (const [id, bins] of byWorkload) {
        const facilitySet = new Set<string>();
        const rows: CrossLangRow[] = bins.map((b) => {
            const byFacility: Record<string, CellBytes> = {};
            const total: CellBytes = { rawBytes: 0, gzBytes: 0, brotliBytes: 0 };
            for (const s of b.segments) {
                const cur = byFacility[s.facility] ?? { rawBytes: 0, gzBytes: 0, brotliBytes: 0 };
                cur.rawBytes += s.rawBytes;
                cur.gzBytes += s.gzBytes;
                cur.brotliBytes += s.brotliBytes;
                byFacility[s.facility] = cur;
                total.rawBytes += s.rawBytes;
                total.gzBytes += s.gzBytes;
                total.brotliBytes += s.brotliBytes;
                facilitySet.add(s.facility);
            }
            return { id, label: b.label, toolchain: b.toolchain, profile: b.profile, isJs: b.isJs, byFacility, total };
        });
        tables.push({ id, facilities: [...facilitySet].sort(), rows });
    }
    return tables;
}
