import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests for the Strata UI. ComfyUI is mocked at the network layer (see
 * tests/e2e/mock-comfy.ts), so the suite runs in about a minute without models or a GPU; the
 * app's own logic, IndexedDB, graph building and the PDF route run for real.
 * Uses the installed Chrome (no browser download): `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4787",
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    // Each test gets a fresh profile, so IndexedDB starts empty.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4787/api/config",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
