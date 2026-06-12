const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:1880",
    trace: "on-first-retry",
  },
  webServer: {
    command: "env -i PATH=\"$PATH\" APP_OWNER_EMAIL=contact@saashup.com OPERATION_TIMEOUT_SECONDS=60 REGISTRY_WEBHOOK_SECRET=secret ENABLE_EDITOR=1 LOCAL_DEV_EMAIL=demo@local.test OIDC_ENABLED=false node server.js",
    url: "http://127.0.0.1:1880/admin.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
