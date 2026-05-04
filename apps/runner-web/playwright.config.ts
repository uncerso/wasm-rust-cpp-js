import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "src",
    use: { headless: true },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
        { name: "firefox", use: { browserName: "firefox" } },
    ],
    webServer: { command: "pnpm dev", port: 5174, reuseExistingServer: true },
});
