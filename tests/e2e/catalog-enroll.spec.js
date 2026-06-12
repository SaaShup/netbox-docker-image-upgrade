const { test, expect, fs, openAdmin, appVersion } = require("./fixtures");

test("enroll page imports docker run and submits creation", async ({ page }) => {
  let createBody = "";
  let enrolledGuide = false;
  let resolveCreate;
  const createReady = new Promise((resolve) => {
    resolveCreate = resolve;
  });

  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });

  await page.route("**/create", async (route) => {
    createBody = route.request().postData() || "";
    await createReady;
    enrolledGuide = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/registry/lookup?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exists: true, image: "saashup/guide:v1.2.3" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: enrolledGuide ? 2 : 1,
        max: 2,
        remaining: enrolledGuide ? 0 : 1,
        reached: enrolledGuide,
        instances: [
          {
            instance: "existing-guide.example.com",
            dns_name: "existing-guide.example.com",
            image: "saashup/guide",
            version: "v1.0.0",
            status: "ready",
          },
          ...(enrolledGuide ? [{
            instance: "guide-app",
            dns_name: "guide-app.example.com",
            image: "saashup/guide",
            version: "v1.2.3",
            status: "ready",
            source: "template",
            instance_count: 0,
          }] : []),
        ],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 2,
        saashup_default: true,
      },
    }),
  }, {}, [
    { instance: "guide-app", networks: ["bridge", "traefik-net"] },
  ], undefined, "/enroll.html");

  await expect(page).toHaveURL(/\/enroll\.html$/);
  await expect(page.locator("#authUser")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "My instances" })).toHaveAttribute("href", "/order");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "My images" })).toHaveAttribute("href", "/enroll");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "My images" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/catalog");
  await expect(page.locator("#dockerRunApplyBtn")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to home" })).toHaveCount(0);
  await expect(page.locator("#submitBtn")).toBeDisabled();
  await expect(page.locator("#submitBtn")).toHaveText("Enroll image");
  await expect(page.locator("#dockerRunInput")).toHaveAttribute("placeholder", /-p 8080:3000/);
  await expect(page.locator("#importProfileSelect")).toBeHidden();
  await expect(page.locator("#config_profile")).toHaveValue("production");
  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect(page.locator("#enrollInstances .order-instances-header .eyebrow")).toHaveText("Your images");
  await expect(page.locator("#enrollInstances .order-instances-count")).toHaveText("1 / 2");
  const enrollInstancesBox = await page.locator("#enrollInstances").boundingBox();
  expect(enrollInstancesBox).not.toBeNull();
  expect(Math.round(enrollInstancesBox.width)).toBe(760);
  expect(Math.round(enrollInstancesBox.x + (enrollInstancesBox.width / 2))).toBe(640);
  const enrollPanelType = await page.locator("#enrollInstances .order-instance-card").first().evaluate((card) => {
    const title = card.querySelector(".order-instance-copy a, .order-instance-copy strong");
    const small = card.querySelector(".order-instance-copy small");
    const state = card.querySelector(".order-instance-state");
    return {
      title: getComputedStyle(title).fontSize,
      small: getComputedStyle(small).fontSize,
      state: getComputedStyle(state).fontSize,
      padding: getComputedStyle(card).paddingTop,
      gap: getComputedStyle(card).columnGap,
    };
  });
  expect(enrollPanelType).toEqual({
    title: "16.96px",
    small: "14.4px",
    state: "14.4px",
    padding: "14px",
    gap: "12px",
  });
  await expect(page.locator("#enrollInstances")).toContainText("existing-guide.example.com");
  await expect(page.locator("#enrollInstances .order-instance-state")).toHaveText("Ready");

  await page.locator("#dockerRunInput").fill([
    "docker run -d --name guide-app --network mgmt",
    "-e APP_ENV=production -p 8080:3000",
    "-v guide-data:/app/data saashup/guide:v1.2.3",
  ].join(" "));
  await expect(page.locator("#submitBtn")).toBeEnabled();
  await page.locator("#submitBtn").click();
  await expect(page.locator("#submitBtn")).toBeHidden();
  await expect(page.locator("#instanceForm")).toBeHidden();
  await expect(page.locator("#enrollInstances")).toBeVisible();

  await expect.poll(() => createBody).toContain("image=saashup%2Fguide");
  await expect(page.locator("#instanceForm")).toHaveAttribute("action", "/create");
  await expect(page.locator("#notif")).toContainText("Image found - saashup/guide:v1.2.3");
  resolveCreate();
  await expect(page.locator("#enrollSummary")).toContainText("Image found - saashup/guide:v1.2.3");
  expect(createBody).toContain("version=v1.2.3");
  expect(createBody).toContain("instance=guide-app");
  expect(createBody).toContain("dns_name=guide-app.example.com");
  expect(createBody).toContain("network=traefik-net");
  expect(createBody).toContain("var_env_key=APP_ENV");
  expect(createBody).toContain("var_env_value=production");
  expect(createBody).toContain("port_value=3000");
  expect(createBody).toContain("profile=production");
  expect(createBody).toContain("enroll_request=true");
  expect(createBody).toContain("enrollment_limit=2");
  await expect(page.locator("#notif")).toContainText("Enrollment recorded for guide-app.");
  await expect(page.locator("#notif")).not.toContainText("Use Save template");
  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect(page.locator("#enrollInstances")).toContainText("2 / 2");
  await expect(page.locator("#enrollInstances")).toContainText("guide-app");
  await expect(page.locator("#enrollInstances .order-instance-state")).toHaveText(["Ready", "Ready"]);
  await expect(page.locator("#enrollInstances .order-instance-delete")).toHaveCount(1);
  await expect(page.locator("#enrollInstances .order-instance-delete").first()).toBeEnabled();
  await expect(page.locator("#instanceForm")).toBeHidden();
});

test("catalog page shows the account menu", async ({ page }) => {
  let catalogLimitUrl = "";
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/enroll/limit**", async (route) => {
    catalogLimitUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: 2,
        max: 4,
        remaining: 2,
        reached: false,
        instances: [
          { instance: "flowg", image: "linksociety/flowg", version: "v0.58.0", status: "ready", source: "netbox-template", instance_count: 1 },
          { instance: "nginx", image: "nginx", version: "1.27", status: "failed", source: "template", instance_count: 0 },
        ],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    config_profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        domain: "example.com",
        tag: "production",
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/catalog");

  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.locator(".catalog-eyebrow")).toHaveText("Template catalog");
  await expect(page.locator(".catalog-summary")).toHaveCount(0);
  await expect(page.locator(".top-left-bar .brand-badge")).toBeVisible();
  await expect(page.locator(".top-left-bar .brand-badge")).toContainText("SaaShup");
  await expect(page.locator(".top-left-bar .brand-badge img")).toHaveAttribute("src", "saashup_logo.svg");
  await expect(page.locator(".site-header")).toHaveCount(0);
  const menuBox = await page.locator(".order-page-menu").boundingBox();
  const catalogBox = await page.locator(".catalog-panel").boundingBox();
  expect(menuBox?.y).toBeLessThan(60);
  expect(catalogBox?.y).toBeGreaterThan(menuBox?.y ?? 0);
  expect(new URL(catalogLimitUrl).searchParams.get("owner_only")).toBe("false");
  await expect(page.locator("#catalogList")).toContainText("flowg");
  await expect(page.locator("#catalogList")).toContainText("linksociety/flowg:v0.58.0");
  await expect(page.locator("#catalogList")).toContainText("Ready");
  await expect(page.locator("#catalogList")).toContainText("nginx:1.27");
  await expect(page.locator("#catalogList")).toContainText("Failed");
  await expect(page.locator("#clearCacheBtn")).toHaveCount(0);
  await expect(page.locator("#logoutBtn")).toBeVisible();
  await expect(page.locator(".catalog-card").first()).toContainText("production");
  await expect(page.locator(".catalog-card").first()).toContainText("Template");
  await expect(page.locator(".catalog-status-ready")).toHaveText("Ready");
  await expect(page.locator(".catalog-status-failed")).toHaveText("Failed");
  await expect(page.locator(".catalog-card").first().getByRole("link", { name: "flowg" })).toHaveAttribute("href", /\/order\?template=flowg$/);
  await page.locator("#catalogSearch").fill("nginx");
  await expect(page.locator(".catalog-card")).toHaveCount(1);
  await expect(page.locator(".catalog-card")).toContainText("nginx:1.27");
  await page.locator("#catalogSearch").fill("");
  await page.locator("#catalogSort").selectOption("usage");
  await expect(page.locator(".catalog-card").first()).toContainText("flowg");
  await page.locator("#catalogSort").selectOption("image");
  await expect(page.locator(".catalog-card").first()).toContainText("linksociety/flowg:v0.58.0");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "My instances" })).toHaveAttribute("href", "/order");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "My images" })).toHaveAttribute("href", "/enroll");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/catalog");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "Catalog" })).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".top-left-bar")).toBeVisible();
  const mobileHeaderBox = await page.locator(".top-left-bar").boundingBox();
  const mobileBrandBox = await page.locator(".top-left-bar .brand-badge").boundingBox();
  const mobileMenuBox = await page.locator(".order-page-menu").boundingBox();
  const mobileAuthBox = await page.locator("#authUser").boundingBox();
  const mobileThemeBox = await page.locator(".order-theme").boundingBox();
  expect(mobileHeaderBox).not.toBeNull();
  expect(mobileBrandBox).not.toBeNull();
  expect(mobileMenuBox).not.toBeNull();
  expect(mobileAuthBox).not.toBeNull();
  expect(mobileThemeBox).not.toBeNull();
  expect(mobileHeaderBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileHeaderBox.x + mobileHeaderBox.width).toBeLessThanOrEqual(390);
  expect(mobileMenuBox.y).toBeGreaterThanOrEqual(mobileHeaderBox.y + mobileHeaderBox.height);
  expect(mobileAuthBox.x + mobileAuthBox.width).toBeLessThanOrEqual(390);
  const brandCenter = mobileBrandBox.y + (mobileBrandBox.height / 2);
  const authCenter = mobileAuthBox.y + (mobileAuthBox.height / 2);
  const themeCenter = mobileThemeBox.y + (mobileThemeBox.height / 2);
  expect(Math.abs(authCenter - brandCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(themeCenter - brandCenter)).toBeLessThanOrEqual(1);
});

test("enroll page reports only missing port when docker run has image", async ({ page }) => {
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: 0,
        max: 1,
        remaining: 1,
        reached: false,
        instances: [],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 1,
        saashup_default: true,
      },
    }),
  }, {}, [
    { instance: "guide-app", networks: ["bridge", "traefik-net"] },
  ], undefined, "/enroll.html");

  const commandBase = "docker run --name some-nginx -v nginx-content:/usr/share/nginx/html:ro -d";
  const command = `${commandBase} nginx`;
  await expect.poll(() => page.evaluate((value) => window.parseDockerRun(value).image, command)).toBe("nginx");
  await page.locator("#dockerRunInput").fill(command);
  await expect(page.locator("#submitBtn")).toBeDisabled();
  await expect(page.locator("#notif")).toHaveText("Docker run port is required");

  await page.locator("#dockerRunInput").fill(`${commandBase} -p 8080:80 nginx`);
  await expect(page.locator("#submitBtn")).toBeDisabled();
  await expect(page.locator("#notif")).toHaveText("Docker run image version is required");

  await page.locator("#dockerRunInput").fill(`${commandBase} -p 8080:80 nginx:latest`);
  await expect(page.locator("#submitBtn")).toBeDisabled();
  await expect(page.locator("#notif")).toHaveText("Docker run image version cannot be latest");

  await page.locator("#dockerRunInput").fill(`${commandBase} -p 8080:80 nginx:1.27`);
  await expect(page.locator("#submitBtn")).toBeEnabled();

  const copiedCommand = "copied from a shell prompt\n$ docker run --name guide-app -p 8080:3000 saashup/guide:v1.2.3";
  await page.locator("#dockerRunInput").fill(copiedCommand);
  await expect(page.locator("#dockerRunInput")).toHaveValue("docker run --name guide-app -p 8080:3000 saashup/guide:v1.2.3");
  await expect(page.locator("#submitBtn")).toBeEnabled();
});

test("enroll page restores enrolled templates when creation fails", async ({ page }) => {
  let createBody = "";
  let resolveCreate;
  const createReady = new Promise((resolve) => {
    resolveCreate = resolve;
  });

  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/create", async (route) => {
    createBody = route.request().postData() || "";
    await createReady;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Image is already enrolled." }),
    });
  });
  await page.route("**/registry/lookup?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exists: true, image: "saashup/guide:v1.2.3" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: 1,
        max: 2,
        remaining: 1,
        reached: false,
        instances: [{
          instance: "existing-guide.example.com",
          dns_name: "existing-guide.example.com",
          image: "saashup/guide",
          version: "v1.0.0",
          status: "ready",
        }],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 2,
        saashup_default: true,
      },
    }),
  }, {}, [
    { instance: "guide-app", networks: ["bridge", "traefik-net"] },
  ], undefined, "/enroll.html");

  await expect(page.locator("#enrollInstances")).toBeVisible();
  await page.locator("#dockerRunInput").fill("docker run -d --name guide-app --network mgmt -p 8080:3000 saashup/guide:v1.2.3");
  await expect(page.locator("#submitBtn")).toBeEnabled();
  await page.locator("#submitBtn").click();
  await expect(page.locator("#instanceForm")).toBeHidden();
  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect.poll(() => createBody).toContain("enroll_request=true");
  resolveCreate();

  await expect(page.locator("#notif")).toContainText("Image is already enrolled.");
  await expect(page.locator("#instanceForm")).toBeVisible();
  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect(page.locator("#enrollInstances")).toContainText("existing-guide.example.com");
});

test("enroll page checks provider registry before creating", async ({ page }) => {
  let createCalled = false;
  let resolveImages;
  const imagesReady = new Promise((resolve) => {
    resolveImages = resolve;
  });

  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/create", async (route) => {
    createCalled = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/registry/lookup?**", async (route) => {
    await imagesReady;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exists: false, image: "saashup/guide:v1.2.3" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: 1,
        max: 2,
        remaining: 1,
        reached: false,
        instances: [{
          instance: "existing-guide.example.com",
          dns_name: "existing-guide.example.com",
          image: "saashup/guide",
          version: "v1.0.0",
          status: "ready",
        }],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 2,
        saashup_default: true,
      },
    }),
  }, {}, [
    { instance: "guide-app", networks: ["bridge", "traefik-net"] },
  ], undefined, "/enroll.html");

  await page.locator("#dockerRunInput").fill("docker run -d --name guide-app --network mgmt -p 8080:3000 saashup/guide:v1.2.3");
  await expect(page.locator("#submitBtn")).toBeEnabled();
  await page.locator("#submitBtn").click();
  await expect(page.locator("#submitBtn")).toBeHidden();
  await expect(page.locator("#submitBtn")).toHaveJSProperty("hidden", true);
  await expect(page.locator("#notif")).toContainText("Checking image");
  await expect(page.locator("#orderLoading")).toBeHidden();
  await expect(page.locator("#instanceForm")).toBeVisible();
  await expect(page.locator("#enrollInstances")).toBeVisible();
  resolveImages();

  await expect(page.locator("#notif")).toContainText("Image saashup/guide:v1.2.3 was not found in the provider registry.");
  await expect(page.locator("#instanceForm")).toBeVisible();
  await expect(page.locator("#submitBtn")).toBeVisible();
  await expect(page.locator("#submitBtn")).toHaveJSProperty("hidden", false);
  await expect(page.locator("#submitBtn")).toBeEnabled();
  await expect(page.locator("#enrollInstances")).toBeVisible();
  expect(createCalled).toBe(false);
});

test("enroll page accepts Docker Hub image that exists in registry but is not pulled", async ({ page }) => {
  let createBody = "";
  let registryImage = "";

  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/create", async (route) => {
    createBody = route.request().postData() || "";
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/registry/lookup?**", async (route) => {
    registryImage = new URL(route.request().url()).searchParams.get("image") || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exists: true, image: registryImage }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: createBody ? 1 : 0,
        max: 2,
        remaining: createBody ? 1 : 2,
        reached: false,
        instances: createBody ? [{
          instance: "flowg",
          dns_name: "flowg.example.com",
          image: "linksociety/flowg",
          version: "v0.58.0",
          status: "ready",
        }] : [],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 2,
        saashup_default: true,
      },
    }),
  }, {}, [
    { instance: "flowg", networks: ["bridge", "traefik-net"] },
  ], undefined, "/enroll.html");

  await page.locator("#dockerRunInput").fill("docker run -p 5080:5080 -v flowg-data:/data linksociety/flowg:v0.58.0");
  await expect(page.locator("#submitBtn")).toBeEnabled();
  await page.locator("#submitBtn").click();

  await expect.poll(() => registryImage).toBe("linksociety/flowg:v0.58.0");
  await expect.poll(() => createBody).toContain("image=linksociety%2Fflowg");
  expect(createBody).toContain("version=v0.58.0");
  expect(createBody).toContain("port_value=5080");
  expect(createBody).toContain("enroll_request=true");
});

test("enroll page blocks docker run bind mounts", async ({ page }) => {
  let createCalled = false;

  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/create", async (route) => {
    createCalled = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: "production", used: 0, max: 2, remaining: 2, reached: false, instances: [] }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 2,
        saashup_default: true,
      },
    }),
  }, {}, [
    { instance: "flowg", networks: ["bridge", "traefik-net"] },
  ], undefined, "/enroll.html");

  await page.locator("#dockerRunInput").fill("docker run -p 5080:5080 -v ./data:/data linksociety/flowg:v0.58.0");
  await expect(page.locator("#notif")).toContainText("Bind mounts are not allowed for enrollment.");
  await expect(page.locator("#submitBtn")).toBeDisabled();
  expect(createCalled).toBe(false);
});

test("enroll page restores enrolled templates after creation when limit remains available", async ({ page }) => {
  let createBody = "";
  let enrolledGuide = false;
  let resolveCreate;
  const createReady = new Promise((resolve) => {
    resolveCreate = resolve;
  });

  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/create", async (route) => {
    createBody = route.request().postData() || "";
    await createReady;
    enrolledGuide = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/registry/lookup?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exists: true, image: "saashup/guide:v1.2.3" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: enrolledGuide ? 2 : 1,
        max: 3,
        remaining: enrolledGuide ? 1 : 2,
        reached: false,
        instances: [
          { instance: "existing-guide.example.com", dns_name: "existing-guide.example.com", image: "saashup/guide", version: "v1.0.0", status: "ready" },
          ...(enrolledGuide ? [{ instance: "guide-app", dns_name: "guide-app.example.com", image: "saashup/guide", version: "v1.2.3", status: "ready", source: "template", instance_count: 0 }] : []),
        ],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 3,
        saashup_default: true,
      },
    }),
  }, {}, [
    { instance: "guide-app", networks: ["bridge", "traefik-net"] },
  ], undefined, "/enroll.html");

  await page.locator("#dockerRunInput").fill("docker run -d --name guide-app --network mgmt -p 8080:3000 saashup/guide:v1.2.3");
  await expect(page.locator("#submitBtn")).toBeEnabled();
  await page.locator("#submitBtn").click();
  await expect(page.locator("#instanceForm")).toBeHidden();
  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect.poll(() => createBody).toContain("enroll_request=true");
  resolveCreate();

  await expect(page.locator("#notif")).toContainText("Enrollment recorded for guide-app.");
  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect(page.locator("#enrollInstances")).toContainText("2 / 3");
  await expect(page.locator("#enrollInstances")).toContainText("guide-app");
  await expect(page.locator("#instanceForm")).toBeVisible();
});

test("enroll page waits for limit before showing create panel or cards", async ({ page }) => {
  let resolveLimit;
  const limitPending = new Promise((resolve) => {
    resolveLimit = resolve;
  });

  await page.route("**/enroll/limit*", async (route) => {
    await limitPending;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: 1,
        max: 1,
        remaining: 0,
        reached: true,
        instances: [
          {
            instance: "guide-template",
            image: "saashup/guide",
            status: "ready",
            source: "netbox-template",
          },
        ],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        tag: "production",
        enrollment_limit: 1,
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/enroll.html");

  await expect(page.locator("#orderLoading")).toBeVisible();
  await expect(page.locator("#notif")).toBeHidden();
  await expect(page.locator("#instanceForm")).toBeHidden();
  await expect(page.locator("#enrollInstances")).toBeHidden();
  let loadingBox = await page.locator("#orderLoading").boundingBox();
  expect(loadingBox).not.toBeNull();
  expect(Math.round(loadingBox.x + (loadingBox.width / 2))).toBe(640);
  expect(Math.round(loadingBox.y + (loadingBox.height / 2))).toBe(360);

  await page.setViewportSize({ width: 390, height: 844 });
  loadingBox = await page.locator("#orderLoading").boundingBox();
  const menuBox = await page.locator(".order-page-menu").boundingBox();
  expect(loadingBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(Math.round(loadingBox.y)).toBe(Math.round(menuBox.y + menuBox.height + 18));

  await page.setViewportSize({ width: 1280, height: 720 });
  resolveLimit();

  await expect(page.locator("#orderLoading")).toBeHidden();
  await expect(page.locator("#notif")).toBeHidden();
  await expect(page.locator("#instanceForm")).toBeHidden();
  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect(page.locator("#enrollInstances .order-instances-count")).toHaveText("1 / 1");
  await expect(page.locator("#enrollInstances .order-instances-count")).toHaveClass(/limit-reached/);
  const enrollInstancesBox = await page.locator("#enrollInstances").boundingBox();
  expect(enrollInstancesBox).not.toBeNull();
  expect(Math.round(enrollInstancesBox.x + (enrollInstancesBox.width / 2))).toBe(640);
  expect(Math.round(enrollInstancesBox.y + (enrollInstancesBox.height / 2))).toBe(360);
  await expect(page.locator("#enrollInstances")).toContainText("guide-template");
});

test("enroll page keeps submit disabled before import content", async ({ page }) => {
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: "production", used: 0, max: 10, remaining: 10, reached: false, instances: [] }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    config_profile: "production",
    netbox: "https://netbox.example.com",
    token: "secret",
    proxy: "",
    domain: "example.com",
    tag: "production",
    max_instances: 1,
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 10,
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/enroll");

  await expect(page).toHaveURL(/\/enroll$/);
  await expect(page.locator("#instanceForm")).toBeVisible();
  await expect(page.locator("#dockerRunInput")).toHaveValue("");
  await expect(page.locator("#submitBtn")).toBeDisabled();
});

test("enroll page hides enrollment panel when no templates are returned", async ({ page }) => {
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: 0,
        max: 1,
        remaining: 1,
        reached: false,
        instances: [],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 1,
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/enroll.html");

  await expect(page.locator("#enrollInstances")).toBeHidden();
  await expect(page.locator("#instanceForm")).toBeVisible();
});

test("enroll page shows templates created by the user", async ({ page }) => {
  let deletedTemplate = "";
  let resolveDelete;
  const deleteReady = new Promise((resolve) => {
    resolveDelete = resolve;
  });
  await page.addInitScript(() => {
    window.__copiedOrderLink = "";
    window.__copiedText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copiedOrderLink = text;
          window.__copiedText = text;
        },
      },
    });
  });
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    const instances = [
      { instance: "guide-template", image: "saashup/guide", version: "v1.2.3", status: "ready", source: "template", registry_webhook_secret: "guide-secret", instance_count: 2 },
      ...(deletedTemplate === "install-template" ? [] : [{ instance: "install-template", image: "saashup/install", version: "v4.0.0", status: "ready", source: "template", instance_count: 0 }]),
      ...(deletedTemplate === "failed-template" ? [] : [{ instance: "failed-template", image: "saashup/failed", version: "v9.0.0", status: "failed", source: "template", instance_count: 0 }]),
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: instances.length,
        max: 3,
        remaining: 0,
        reached: true,
        instances,
      }),
    });
  });
  await page.route("**/enroll/template/**", async (route) => {
    deletedTemplate = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    await deleteReady;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ deleted: true, template: deletedTemplate }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 1,
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/enroll.html");

  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect(page.locator("#enrollInstances")).toContainText("3 / 3");
  await expect(page.locator("#enrollInstances")).toContainText("guide-template");
  await expect(page.locator("#enrollInstances")).toContainText("install-template");
  await expect(page.locator("#enrollInstances")).toContainText("failed-template");
  await expect(page.locator("#enrollInstances")).toContainText("saashup/guide");
  await expect(page.locator("#enrollInstances .order-instance-state")).toHaveText(["Ready", "Ready", "Failed"]);
  await expect(page.locator("#enrollInstances .enroll-template-count")).toHaveText(["2", "0", "0"]);
  await expect(page.locator("#enrollInstances .order-instance-delete").first()).toBeDisabled();
  await expect(page.locator("#enrollInstances .order-instance-delete").nth(1)).toBeEnabled();
  await expect(page.locator("#enrollInstances .order-instance-delete").nth(2)).toBeEnabled();
  await expect(page.locator("#enrollInstances .order-instance-delete svg").first()).toBeVisible();
  await expect(page.locator("#enrollInstances .order-template-copy")).toHaveCount(2);
  await expect(page.locator("#enrollInstances [data-template-webhook-copy]")).toHaveCount(2);
  const guideOrderUrl = `${page.url().replace(/\/enroll(?:\.html)?$/, "")}/order?template=guide-template`;
  const guideOrderHtml = `<a href="${guideOrderUrl.replaceAll("&", "&amp;")}"><img src="${new URL(page.url()).origin}/assets/deploy.svg" alt="Deploy with SaaShup"></a>`;
  const guideWebhookUrl = `${new URL(page.url()).origin}/registry-webhook/production/guide-template/guide-secret`;
  await expect(page.locator("#enrollInstances .enroll-template-title a").first()).toHaveAttribute("href", guideOrderUrl);
  await page.locator("#enrollInstances .order-template-copy").first().click();
  await expect(page.locator("#notif")).toContainText('Order button HTML copied for "guide-template"');
  await expect.poll(() => page.evaluate(() => window.__copiedOrderLink)).toBe(guideOrderHtml);
  await page.locator("#enrollInstances [data-template-webhook-copy]").first().click();
  await expect(page.locator("#notif")).toContainText('Webhook URL copied for "guide-template"');
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(guideWebhookUrl);
  await page.locator("#enrollInstances [data-template-webhook-copy]").nth(1).click();
  await expect(page.locator("#notif")).toContainText('Webhook URL copied for "install-template"');
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(`${new URL(page.url()).origin}/registry-webhook/production/install-template/hook-secret`);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe('Delete enrolled template "install-template"?');
    await dialog.accept();
  });
  await page.locator("#enrollInstances .order-instance-delete").nth(1).click();
  await expect.poll(() => deletedTemplate).toBe("install-template");
  await expect(page.locator("#enrollInstances")).not.toContainText("install-template");
  resolveDelete();
  await expect(page.locator("#notif")).toContainText('Template "install-template" deleted');
  await expect(page.locator("#enrollInstances")).not.toContainText("install-template");
  await expect(page.locator("#instanceForm")).toBeHidden();
});

test("enroll page template name opens the order page", async ({ page }) => {
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: 1,
        max: 2,
        remaining: 1,
        reached: false,
        instances: [
          { instance: "guide-template", image: "saashup/guide", version: "v1.2.3", status: "ready", source: "template", instance_count: 0 },
        ],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 2,
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/enroll.html");

  await page.locator("#enrollInstances .enroll-template-title a").click();
  await expect(page).toHaveURL(/\/order\?template=guide-template$/);
});

test("enroll page hides deploy panel without a default config", async ({ page }) => {
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
      },
    }),
  }, {}, [], undefined, "/enroll.html");

  await expect(page.locator("#instanceForm")).toBeHidden();
  await expect(page.locator("#notif")).toContainText("You cannot deploy a new SaaS yet. Ask an administrator to make a config visible.");
});

test("enroll page hides create controls when public images are disabled for non-admin users", async ({ page }) => {
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        email: "buyer@example.com",
        user: "buyer",
        name: "Buyer Example",
        admin: false,
        public_image: false,
      }),
    });
  });

  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: "production",
        used: 0,
        max: 2,
        remaining: 2,
        reached: false,
        instances: [],
      }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 2,
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/enroll.html");

  await expect(page.locator("#instanceForm")).toBeHidden();
  await expect(page.locator("#submitBtn")).toBeHidden();
  await expect(page.locator('.order-page-menu a[href="/enroll"]')).toBeHidden();
  await expect(page.locator("#adminLink")).toBeHidden();
  await expect(page.locator("#notif")).toContainText("Only administrators can create or enroll images.");
});

test("enroll page blocks docker compose files with multiple services", async ({ page }) => {
  let createRequests = 0;

  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });

  await page.route("**/create", async (route) => {
    createRequests += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: "production", used: 0, max: 10, remaining: 10, reached: false, instances: [] }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    config_profile: "production",
    netbox: "https://netbox.example.com",
    token: "secret",
    proxy: "",
    domain: "example.com",
    tag: "production",
    enrollment_limit: 10,
    max_instances: 1,
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 10,
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/enroll.html");

  await page.locator("#dockerComposeTab").click();
  await expect(page.locator("#submitBtn")).toBeDisabled();

  await page.locator("#dockerComposeInput").fill([
    "services:",
    "  web:",
    "    image: saashup/web:v1.0.0",
    "    ports:",
    "      - \"8080:3000\"",
    "  worker:",
    "    image: saashup/worker:v1.0.0",
  ].join("\n"));
  await expect(page.locator("#notif")).toContainText("Compose files on enroll must contain a single service.");
  await expect(page.locator("#submitBtn")).toBeDisabled();

  await page.locator("#dockerComposeInput").fill([
    "services:",
    "  web:",
    "    image: saashup/web",
    "    ports:",
    "      - \"8080:3000\"",
  ].join("\n"));
  await expect(page.locator("#notif")).toContainText("Compose service image version is required");
  await expect(page.locator("#submitBtn")).toBeDisabled();

  await page.locator("#dockerComposeInput").fill([
    "services:",
    "  web:",
    "    image: saashup/web:latest",
    "    ports:",
    "      - \"8080:3000\"",
  ].join("\n"));
  await expect(page.locator("#notif")).toContainText("Compose service image version cannot be latest");
  await expect(page.locator("#submitBtn")).toBeDisabled();

  await page.locator("#dockerComposeInput").fill([
    "services:",
    "  web:",
    "    image: saashup/web:v1.0.0",
    "    ports:",
    "      - \"8080:3000\"",
  ].join("\n"));
  await expect(page.locator("#submitBtn")).toBeEnabled();

  await page.locator("#dockerComposeInput").fill([
    "services:",
    "  web:",
    "    image: saashup/web:v1.0.0",
    "  worker:",
    "    image: saashup/worker:v1.0.0",
  ].join("\n"));
  await page.locator("#submitBtn").click({ force: true });
  await expect(page.locator("#notif")).toContainText("Compose files on enroll must contain a single service.");
  expect(createRequests).toBe(0);
});

test("enroll page flags multi-service compose pasted in run input", async ({ page }) => {
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ email: "ada@example.com", user: "ada", name: "Ada Lovelace" }),
    });
  });
  await page.route("**/enroll/limit*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: "production", used: 0, max: 10, remaining: 10, reached: false, instances: [] }),
    });
  });

  await openAdmin(page, {
    profile: "production",
    config_profile: "production",
    netbox: "https://netbox.example.com",
    token: "secret",
    proxy: "",
    domain: "example.com",
    tag: "production",
    enrollment_limit: 10,
    max_instances: 1,
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "production",
        enrollment_limit: 10,
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/enroll.html");

  await page.locator("#dockerRunInput").fill([
    "services:",
    "  web:",
    "    image: saashup/web:v1.0.0",
    "  worker:",
    "    image: saashup/worker:v1.0.0",
  ].join("\n"));

  await expect(page.locator("#notif")).toContainText("Compose files on enroll must contain a single service.");
  await expect(page.locator("#submitBtn")).toBeDisabled();
});
