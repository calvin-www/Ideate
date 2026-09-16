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
    // Specs that exercise chat or voice assume keys are already provided;
    // tests/e2e/provider-keys.spec.ts opts out to cover the empty state.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:3000",
          localStorage: [
            {
              name: "ideate:provider-keys:v1",
              value: JSON.stringify({
                version: 1,
                gemini: "e2e-gemini",
                elevenLabsKey: "e2e-eleven",
                elevenLabsVoiceId: "e2e-voice",
              }),
            },
          ],
        },
      ],
    },
  },
  webServer: {
    command: "npm run dev",
    env: { ...process.env, IDEATE_E2E: "1" },
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
