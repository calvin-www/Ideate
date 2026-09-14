import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    channel: "chrome",
  },
  webServer: {
    command: "npm run dev",
    env: { ...process.env, IDEATE_E2E: "1" },
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
