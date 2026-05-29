const { test, expect } = require("@playwright/test");

async function openAdmin(page, config = {}) {
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
    await route.fulfill({
      status: route.request().method() === "DELETE" ? 204 : 200,
      contentType: "text/plain",
      body: "",
    });
  });

  await page.goto("/admin.html");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/admin.html");
  await page.evaluate(() => localStorage.clear());
});

test("config tab starts without a forced default profile", async ({ page }) => {
  await openAdmin(page, {});

  await expect(page.locator("#form-title")).toHaveText("Config");
  await expect(page.locator("#config_profile")).toHaveValue("");
  await expect(page.locator("#config_profile option")).toHaveText("No config saved");
  await expect(page.locator("#config_name")).toHaveValue("");
  await expect(page.locator("#netbox")).toHaveValue("");
  await expect(page.locator("#token")).toHaveValue("");
  await expect(page.locator("#deleteConfigBtn")).toBeVisible();
  await expect(page.locator("#clearBtn")).toBeHidden();
});

test("delete config removes the profile and keeps it gone after reload", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("config_profiles", JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
      },
    }));
    localStorage.setItem("current_config_profile", "production");
  });

  let webhookBody = "";
  await page.route("**/webhook?**", async (route) => {
    webhookBody = new URL(route.request().url()).searchParams.toString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });

  await openAdmin(page, {
    profile: "production",
    netbox: "https://netbox.example.com",
    token: "secret",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
      },
    }),
  });

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#deleteConfigBtn").click();

  await expect(page.locator("#notif")).toContainText('Config "production" deleted');
  await expect(page.locator("#config_profile")).toHaveValue("");
  await expect(page.locator("#config_profile option")).toHaveText("No config saved");
  expect(webhookBody).toContain("profiles=%7B%7D");

  await page.reload();
  await expect(page.locator("#config_profile")).toHaveValue("");
  await expect(page.locator("#config_profile option")).toHaveText("No config saved");
});

test("create form supports repeatable env, labels, and volumes", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();

  await expect(page.locator("[data-field='env_vars']")).toBeVisible();
  await expect(page.locator("[data-field='labels']")).toBeVisible();
  await expect(page.locator("[data-field='volumes']")).toBeVisible();

  await page.locator("#addEnvBtn").click();
  await page.locator("#addLabelBtn").click();
  await page.locator("#addVolumeBtn").click();

  await expect(page.locator("#envList .env-row")).toHaveCount(2);
  await expect(page.locator("#labelList .repeat-row")).toHaveCount(2);
  await expect(page.locator("#volumeList .repeat-row")).toHaveCount(2);

  await page.locator("#labelList .repeat-remove").last().click();
  await page.locator("#volumeList .repeat-remove").last().click();

  await expect(page.locator("#labelList .repeat-row")).toHaveCount(1);
  await expect(page.locator("#volumeList .repeat-row")).toHaveCount(1);
});

test("upgrade can submit the clean name option", async ({ page }) => {
  let recreateBody = "";

  await page.route("**/recreate", async (route) => {
    recreateBody = route.request().postData() || "";
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
      },
    }),
  });

  await page.getByRole("link", { name: "Upgrade" }).click();
  await expect(page.locator("[data-field='clean_name']")).toBeVisible();

  await page.locator("#image").fill("saashup/app");
  await page.locator("#oldversion").fill("v1.0.0");
  await page.locator("#version").fill("v1.1.0");
  await page.locator("#clean_name").check();
  await page.locator("#submitBtn").click();

  expect(recreateBody).toContain("clean_name=true");
});

test("restart image validates image and version before submit", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
      },
    }),
  });

  await page.getByRole("link", { name: "Restart" }).click();
  await page.locator("#submitBtn").click();
  await expect(page.locator("#notif")).toHaveText("Image name is required");

  await page.locator("#image").fill("saashup/app");
  await page.locator("#submitBtn").click();
  await expect(page.locator("#notif")).toHaveText("Version is required");
});

test("logs panel can go fullscreen and clear logs", async ({ page }) => {
  await openAdmin(page, {});

  await page.locator("#logsFullscreenBtn").click();
  await expect(page.locator("#logsCard")).toHaveClass(/fullscreen/);

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#clearLogsBtn").click();
  await expect(page.locator("#notif")).toContainText("Logs cleared");
});
