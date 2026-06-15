const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: {
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.INTEGRATION_APP_URL || "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "integration-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
