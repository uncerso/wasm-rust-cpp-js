import { z } from "zod";

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
