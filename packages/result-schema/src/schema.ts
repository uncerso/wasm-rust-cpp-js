import { z } from "zod";
import { SCHEMA_VERSION } from "./version.js";

export const InputSizeSchema = z.enum(["S", "M", "L"]);

export const LanguageSchema = z.enum(["js", "rust", "cpp"]);

export const ToolchainSchema = z.enum([
  "idiomatic",
  "typed-array",
  "raw",
  "bindgen",
  "emscripten",
  "wasi-sdk",
]);

export const ProfileSchema = z.enum(["speed", "size"]);

export const EnvSchema = z.object({
  kind: z.enum(["browser", "node"]),
  name: z.string(),
  version: z.string(),
  engine: z.string(),
});

export const MachineSchema = z.object({
  os: z.string(),
  cpu: z.string(),
  memoryGb: z.number().nonnegative(),
});

export const BenchmarkMetaSchema = z.object({
  id: z.string(),
  inputSize: InputSizeSchema,
  fixtureBytes: z.number().int().nonnegative(),
  fixtureSha256: z.string().length(64),
  language: LanguageSchema,
  toolchain: ToolchainSchema,
  profile: ProfileSchema,
  postprocess: z.array(z.string()),
});

export const ArtifactsSchema = z.object({
  wasmRawBytes: z.number().int().nonnegative(),
  wasmGzipBytes: z.number().int().nonnegative(),
  wasmBrotliBytes: z.number().int().nonnegative(),
  jsGlueRawBytes: z.number().int().nonnegative(),
  jsGlueGzipBytes: z.number().int().nonnegative(),
  totalTransferGzipBytes: z.number().int().nonnegative(),
  artifactHash: z.string(),
});

export const TimingsSchema = z.object({
  fetch: z.number().nonnegative(),
  compile: z.number().nonnegative(),
  instantiate: z.number().nonnegative(),
  initTotal: z.number().nonnegative(),
  firstCall: z.number().nonnegative(),
  warmMedian: z.number().nonnegative(),
  warmP95: z.number().nonnegative(),
  warmP99: z.number().nonnegative(),
  warmStddev: z.number().nonnegative(),
  warmMin: z.number().nonnegative(),
  warmMax: z.number().nonnegative(),
  endToEndMedian: z.number().nonnegative(),
});

export const MemorySchema = z.object({
  wasmMemoryBytesPeak: z.number().int().nonnegative(),
  wasmMemoryDeltaBytes: z.number().int(),
  jsHeapUsedAfter: z.number().int().nullable(),
});

export const StatsSchema = z.object({
  nSamples: z.number().int().positive(),
  cv: z.number().nonnegative(),
  noisy: z.boolean(),
});

export const QualitySchema = z.object({
  checksum: z.union([z.string(), z.number()]),
  validated: z.boolean(),
  correctnessFailed: z.boolean(),
});

export const NotesSchema = z.object({
  streamingInstantiation: z.boolean(),
  worker: z.boolean(),
  wasmFeatures: z.array(z.string()),
});

export const BenchResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  timestamp: z.string().datetime(),
  machine: MachineSchema,
  env: EnvSchema,
  benchmark: BenchmarkMetaSchema,
  artifacts: ArtifactsSchema,
  timingsMs: TimingsSchema,
  memory: MemorySchema,
  stats: StatsSchema,
  quality: QualitySchema,
  notes: NotesSchema,
});

export type BenchResult = z.infer<typeof BenchResultSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type Toolchain = z.infer<typeof ToolchainSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type InputSize = z.infer<typeof InputSizeSchema>;
