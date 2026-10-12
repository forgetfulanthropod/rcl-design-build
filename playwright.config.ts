import { defineConfig } from "@playwright/test";

// E2E tests run against the dev server on the embedded PGLite database (no DATABASE_URL),
// with no mail/SMS provider keys, so magic links use the on-screen dev fallback and nothing is sent.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080",
    channel: process.env.E2E_CHROME_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:8080/login",
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          DATABASE_URL: "",
          RESEND_API_KEY: "",
          TWILIO_ACCOUNT_SID: "",
          TWILIO_AUTH_TOKEN: "",
          TWILIO_FROM: "",
        },
      },
});
