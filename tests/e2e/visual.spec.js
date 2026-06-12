const { test, expect, openAdmin } = require("./fixtures");

const visualConfig = {
  profile: "demo",
  profiles: JSON.stringify({
    demo: {
      netbox: "https://netbox.example.com",
      token: "secret",
      domain: "daily.paashup.cloud",
      tag: "DEMO",
      max_instances: 2,
      enrollment_limit: 2,
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

  await page.route("**/order/limit?**", async (route) => {
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

  await page.route("**/enroll/limit?**", async (route) => {
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
  await openAdmin(page, visualConfig, visualTemplates, [], undefined, path);
  await page.waitForSelector("body:not(.app-booting)");
}

const pageScreenshotOptions = {
  maxDiffPixelRatio: 0.05,
};

test.describe("@visual visual snapshots", () => {
  test("public pages match visual baselines", async ({ page }) => {
    await setupVisualRoutes(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await openVisualPage(page, "/order?template=demo");
    await expect(page).toHaveScreenshot("order-mobile.png", pageScreenshotOptions);

    await openVisualPage(page, "/enroll.html");
    await expect(page.locator("#enrollInstances")).toBeVisible();
    await expect(page).toHaveScreenshot("enroll-mobile.png", pageScreenshotOptions);

    await openVisualPage(page, "/catalog");
    await expect(page.locator("#catalogList")).toContainText("demo-image");
    await expect(page).toHaveScreenshot("catalog-mobile.png", pageScreenshotOptions);

    await page.setViewportSize({ width: 1280, height: 720 });
    await openVisualPage(page, "/order?template=demo");
    await expect(page).toHaveScreenshot("order-desktop.png", pageScreenshotOptions);

    await openVisualPage(page, "/enroll.html");
    await expect(page.locator("#enrollInstances")).toBeVisible();
    await expect(page).toHaveScreenshot("enroll-desktop.png", pageScreenshotOptions);

    await openVisualPage(page, "/catalog");
    await expect(page.locator("#catalogList")).toContainText("demo-image");
    await expect(page).toHaveScreenshot("catalog-desktop.png", pageScreenshotOptions);
  });
});
