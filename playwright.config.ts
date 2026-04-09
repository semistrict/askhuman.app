import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:15032",
  },
  webServer: {
    command: "pnpm run dev:vinext",
    port: 15032,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
  },
});
