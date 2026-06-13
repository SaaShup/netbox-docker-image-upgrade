const { test, expect, openAdmin } = require("./fixtures");

const visualConfig = {
  config_profile: "demo",
  config_name: "demo",
  customer_name: "SaaShup Demo",
  netbox: "https://netbox.example.com",
  token: "secret",
  domain: "daily.paashup.cloud",
  tag: "DEMO",
  enrollment_limit: 2,
  owner_env_var: "APP_OWNER_EMAIL",
  cloudflare_filter: "saashup",
  smtp_config: "mailer:smtp-secret@smtp.example.com:587",
  profile: "demo",
  profiles: JSON.stringify({
    demo: {
      config_name: "demo",
      customer_name: "SaaShup Demo",
      netbox: "https://netbox.example.com",
      token: "secret",
      domain: "daily.paashup.cloud",
      tag: "DEMO",
      max_instances: 2,
      enrollment_limit: 2,
      owner_env_var: "APP_OWNER_EMAIL",
      cloudflare_filter: "saashup",
      smtp_config: "mailer:smtp-secret@smtp.example.com:587",
      saashup_default: true,
    },
  }),
};

const visualTemplates = {
  demo: {
    config_profile: "demo",
    network: "traefik-public",
    image: "saashup/demo",
    version: "v1.0.0",
    ports: [{ value: "3000" }],
  },
};

async function setupVisualRoutes(page) {
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "Ada Lovelace",
        user: "ada",
        email: "ada@example.com",
        admin: true,
      }),
    });
  });

  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/demo", version: "v1.0.0" },
      ]),
    });
  });

  await page.route("**/mail-settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ owner_email_configured: true }),
    });
  });

  await page.route("**/order/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        instances: [
          {
            instance: "demo-1.daily.paashup.cloud",
            dns_name: "demo-1.daily.paashup.cloud",
            template: "demo",
            image: "saashup/demo",
            status: "ready",
          },
          {
            instance: "demo-2.daily.paashup.cloud",
            dns_name: "demo-2.daily.paashup.cloud",
            template: "demo",
            image: "saashup/demo",
            status: "creating",
          },
        ],
        max: 2,
        profile: "demo",
        remaining: 0,
        reached: true,
        used: 2,
        total_used: 2,
      }),
    });
  });

  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "demo",
        used: 2,
        max: 2,
        remaining: 0,
        reached: true,
        instances: [
          {
            instance: "demo-image",
            image: "saashup/demo",
            version: "v1.0.0",
            status: "ready",
            source: "netbox-template",
            instance_count: 1,
          },
          {
            instance: "worker-image",
            image: "saashup/worker",
            version: "v2.4.1",
            status: "creating",
            source: "template",
            instance_count: 0,
          },
        ],
      }),
    });
  });
}

async function openVisualPage(page, path) {
  if (path === "/admin.html" || path === "/admin") {
    await page.evaluate(() => localStorage.setItem("current_action", "config"));
  }
  await openAdmin(page, visualConfig, visualTemplates, [], undefined, path);
  await page.waitForSelector("body:not(.app-booting)");
}

async function expectAdminReady(page) {
  await expect(page.locator("#form-title")).toHaveText("Config");
  await expect(page.locator("#config_profile")).toHaveValue("demo");
}

const pageScreenshotOptions = {
  maxDiffPixelRatio: 0.05,
};

const adminScreenshotOptions = {
  maxDiffPixelRatio: 0.12,
};

async function setNoticeState(page, message, type = "info") {
  await page.evaluate(({ message, type }) => {
    window.setNotice?.(message, type, false);
  }, { message, type });
}

async function setOrderStatusState(page, message, type = "info", reason = "visual") {
  await page.evaluate(({ message, type, reason }) => {
    window.setOrderActionStatus?.(message, type, reason);
  }, { message, type, reason });
}

test.describe("@visual visual snapshots", () => {
  test("pages match visual baselines", async ({ page }) => {
    await setupVisualRoutes(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await openVisualPage(page, "/admin.html");
    await expectAdminReady(page);
    await expect(page).toHaveScreenshot("admin-mobile.png", adminScreenshotOptions);

    await openVisualPage(page, "/order?template=demo");
    await expect(page).toHaveScreenshot("order-mobile.png", pageScreenshotOptions);

    await openVisualPage(page, "/enroll.html");
    await expect(page.locator("#enrollInstances")).toBeVisible();
    await expect(page).toHaveScreenshot("enroll-mobile.png", pageScreenshotOptions);

    await openVisualPage(page, "/catalog");
    await expect(page.locator("#catalogList")).toContainText("demo-image");
    await expect(page).toHaveScreenshot("catalog-mobile.png", pageScreenshotOptions);

    await page.setViewportSize({ width: 1280, height: 720 });
    await openVisualPage(page, "/admin.html");
    await expectAdminReady(page);
    await expect(page).toHaveScreenshot("admin-desktop.png", adminScreenshotOptions);

    await openVisualPage(page, "/order?template=demo");
    await expect(page).toHaveScreenshot("order-desktop.png", pageScreenshotOptions);

    await openVisualPage(page, "/enroll.html");
    await expect(page.locator("#enrollInstances")).toBeVisible();
    await expect(page).toHaveScreenshot("enroll-desktop.png", pageScreenshotOptions);

    await openVisualPage(page, "/catalog");
    await expect(page.locator("#catalogList")).toContainText("demo-image");
    await expect(page).toHaveScreenshot("catalog-desktop.png", pageScreenshotOptions);
  });

  test("interaction states match visual baselines", async ({ page }) => {
    await setupVisualRoutes(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    await openVisualPage(page, "/order?template=demo");
    await setOrderStatusState(page, "Thank you, your instance installation has been requested for demo-3.daily.paashup.cloud.", "success", "order-requested");
    await expect(page).toHaveScreenshot("order-message-success-desktop.png", pageScreenshotOptions);

    await setOrderStatusState(page, "Delete requested for demo-1.daily.paashup.cloud.", "success", "delete-requested");
    await page.locator(".order-instance-card").first().evaluate((card) => {
      card.querySelector(".order-instance-state").textContent = "Deleting";
      card.querySelector(".order-instance-state").classList.add("order-instance-status-deleting");
    });
    await expect(page).toHaveScreenshot("order-action-delete-desktop.png", pageScreenshotOptions);

    await setOrderStatusState(page, "Order failed: image registry check failed.", "error", "order-failed");
    await expect(page).toHaveScreenshot("order-message-error-desktop.png", pageScreenshotOptions);

    await page.unroute("**/enroll/limit*").catch(() => {});
    await page.route("**/enroll/limit*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: "demo",
          used: 1,
          max: 2,
          remaining: 1,
          reached: false,
          instances: [
            {
              instance: "demo-image",
              image: "saashup/demo",
              version: "v1.0.0",
              status: "ready",
              source: "netbox-template",
              instance_count: 1,
            },
            {
              instance: "worker-image",
              image: "saashup/worker",
              version: "v2.4.1",
              status: "creating",
              source: "template",
              instance_count: 0,
            },
          ],
        }),
      });
    });

    await openVisualPage(page, "/enroll.html");
    await setNoticeState(page, "Import a Docker run command or compose with a single service.", "info");
    await expect(page).toHaveScreenshot("enroll-message-info-desktop.png", pageScreenshotOptions);

    await page.locator("#dockerRunInput").fill("docker run --name demo-image -p 8080:3000 saashup/demo:v1.0.0");
    await setNoticeState(page, "Image found - saashup/demo:v1.0.0", "success");
    await expect(page).toHaveScreenshot("enroll-action-import-ready-desktop.png", pageScreenshotOptions);

    await setNoticeState(page, "Compose service image version cannot be latest", "error");
    await expect(page).toHaveScreenshot("enroll-message-error-desktop.png", pageScreenshotOptions);

    await page.locator("#dockerComposeTab").click();
    await page.locator("#dockerComposeInput").fill([
      "services:",
      "  demo:",
      "    image: saashup/demo:v1.0.0",
      "    ports:",
      "      - 8080:3000",
    ].join("\n"));
    await setNoticeState(page, "Compose service \"demo\" imported", "success");
    await expect(page).toHaveScreenshot("enroll-action-compose-desktop.png", pageScreenshotOptions);

    await openVisualPage(page, "/catalog");
    await page.locator("#catalogSearch").fill("worker");
    await expect(page).toHaveScreenshot("catalog-action-search-desktop.png", pageScreenshotOptions);

    await page.locator("#catalogSearch").fill("nothing-matches-this");
    await expect(page.locator("#catalogList")).toContainText("No catalog images match your search.");
    await expect(page).toHaveScreenshot("catalog-message-empty-search-desktop.png", pageScreenshotOptions);

    await page.locator("#catalogSearch").fill("");
    await page.locator("#catalogSort").selectOption("image");
    await expect(page).toHaveScreenshot("catalog-action-sort-desktop.png", pageScreenshotOptions);
  });
});
