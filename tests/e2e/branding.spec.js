const { test, expect, openAdmin } = require("./fixtures");

const brandedProfile = {
  netbox: "https://netbox.example.com",
  token: "secret",
  domain: "daily.paashup.cloud",
  tag: "tile",
  saashup_visible: true,
  brand_primary: "#e11d48",
  brand_secondary: "#7c3aed",
  brand_welcome: "Bienvenue chez Acme",
  brand_logo: "/branding-assets/abc123abc123-logo.webp?v=1",
  brand_url: "https://www.acme.example",
  brand_footer: "Acme © 2026",
};

const demoTemplates = {
  demo: {
    config_profile: "tile",
    network: "traefik-public",
    image: "saashup/demo",
    ports: [{ value: "3000" }],
  },
};

function orderConfig(profileOverrides = {}) {
  return {
    profile: "tile",
    config_profile: "tile",
    customer_name: "Acme",
    profiles: JSON.stringify({ tile: { ...brandedProfile, ...profileOverrides } }),
  };
}

async function mockOrderSupport(page) {
  await page.route("**/order/limit**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profile: "tile", used: 0, max: 1, remaining: 1, reached: false, instances: [] }),
  }));
  await page.route("**/branding-assets/**", (route) => route.fulfill({
    status: 200,
    contentType: "image/webp",
    body: Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]),
  }));
  await page.route("**/images*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

async function primaryColor(page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
}

test("the order page applies the profile branding", async ({ page }) => {
  await mockOrderSupport(page);
  await openAdmin(page, orderConfig(), demoTemplates, [], undefined, "/order?template=demo");

  await expect.poll(() => primaryColor(page)).toBe("#e11d48");
  await expect(page.locator("#brandWelcome")).toHaveText("Bienvenue chez Acme");

  const watermark = await page.evaluate(() => ({
    active: document.body.classList.contains("brand-watermark"),
    value: document.body.style.getPropertyValue("--brand-watermark"),
  }));
  expect(watermark.active).toBe(true);
  expect(watermark.value).toContain("abc123abc123-logo.webp");

  const badge = page.locator(".top-left-bar .brand-badge");
  await expect(badge).toHaveAttribute("href", "https://www.acme.example");
  await expect(badge).toHaveClass(/brand-badge-custom/);
  expect(await badge.locator("img").getAttribute("src")).toContain("abc123abc123-logo.webp");
  await expect(badge.locator("span")).toBeHidden();
  await expect(page.locator(".app-footer [data-brand-footer]")).toHaveText("Acme © 2026");
  await expect(page).toHaveTitle("Order Acme");
  expect(await page.locator('link[rel="icon"]').getAttribute("href")).toContain("abc123abc123-logo.webp");
});

test("the order page falls back to the default look without branding", async ({ page }) => {
  await mockOrderSupport(page);
  await openAdmin(page, orderConfig({
    brand_primary: undefined,
    brand_secondary: undefined,
    brand_welcome: undefined,
    brand_logo: undefined,
    brand_url: undefined,
    brand_footer: undefined,
  }), demoTemplates, [], undefined, "/order?template=demo");

  await expect.poll(() => primaryColor(page)).toBe("#246bfe");
  await expect(page.locator("#brandWelcome")).toBeHidden();
  expect(await page.evaluate(() => document.body.classList.contains("brand-watermark"))).toBe(false);

  const badge = page.locator(".top-left-bar .brand-badge");
  await expect(badge).toHaveAttribute("href", "https://saashup.com");
  await expect(badge).not.toHaveClass(/brand-badge-custom/);
  await expect(badge.locator("span")).toHaveText("SaaShup");
  await expect(page.locator(".app-footer [data-brand-footer]")).toHaveText("SaaShup © 2026");
  await expect(page).toHaveTitle("Order Acme");
  expect(await page.locator('link[rel="icon"]').getAttribute("href")).toBe("saashup_logo.svg");
});

test("the navigation parameter hides the menu and sticks for the session", async ({ page }) => {
  await mockOrderSupport(page);
  await openAdmin(page, orderConfig(), demoTemplates, [], undefined, "/order?template=demo&navigation=false");

  await expect(page.locator(".order-page-menu")).toBeHidden();
  await expect(page.locator(".top-left-bar .brand-badge")).toBeHidden();
  await expect(page.locator(".theme-toggle.order-theme")).toBeVisible();

  // The choice sticks for the tab session even without the parameter.
  await page.goto("/order?template=demo");
  await expect(page.locator(".order-page-menu")).toBeHidden();

  await page.goto("/order?template=demo&navigation=true");
  await expect(page.locator(".order-page-menu")).toBeVisible();
  await expect(page.locator(".top-left-bar .brand-badge")).toBeVisible();
});

test("the branding select hides New branding once the limit is reached", async ({ page }) => {
  await page.route("**/admin/brandings", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      brandings: { acme: { id: "abc123abc123", brand_primary: "#e11d48" } },
      limit: 1,
    }),
  }));

  await openAdmin(page, {});
  await page.click("#menu_branding");

  await expect(page.locator("#branding_select")).toHaveValue("acme");
  await expect(page.locator("#branding_select option")).toHaveCount(1);
  await expect(page.locator("#branding_select option", { hasText: "New branding" })).toHaveCount(0);
  await expect(page.locator("#branding_name")).toHaveValue("acme");
  await expect(page.locator("#brand_primary")).toHaveValue("#e11d48");
});

test("the branding select keeps New branding while under the limit", async ({ page }) => {
  await page.route("**/admin/brandings", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      brandings: { acme: { id: "abc123abc123", brand_primary: "#e11d48" } },
      limit: 2,
    }),
  }));

  await openAdmin(page, {});
  await page.click("#menu_branding");

  await expect(page.locator("#branding_select")).toHaveValue("");
  await expect(page.locator("#branding_select option")).toHaveCount(2);
  await expect(page.locator("#branding_select option", { hasText: "New branding" })).toHaveCount(1);
});

test("the admin branding form processes the upload and saves it", async ({ page }) => {
  let savedPayload = null;
  await page.route("**/admin/brandings", async (route) => {
    if (route.request().method() === "POST") {
      savedPayload = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: savedPayload.name,
          branding: {
            id: "abc123abc123",
            brand_primary: savedPayload.brand_primary || "",
            brand_logo: "/branding-assets/abc123abc123-logo.webp?v=2",
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ brandings: {} }) });
  });

  await openAdmin(page, {});
  const pngBuffer = await page.screenshot();

  await page.click("#menu_branding");
  await page.fill("#branding_name", "acme");
  await page.setInputFiles("#brandLogoFile", { name: "logo.png", mimeType: "image/png", buffer: pngBuffer });

  await expect(page.locator("#brandLogoPreviewImg")).toBeVisible();
  const previewSrc = await page.locator("#brandLogoPreviewImg").getAttribute("src");
  expect(previewSrc.startsWith("data:image/webp")).toBe(true);

  await page.click("#submitBtn");
  await expect(page.locator("#notif")).toContainText('Branding "acme" saved');

  expect(savedPayload.name).toBe("acme");
  expect(String(savedPayload.logo_upload || "").length).toBeGreaterThan(100);
  await expect(page.locator("#branding_select")).toHaveValue("acme");
  await expect(page.locator("#brandLogoPreviewImg")).toBeVisible();
});
