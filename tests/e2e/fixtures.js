const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const packageJson = require(path.join(repoRoot, "package.json"));
const appVersion = `v${packageJson.version}`;

async function openAdmin(page, config = {}, templates = {}, instances = [
  { instance: "guide-app", networks: ["bridge", "traefik-net"] },
], handleLogs, pagePath = "/admin.html") {
  let templateStore = templates;

  await page.unroute("**/config").catch(() => {});
  await page.route("**/config", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(config),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.route("**/logs", async (route) => {
    if (handleLogs) {
      await handleLogs(route);
      return;
    }

    await route.fulfill({
      status: route.request().method() === "DELETE" ? 204 : 200,
      contentType: "text/plain",
      body: "",
    });
  });

  await page.route("**/templates**", async (route) => {
    if (route.request().method() === "POST") {
      templateStore = JSON.parse(route.request().postData() || "{}");
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(templateStore),
    });
  });

  await page.route("**/registry-webhook-secret", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ secret: "hook-secret" }),
    });
  });

  await page.route("**/instances?**", async (route) => {
    const body = typeof instances === "function" ? instances(route) : instances;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.goto(pagePath);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__test_storage_cleared__")) {
      localStorage.clear();
      sessionStorage.setItem("__test_storage_cleared__", "true");
    }
  });
  await page.route("**/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("/admin.html");
  await expect(page.locator("#form-title")).toHaveText("Config");
});

module.exports = { test, expect, fs, openAdmin, appVersion, packageJson };
