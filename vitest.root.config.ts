import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: [
            "scripts/**/*.test.ts",
            "benches/common/**/*.test.ts",
            "benches/*/validate/**/*.test.ts",
        ],
    },
});
