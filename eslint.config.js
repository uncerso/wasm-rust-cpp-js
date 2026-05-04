import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default tseslint.config(
    {
        ignores: [
            "**/dist/**",
            "**/node_modules/**",
            "**/target/**",
            "**/pkg-tmp/**",
            "results/**",
            ".tools/**",
            "benches/matmul/fixtures/**",
            // emscripten output
            "**/glue.mjs",
            "**/glue.js",
        ],
    },
    {
        files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
        extends: [
            ...tseslint.configs.recommendedTypeChecked,
        ],
        plugins: {
            "@stylistic": stylistic,
        },
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        rules: {
            // Stylistic — 4-space, double quotes, semis, trailing comma multiline
            "@stylistic/indent": ["error", 4, { SwitchCase: 1 }],
            "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/comma-dangle": ["error", "always-multiline"],
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/eol-last": ["error", "always"],
            "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
            // Forbid one-line if-then
            "curly": ["error", "all"],
            // Console — global warn, OK in scripts (override below)
            "no-console": "warn",
        },
    },
    {
        // In scripts/** console.log is normal output
        files: ["scripts/**/*.ts"],
        rules: {
            "no-console": "off",
        },
    },
    {
        // bench-impl: relax type-checked, base style preserved
        files: ["benches/**/*.ts"],
        rules: {
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-call": "off",
        },
    },
    {
        // Tests — looser rules
        files: ["**/*.test.ts", "**/tests/**/*.ts"],
        rules: {
            "no-console": "off",
        },
    },
);
