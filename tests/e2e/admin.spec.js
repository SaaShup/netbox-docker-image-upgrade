const { test, expect } = require("@playwright/test");

async function openAdmin(page, config = {}, templates = {}) {
  let templateStore = templates;

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

  await page.route("**/templates", async (route) => {
    if (route.request().method() === "POST") {
      templateStore = JSON.parse(route.request().postData() || "{}");
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(templateStore),
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
  await expect(page.locator("#tag")).toHaveValue("");
  await expect(page.locator("#deleteConfigBtn")).toBeVisible();
  await expect(page.locator("#clearBtn")).toBeHidden();
  await expect(page.locator("#dockerRunBtn")).toBeHidden();
  await expect(page.locator("#saveTemplateBtn")).toBeHidden();
});

test("delete config removes the profile and keeps it gone after reload", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("config_profiles", JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
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
        tag: "production",
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
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();

  await expect(page.locator("[data-field='hostname']")).toHaveCount(0);
  await expect(page.locator("#refreshInstancesBtn")).toBeHidden();
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

test("create form can import a docker run command", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#dockerRunBtn")).toBeVisible();
  await page.locator("#dockerRunBtn").click();
  await expect(page.locator("#dockerRunModal")).toBeVisible();

  await page.locator("#dockerRunInput").fill([
    "docker run -d --name guide-app --network mgmt",
    "-e APP_ENV=production --label traefik.enable=true",
    "-v guide-data:/app/data saashup/guide:v1.2.3",
  ].join(" "));
  await page.locator("#dockerRunApplyBtn").click();

  await expect(page.locator("#dockerRunModal")).toBeHidden();
  await expect(page.locator("#instance")).toHaveValue("guide-app");
  await expect(page.locator("#network")).toHaveValue("mgmt");
  await expect(page.locator("#image")).toHaveValue("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.2.3");
  await expect(page.locator("#var_env_key")).toHaveValue("APP_ENV");
  await expect(page.locator("#var_env_value")).toHaveValue("production");
  await expect(page.locator("#label_key")).toHaveValue("traefik.enable");
  await expect(page.locator("#label_value")).toHaveValue("true");
  await expect(page.locator("#volume_source")).toHaveValue("/app/data");
  await expect(page.locator("#volume_name")).toHaveValue("guide-data");
});

test("create form can save and load templates", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#saveTemplateBtn")).toBeVisible();

  await page.locator("#network").fill("mgmt");
  await page.locator("#instance").fill("guide-app");
  await page.locator("#image").fill("saashup/guide");
  await page.locator("#version").fill("v1.2.3");
  await page.locator("#var_env_key").fill("APP_ENV");
  await page.locator("#var_env_value").fill("production");
  await page.locator("#label_key").fill("traefik.enable");
  await page.locator("#label_value").fill("true");
  await page.locator("#volume_source").fill("/app/data");
  await page.locator("#volume_name").fill("guide-data");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Template name");
    await dialog.accept("Guide");
  });
  await page.locator("#saveTemplateBtn").click();
  await expect(page.locator("#notif")).toContainText('Template "Guide" saved');

  await page.evaluate(() => localStorage.removeItem("create_templates"));
  await page.reload();
  await page.getByRole("link", { name: "Create" }).click();

  await page.locator("#clearBtn").click();
  await expect(page.locator("#image")).toHaveValue("");

  await page.locator("#templateSelect").selectOption("Guide");
  await expect(page.locator("#notif")).toContainText('Template "Guide" loaded');
  await expect(page.locator("#network")).toHaveValue("mgmt");
  await expect(page.locator("#instance")).toHaveValue("guide-app");
  await expect(page.locator("#image")).toHaveValue("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.2.3");
  await expect(page.locator("#var_env_key")).toHaveValue("APP_ENV");
  await expect(page.locator("#label_key")).toHaveValue("traefik.enable");
  await expect(page.locator("#volume_source")).toHaveValue("/app/data");
});

test("upgrade can submit the clean name option", async ({ page }) => {
  let recreateBody = "";
  let imagesUrl = "";
  let countUrl = "";

  await page.route("**/recreate", async (route) => {
    recreateBody = route.request().postData() || "";
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.route("**/images?**", async (route) => {
    imagesUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route("**/containers-count?**", async (route) => {
    countUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 3 }),
    });
  });

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Upgrade" }).click();
  await expect(page.locator("[data-field='clean_name']")).toBeVisible();
  await page.locator("#refreshImagesBtn").click();
  expect(new URL(imagesUrl).searchParams.get("tag")).toBe("production");

  await page.locator("#image").fill("saashup/app");
  await page.locator("#oldversion").fill("v1.0.0");
  await expect(page.locator("#notif")).toHaveText("3 containers use saashup/app:v1.0.0");
  const countParams = new URL(countUrl).searchParams;
  expect(countParams.get("image")).toBe("saashup/app");
  expect(countParams.get("version")).toBe("v1.0.0");
  expect(countParams.get("tag")).toBe("production");
  await page.locator("#version").fill("v1.1.0");
  await page.locator("#clean_name").check();
  await page.locator("#submitBtn").click();

  expect(recreateBody).toContain("clean_name=true");
  expect(recreateBody).toContain("tag=production");
});

test("refresh hosts submits the configured tag", async ({ page }) => {
  let refreshBody = "";

  await page.route("**/refresh-hosts", async (route) => {
    refreshBody = route.request().postData() || "";
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
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Refresh" }).click();
  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#submitBtn").click();

  expect(refreshBody).toContain("tag=production");
});

test("restart image validates image and version before submit", async ({ page }) => {
  await page.route("**/containers-count?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 1 }),
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

  await page.getByRole("link", { name: "Restart" }).click();
  await page.locator("#submitBtn").click();
  await expect(page.locator("#notif")).toHaveText("Image name is required");

  await page.locator("#image").fill("saashup/app");
  await page.locator("#submitBtn").click();
  await expect(page.locator("#notif")).toHaveText("Version is required");

  await page.locator("#restart_version").fill("v1.0.0");
  await expect(page.locator("#notif")).toHaveText("1 container uses saashup/app:v1.0.0");
});

test("logs panel can go fullscreen and clear logs", async ({ page }) => {
  await openAdmin(page, {});

  const formatted = await page.evaluate(() => window.formatLogs([
    "2026-05-29T11:43:31.806Z RECREATE : curioo-city-overpass1/tiles image set to saashup/curioo-tiles:v2.7.1 (200)",
    "2026-05-29T11:43:31.900Z PULL_IMAGE : saashup/curioo-tiles:v2.7.1 on curioo-city-overpass1 requested 201",
  ].join("<br>")));
  expect(formatted).toContain("<strong>RECREATE</strong>");
  expect(formatted).toContain("curioo-city-overpass1/tiles image set");
  expect(formatted).toContain("<strong>PULL_IMAGE</strong>");

  await page.locator("#logsFullscreenBtn").click();
  await expect(page.locator("#logsCard")).toHaveClass(/fullscreen/);

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#clearLogsBtn").click();
  await expect(page.locator("#notif")).toContainText("Logs cleared");
});
