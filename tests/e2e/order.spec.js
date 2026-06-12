const { test, expect, fs, openAdmin, appVersion } = require("./fixtures");

test("order page creates an instance from the requested template", async ({ page }) => {
  let createBody = "";
  let deleteBody = "";
  let deleteLimitRequests = 0;
  let logsRequests = 0;
  const imageUrls = [];
  const instanceUrls = [];
  const templates = {
    curiootiles: {
      config_profile: "tile",
      network: "traefik-public",
      instance: "curiootiles",
      dns_name: "curiootiles.daily.paashup.cloud/app",
      image: "saashup/curiootiles",
      version: "v1.5.0",
      env: [{ key: "APP_ENV", value: "production" }],
      labels: [{ key: "traefik.enable", value: "true" }],
      ports: [{ value: "3000" }],
      volumes: [{ key: "/app/data", value: "curiootiles-data" }],
    },
  };

  await page.route("**/images?**", async (route) => {
    imageUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/curiootiles", version: "v2.0.0" },
      ]),
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
  await page.route("**/delete", async (route) => {
    deleteBody = route.request().postData() || "";
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/order/limit**", async (route) => {
    const created = new URLSearchParams(createBody || "");
    const instance = created.get("dns_name") || "";
    const deletionRequested = Boolean(deleteBody);
    if (deletionRequested) deleteLimitRequests += 1;
    const deleted = deletionRequested && deleteLimitRequests > 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(instance && !deleted
        ? {
          instances: [{ instance: generatedName, dns_name: instance, template: "curiootiles", status: "ready" }],
          max: 2,
          profile: "tile",
          remaining: 1,
          reached: false,
          used: 1,
        }
        : {
          instances: [],
          max: 2,
          profile: "tile",
          remaining: 2,
          reached: false,
          used: 0,
        }),
    });
  });

  await openAdmin(page, {
    profile: "guide",
    profiles: JSON.stringify({
      guide: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "guide.example.com",
        tag: "GUIDE",
      },
      tile: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "TILE",
      },
    }),
  }, templates, (route) => {
    instanceUrls.push(route.request().url());
    return [{ instance: "tiles.example.com", networks: ["traefik-public"] }];
  }, async (route) => {
    if (route.request().frame().url().includes("/order")) logsRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "",
    });
  }, "/order?template=curiootiles");

  await expect(page).toHaveURL(/\/order\?template=curiootiles$/);
  await expect(page.locator("#submitBtn")).toBeVisible();
  await expect(page.locator(".order-question")).toHaveText("Do you  want to install an instance?");
  await expect(page.locator("[data-app-version]")).toHaveText(appVersion);
  await expect(page.locator("#submitBtn")).toHaveText("Yes");
  await expect(page.locator("#orderCancelBtn")).toHaveText("No");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator("#image")).toBeHidden();
  await expect(page.locator("#config_profile")).toHaveValue("tile");
  await expect(page.locator("#instance")).toHaveValue(/^tile-[a-z0-9]{16}$/);
  const generatedName = await page.locator("#instance").inputValue();
  await expect(page.locator("#image")).toHaveValue("saashup/curiootiles");
  await expect(page.locator("#version")).toHaveValue("v1.5.0");
  expect(imageUrls).toHaveLength(0);
  expect(instanceUrls).toHaveLength(0);

  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).toContain(`instance=${generatedName}`);
  expect(createBody).toContain(`dns_name=${generatedName}.daily.paashup.cloud%2Fapp`);
  await expect(page.locator("#orderActions")).toBeHidden();
  await expect(page.locator("#orderStatus")).toHaveClass(/success/);
  await expect(page.locator("#orderStatus")).toHaveText(`Thank you, your instance installation has been requested for ${generatedName}.daily.paashup.cloud/app.`);
  await expect(page.locator("#orderStatus")).toHaveText("You can request another instance for this config.", { timeout: 5000 });
  await expect(page.locator("#orderActions")).toBeVisible();
  await expect(page.locator("#instance")).not.toHaveValue(generatedName);
  const orderCard = page.locator(".order-instance-card").first();
  await expect(orderCard.locator(".order-instance-copy strong")).toHaveText("curiootiles");
  await expect(orderCard.locator(".order-instance-copy small").first()).toHaveText(generatedName);
  await expect(orderCard.locator(".order-instance-open")).toHaveAttribute("href", `https://${generatedName}.daily.paashup.cloud`);
  await expect(orderCard.locator(".order-instance-state")).toHaveText("Ready");
  await expect(orderCard.locator(".order-instance-delete")).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await orderCard.locator(".order-instance-delete").click();
  await expect.poll(() => deleteBody).toContain(`instance=${generatedName}`);
  await expect(orderCard.locator(".order-instance-status-deleting")).toBeVisible();
  await expect(orderCard.locator(".order-instance-state")).toHaveText("Deleting");
  await expect(page.locator("#orderActions")).toBeHidden();
  await expect(page.locator("#orderStatus")).toContainText(`Delete requested for ${generatedName}.`);
  await expect(orderCard).toBeHidden({ timeout: 5000 });
  expect(createBody).toContain("profile=tile");
  expect(createBody).toContain("tag=TILE");
  expect(createBody).toContain("network=traefik-public");
  expect(createBody).toContain("image=saashup%2Fcuriootiles");
  expect(createBody).toContain("version=v1.5.0");
  expect(createBody).toContain("var_env_key=APP_ENV");
  expect(createBody).toContain("var_env_value=production");
  expect(createBody).toContain("port_value=3000");
  expect(createBody).toContain("max_instances=1");
  expect(createBody).toContain("order_request=true");
  expect(createBody).toContain("order_template=curiootiles");
  expect(createBody).toContain(`volume_name=${generatedName}-data`);
  expect(createBody).not.toContain("curiootiles-data");
  expect(logsRequests).toBe(0);
});

test("order page informs the user when the max instance limit is reached", async ({ page }) => {
  let createCalled = false;
  let deleteBody = "";

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
          { instance: "demo-1.daily.paashup.cloud", template: "demo" },
          { instance: "demo-2.daily.paashup.cloud", template: "demo", status: "creating" },
          { instance: "demo-3.daily.paashup.cloud", template: "demo", status: "failed" },
        ],
        max: 3,
        profile: "demo",
        remaining: 0,
        reached: true,
        used: 3,
      }),
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
  await page.route("**/delete", async (route) => {
    deleteBody = route.request().postData() || "";
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });

  await openAdmin(page, {
    profile: "demo",
    profiles: JSON.stringify({
      demo: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "DEMO",
        max_instances: 3,
      },
    }),
  }, {
    demo: {
      config_profile: "demo",
      network: "traefik-public",
      image: "saashup/demo",
      template_url: "/demo-home",
      ports: [{ value: "3000" }],
    },
  }, [], undefined, "/order?template=demo");

  await expect(page.locator("#orderLoading")).toBeHidden();
  await expect(page.locator("#orderActions")).toBeHidden();
  await expect(page.locator("#orderInstances")).toBeVisible();
  await expect(page.locator("#orderInstances .order-instances-header .eyebrow")).toHaveText("Your instances");
  await expect(page.locator("#orderInstances .order-instances-count")).toHaveText("3 / 3");
  await expect(page.locator("#orderInstances .order-instances-count")).toHaveClass(/limit-reached/);
  const orderInstancesBox = await page.locator("#orderInstances").boundingBox();
  expect(orderInstancesBox).not.toBeNull();
  expect(Math.round(orderInstancesBox.width)).toBe(760);
  await expect(page.locator("#orderInstances")).toContainText("demo-1.daily.paashup.cloud");
  await expect(page.locator(".order-instance-card").first().locator(".order-instance-copy strong")).toHaveText("demo");
  await expect(page.locator(".order-instance-card").first().locator(".order-instance-open")).toHaveAttribute("href", "https://demo-1.daily.paashup.cloud");
  await expect(page.locator(".order-instance-card").first().locator(".order-instance-delete")).toBeVisible();
  await expect(page.locator(".order-instance-card").first().locator(".order-instance-state")).toHaveText("Ready");
  await expect(page.locator(".order-instance-card").nth(1).locator(".order-instance-delete")).toBeHidden();
  await expect(page.locator(".order-instance-card").nth(1).locator(".order-instance-status-creating")).toBeVisible();
  await expect(page.locator(".order-instance-card").nth(1).locator(".order-instance-state")).toHaveText("Creating");
  await expect(page.locator(".order-instance-card").nth(2).locator(".order-instance-delete")).toBeHidden();
  await expect(page.locator(".order-instance-card").nth(2).locator(".order-instance-status-failed")).toBeVisible();
  await expect(page.locator(".order-instance-card").nth(2).locator(".order-instance-state")).toHaveText("Failed");
  await expect(page.locator("#orderStatus")).toHaveClass(/error/);
  await expect(page.locator("#orderStatus")).toContainText("You have reached your maximum of 3 instances.");
  await expect(page.locator("#orderStatus .order-status-home")).toHaveCount(0);
  expect(createCalled).toBe(false);

  page.on("dialog", (dialog) => dialog.accept());
  await page.locator(".order-instance-card").first().locator(".order-instance-delete").click();
  await expect.poll(() => deleteBody).toContain("instance=demo-1.daily.paashup.cloud");
  await expect(page.locator(".order-instance-card").first().locator(".order-instance-status-deleting")).toBeVisible();
  await expect(page.locator(".order-instance-card").first().locator(".order-instance-state")).toHaveText("Deleting");
  await expect(page.locator(".order-instance-card").nth(1).locator(".order-instance-status-creating")).toBeVisible();
  await expect(page.locator(".order-instance-card").nth(1).locator(".order-instance-state")).toHaveText("Creating");
  await expect(page.locator("#orderStatus")).toContainText("Delete requested for demo-1.daily.paashup.cloud.");
  await expect(page.locator("#orderStatus .order-status-home")).toHaveCount(0);
});

test("order page remains usable when public images are disabled for non-admin users", async ({ page }) => {
  await page.route("**/session/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "Buyer Example",
        user: "buyer",
        email: "buyer@example.com",
        admin: false,
        public_image: false,
      }),
    });
  });

  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: "saashup/demo", version: "v1.0.0" }]),
    });
  });

  await page.route("**/order/limit?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        instances: [],
        max: 2,
        profile: "demo",
        remaining: 2,
        reached: false,
        used: 0,
      }),
    });
  });

  await openAdmin(page, {
    profile: "demo",
    profiles: JSON.stringify({
      demo: {
        netbox: "https://netbox.example.com",
        token: "secret",
        domain: "daily.paashup.cloud",
        tag: "DEMO",
      },
    }),
  }, {
    demo: {
      config_profile: "demo",
      network: "traefik-public",
      image: "saashup/demo",
      version: "v1.0.0",
      ports: [{ value: "3000" }],
    },
  }, [], undefined, "/order?template=demo");

  await expect(page.locator("#orderLoading")).toBeHidden();
  await expect(page.locator("#instanceForm")).toBeVisible();
  await expect(page.locator("#orderActions")).toBeVisible();
  await expect(page.locator("#submitBtn")).toBeVisible();
  await expect(page.locator("#orderStatus")).toBeHidden();
  await expect(page.locator('.order-page-menu a[href="/enroll"]')).toBeHidden();
  await expect(page.locator("#adminLink")).toBeHidden();
});

test("order page shows oauth user and logs out through app auth", async ({ page }) => {
  let resolveAuth;
  const authReady = new Promise((resolve) => {
    resolveAuth = resolve;
  });

  await page.route("**/session/user", async (route) => {
    await authReady;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "Ada Lovelace",
        user: "ada",
        email: "ada@example.com",
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
        instances: [],
        max: 1,
        profile: "demo",
        remaining: 1,
        reached: false,
        used: 0,
      }),
    });
  });

  await openAdmin(page, {
    profile: "demo",
    profiles: JSON.stringify({
      demo: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "DEMO",
      },
    }),
  }, {
    demo: {
      config_profile: "demo",
      network: "traefik-public",
      image: "saashup/demo",
      ports: [{ value: "3000" }],
    },
  }, [], undefined, "/order?template=demo");

  await expect(page.locator("#orderLoading")).toBeVisible();
  await expect(page.locator("#orderActions")).toBeHidden();

  resolveAuth();

  await expect(page.locator("#authUser")).toBeVisible();
  await expect(page.locator("#authAvatar")).toHaveText("AL");
  await expect(page.locator("#authName")).toHaveText("Ada Lovelace");
  await expect(page.locator("#authEmail")).toHaveText("ada@example.com");
  await expect(page.locator("#orderLoading")).toBeHidden();
  await expect(page.locator("#orderActions")).toBeVisible();
  await expect(page.locator(".order-question")).toHaveText("Do you  want to install an instance?");

  await page.locator("#logoutBtn").click();
  await expect(page).toHaveURL("/");
});

test("order page shows cached oauth user while refreshing session", async ({ page }) => {
  let resolveAuth;
  const authReady = new Promise((resolve) => {
    resolveAuth = resolve;
  });

  await page.route("**/session/user", async (route) => {
    await authReady;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "Ada Lovelace",
        user: "ada",
        email: "ada@example.com",
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
        instances: [],
        max: 1,
        profile: "demo",
        remaining: 1,
        reached: false,
        used: 0,
      }),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem("saashup_auth_user", JSON.stringify({
      name: "Cached User",
      email: "cached@example.com",
    }));
  });

  await openAdmin(page, {
    profile: "demo",
    profiles: JSON.stringify({
      demo: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "DEMO",
      },
    }),
  }, {
    demo: {
      config_profile: "demo",
      network: "traefik-public",
      image: "saashup/demo",
      ports: [{ value: "3000" }],
    },
  }, [], undefined, "/order?template=demo");

  await expect(page.locator("#authUser")).toBeVisible();
  await expect(page.locator("#authAvatar")).toHaveText("CU");
  await expect(page.locator("#authName")).toHaveText("Cached User");
  await expect(page.locator("#authEmail")).toHaveText("cached@example.com");
  await expect(page.locator("#orderLoading")).toBeVisible();

  resolveAuth();

  await expect(page.locator("#authAvatar")).toHaveText("AL");
  await expect(page.locator("#authName")).toHaveText("Ada Lovelace");
  await expect(page.locator("#authEmail")).toHaveText("ada@example.com");
  await expect(page.locator("#orderLoading")).toBeHidden();

  const cachedUser = await page.evaluate(() => JSON.parse(localStorage.getItem("saashup_auth_user")));
  expect(cachedUser.name).toBe("Ada Lovelace");
  expect(cachedUser.email).toBe("ada@example.com");
});

test("order page generates and submits an instance name when the template has none", async ({ page }) => {
  let createBody = "";
  const imageUrls = [];
  const templates = {
    curiootiles: {
      config_profile: "tile",
      network: "traefik-public",
      image: "saashup/curiootiles",
      env: [],
      labels: [],
      ports: [{ value: "3000" }],
      volumes: [],
    },
  };

  await page.route("**/images?**", async (route) => {
    imageUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: "saashup/curiootiles", version: "v2.0.0" }]),
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

  await openAdmin(page, {
    profile: "tile",
    profiles: JSON.stringify({
      tile: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "TILE",
      },
    }),
  }, templates, [
    { instance: "tiles.example.com", networks: ["traefik-public"] },
  ], undefined, "/order?template=curiootiles");

  await expect(page.locator("#instance")).toHaveValue(/^tile-[a-z0-9]{16}$/);
  expect(imageUrls).toHaveLength(1);
  const imageUrl = new URL(imageUrls[0]);
  expect(imageUrl.searchParams.get("profile")).toBe("tile");
  expect(imageUrl.searchParams.get("config_profile")).toBe("tile");
  expect(imageUrl.searchParams.get("tag")).toBe("TILE");
  expect(imageUrl.searchParams.has("netbox")).toBe(false);
  expect(imageUrl.searchParams.has("token")).toBe(false);
  expect(imageUrl.searchParams.has("proxy")).toBe(false);

  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).not.toBe("");
  const submitted = new URLSearchParams(createBody);
  const generatedName = submitted.get("instance");
  expect(generatedName).toMatch(/^tile-[a-z0-9]{16}$/);
  expect(submitted.get("dns_name")).toBe(`${generatedName}.daily.paashup.cloud`);
  await expect(page.locator("#orderStatus")).toHaveText(`Thank you, your instance installation has been requested for ${generatedName}.daily.paashup.cloud.`);
});

test("order page hides the order form when the requested template is missing", async ({ page }) => {
  await openAdmin(page, {
    profile: "tile",
    profiles: JSON.stringify({
      tile: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "TILE",
      },
    }),
  }, {}, [], undefined, "/order?template=missing");

  await expect(page.locator("#orderActions")).toBeHidden();
  await expect(page.locator("#orderStatus")).toHaveClass(/error/);
  await expect(page.locator("#orderStatus")).toHaveText('Template "missing" not found');
  await expect(page.locator("#orderStatus .order-status-home")).toHaveCount(0);
});

test("order page uses the server default profile for bare template links", async ({ page }) => {
  let createBody = "";
  await page.addInitScript(() => {
    localStorage.setItem("current_config_profile", "stale");
    localStorage.setItem("config_profiles", JSON.stringify({
      stale: {
        netbox: "https://stale.example.com",
        token: "stale",
        tag: "stale",
      },
    }));
  });

  await page.route("**/order/limit?**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        instances: [],
        max: 1,
        profile: url.searchParams.get("profile") || "SaaShup",
        remaining: 1,
        reached: false,
        used: 0,
        total_used: 0,
        template: url.searchParams.get("template") || "nginx",
      }),
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

  await openAdmin(page, {
    profile: "SaaShup",
    profiles: JSON.stringify({
      install: {
        netbox: "https://netbox.example.com",
        token: "secret",
        tag: "install",
      },
      SaaShup: {
        netbox: "https://netbox.example.com",
        token: "secret",
        domain: "",
        tag: "saashup",
      },
    }),
  }, {
    templates: {
      nginx: {
        config_profile: "SaaShup",
        image: "nginx",
        version: "1.31.1",
        network: "traefik-net",
        ports: [{ value: "80" }],
        saashup_enabled: true,
      },
    },
    workflows: {},
  }, [], undefined, "/order?template=nginx");

  await expect(page.locator("#orderLoading")).toBeHidden();
  await expect(page.locator("#orderActions")).toBeVisible();
  await expect(page.locator("#config_profile")).toHaveValue("SaaShup");
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  await expect(page.locator("#image")).toHaveValue("nginx");

  const generatedName = await page.locator("#instance").inputValue();
  await page.locator("#submitBtn").click();
  await expect.poll(() => createBody).toContain(`instance=${generatedName}`);
  expect(createBody).toContain("order_request=true");
  expect(createBody).toContain("order_template=nginx");
});

test("order page without a template lists all owned containers", async ({ page }) => {
  await page.route("**/order/limit?**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("template")).toBe("");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        instances: [
          { instance: "tile.daily.paashup.cloud", template: "curiootiles", status: "ready" },
          { instance: "guide.daily.paashup.cloud", template: "guide", status: "ready" },
        ],
        max: 1,
        profile: "prod",
        remaining: 0,
        reached: true,
        used: 0,
        total_used: 2,
      }),
    });
  });

  await openAdmin(page, {
    profile: "prod",
    profiles: JSON.stringify({
      prod: {
        netbox: "https://netbox.example.com",
        token: "secret",
        domain: "daily.paashup.cloud",
        saashup_default: true,
      },
    }),
  }, {}, [], undefined, "/order");

  await expect(page.locator("#orderActions")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "My instances" })).toHaveAttribute("href", "/order");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "My instances" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "My images" })).toHaveAttribute("href", "/enroll");
  await expect(page.getByRole("navigation", { name: "Account pages" }).getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/catalog");
  await expect(page.locator("#orderInstances .order-instances-count")).toHaveText("2");
  await expect(page.locator("#orderInstances")).toContainText("tile.daily.paashup.cloud");
  await expect(page.locator("#orderInstances")).toContainText("guide.daily.paashup.cloud");
});

test("order page hides the order form when the requested template is disabled", async ({ page }) => {
  await openAdmin(page, {
    profile: "tile",
    profiles: JSON.stringify({
      tile: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "TILE",
      },
    }),
  }, {
    test: {
      config_profile: "tile",
      network: "traefik-public",
      image: "saashup/test",
      template_url: "https://templates.example.com/test",
      ports: [{ value: "3000" }],
      saashup_enabled: false,
    },
  }, [], undefined, "/order?template=test");

  await expect(page.locator("#orderActions")).toBeHidden();
  await expect(page.locator("#orderStatus")).toHaveClass(/error/);
  await expect(page.locator("#orderStatus")).toHaveText('Template "test" is disabled for orders');
  await expect(page.locator("#orderStatus .order-status-home")).toHaveCount(0);
});

test("order page displays an error when create is not accepted", async ({ page }) => {
  const templates = {
    curiootiles: {
      config_profile: "tile",
      network: "traefik-public",
      instance: "curiootiles",
      image: "saashup/curiootiles",
      env: [],
      labels: [],
      ports: [{ value: "3000" }],
      volumes: [],
    },
  };

  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: "saashup/curiootiles", version: "v2.0.0" }]),
    });
  });

  await page.route("**/create", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: "{}",
    });
  });

  await openAdmin(page, {
    profile: "tile",
    profiles: JSON.stringify({
      tile: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "TILE",
      },
    }),
  }, templates, [
    { instance: "tiles.example.com", networks: ["traefik-public"] },
  ], undefined, "/order?template=curiootiles");

  await page.locator("#submitBtn").click();

  await expect(page.locator("#orderActions")).toBeVisible();
  await expect(page.locator("#submitBtn")).toBeEnabled();
  await expect(page.locator("#orderStatus")).toHaveClass(/error/);
  await expect(page.locator("#orderStatus")).toHaveText("Installation request failed (500)");
});

test("order page no button redirects to home", async ({ page }) => {
  const templates = {
    curiootiles: {
      config_profile: "tile",
      network: "traefik-public",
      instance: "curiootiles",
      image: "saashup/curiootiles",
      template_url: "/curiootiles-home",
      env: [],
      labels: [],
      ports: [{ value: "3000" }],
      volumes: [],
    },
  };

  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: "saashup/curiootiles", version: "v2.0.0" }]),
    });
  });

  await openAdmin(page, {
    profile: "tile",
    profiles: JSON.stringify({
      tile: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "TILE",
      },
    }),
  }, templates, [], undefined, "/order?template=curiootiles");

  await page.locator("#orderCancelBtn").click();
  await expect(page).toHaveURL(/\/curiootiles-home$/);
});
