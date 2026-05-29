const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const nodeRedUtil = require("@node-red/util").util;

const repoRoot = path.resolve(__dirname, "../..");

function readFlows() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "flows.json"), "utf8"));
}

function flowNode(id) {
  const node = readFlows().find((item) => item.id === id);
  if (!node) throw new Error(`Missing flow node ${id}`);
  return node;
}

function changeRule(nodeId, property) {
  const node = flowNode(nodeId);
  const rule = (node.rules || []).find((item) => item.p === property);
  if (!rule) throw new Error(`Missing rule ${property} on ${nodeId}`);
  return { node, rule };
}

function evaluateJsonata(nodeId, property, msg) {
  const { node, rule } = changeRule(nodeId, property);
  return evaluateJsonataRule(node, rule, msg);
}

function evaluateJsonataRule(node, rule, msg) {
  const expression = nodeRedUtil.prepareJSONataExpression(rule.to, node);

  return new Promise((resolve, reject) => {
    nodeRedUtil.evaluateJSONataExpression(expression, msg, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function ruleValue(nodeId, property) {
  return changeRule(nodeId, property).rule.to;
}

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

test("home top bar links to order and extensionless admin", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".site-header .nav .nav-cta")).toHaveText(["Order", "Open admin"]);
  await expect(page.locator(".site-header .nav .nav-cta").first()).toHaveAttribute("href", "/order");
  await expect(page.locator(".site-header .nav .nav-cta").last()).toHaveAttribute("href", "/admin");

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("#form-title")).toHaveText("Config");
});

test("config tab starts without a forced default profile", async ({ page }) => {
  await openAdmin(page, {});

  await expect(page.locator("#form-title")).toHaveText("Config");
  await expect(page.locator("#config_profile")).toHaveValue("");
  await expect(page.locator("#config_profile option")).toHaveText("No config saved");
  await expect(page.locator("#config_name")).toHaveValue("");
  await expect(page.locator("#netbox")).toHaveValue("");
  await expect(page.locator("#token")).toHaveValue("");
  await expect(page.locator("#domain")).toHaveValue("");
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
        domain: "apps.example.com",
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
        domain: "apps.example.com",
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
  expect(webhookBody).toContain("domain=");

  await page.reload();
  await expect(page.locator("#config_profile")).toHaveValue("");
  await expect(page.locator("#config_profile option")).toHaveText("No config saved");
});

test("create form supports repeatable env, labels, and volumes", async ({ page }) => {
  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/guide", version: "v1.2.3" },
        { name: "saashup/guide", version: "v1.10.0" },
        { name: "saashup/other", version: "v9.0.0" },
      ]),
    });
  });

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();

  await expect(page.locator("[data-field='hostname']")).toHaveCount(0);
  await expect(page.locator("#refreshInstancesBtn")).toBeHidden();
  await expect(page.locator("#instance")).toHaveValue(/^production-[a-z0-9]{16}$/);
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  await expect(page.locator("#network")).toHaveAttribute("readonly", "");
  await expect(page.locator("#version")).toHaveAttribute("readonly", "");
  await expect(page.locator("[data-field='env_vars']")).toBeVisible();
  await expect(page.locator("[data-field='labels']")).toBeVisible();
  await expect(page.locator("[data-field='volumes']")).toBeVisible();

  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 2 images");
  await page.locator("#image").fill("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.10.0");

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

test("create form generates a random instance name when empty", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();

  const firstName = await page.locator("#instance").inputValue();
  expect(firstName).toMatch(/^production-[a-z0-9]{16}$/);

  await page.locator("#clearBtn").click();

  await expect(page.locator("#instance")).toHaveValue(/^production-[a-z0-9]{16}$/);
  await expect.poll(() => page.locator("#instance").inputValue()).not.toBe(firstName);
});

test("create form derives the highest version from full image references", async ({ page }) => {
  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        "registry.example.com:5000/saashup/guide:v1.9.0",
        { display: "registry.example.com:5000/saashup/guide:v1.12.0" },
        { name: "registry.example.com:5000/saashup/guide", display: "registry.example.com:5000/saashup/guide:v1.10.0" },
      ]),
    });
  });

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 1 images");
  await page.locator("#image").fill("registry.example.com:5000/saashup/guide");

  await expect(page.locator("#version")).toHaveValue("v1.12.0");
});

test("create form refreshes images automatically when an image is entered", async ({ page }) => {
  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/guide:v1.3.0" },
        { name: "saashup/guide", tag: { display: "v1.5.0" } },
      ]),
    });
  });

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await page.locator("#image").fill("saashup/guide");
  await page.locator("#image").blur();

  await expect(page.locator("#version")).toHaveValue("v1.5.0");
});

test("create form refreshes again when the selected image is missing from the cache", async ({ page }) => {
  let imageRequestCount = 0;

  await page.route("**/images?**", async (route) => {
    imageRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(imageRequestCount === 1
        ? [{ name: "saashup/other", version: "v9.0.0" }]
        : [{ name: "saashup/guide", version: "v2.0.0" }]),
    });
  });

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#notif")).toContainText("Welcome !");
  await page.locator("#image").fill("saashup/guide");
  await page.locator("#image").blur();

  await expect(page.locator("#version")).toHaveValue("v2.0.0");
});

test("create form refreshes images for the selected config profile tag", async ({ page }) => {
  const imageTags = [];

  await page.route("**/images?**", async (route) => {
    const tag = new URL(route.request().url()).searchParams.get("tag") || "";
    imageTags.push(tag);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tag === "TILE"
        ? [{ name: "saashup/tile", version: "v2.0.0" }]
        : [{ name: "saashup/guide", version: "v1.0.0" }]),
    });
  });

  await openAdmin(page, {
    profile: "guide",
    profiles: JSON.stringify({
      guide: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "GUIDE",
      },
      tile: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "TILE",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await expect.poll(() => page.locator("#imageOptions option").evaluateAll((options) => options.map((option) => option.value))).toEqual(["saashup/guide"]);

  await page.locator("#image").fill("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.0.0");

  await page.locator("#config_profile").selectOption("tile");
  await expect(page.locator("#image")).toHaveValue("");
  await expect(page.locator("#version")).toHaveValue("");
  await expect.poll(() => page.locator("#imageOptions option").evaluateAll((options) => options.map((option) => option.value))).toEqual(["saashup/tile"]);

  await page.locator("#image").fill("saashup/tile");
  await expect(page.locator("#version")).toHaveValue("v2.0.0");
  expect(imageTags).toContain("GUIDE");
  expect(imageTags).toContain("TILE");
});

test("create template switches to its saved config profile", async ({ page }) => {
  const imageTags = [];

  await page.route("**/images?**", async (route) => {
    const tag = new URL(route.request().url()).searchParams.get("tag") || "";
    imageTags.push(tag);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tag === "TILE"
        ? [{ name: "saashup/tile", version: "v2.0.0" }]
        : [{ name: "saashup/guide", version: "v1.0.0" }]),
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
        domain: "tile.example.com",
        tag: "TILE",
      },
    }),
  }, {
    Tile: {
      config_profile: "tile",
      network: "traefik-net",
      instance: "tile-app",
      image: "saashup/tile",
      env: [],
      labels: [],
      volumes: [],
    },
  });

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#config_profile")).toHaveValue("guide");

  await page.locator("#templateSelect").selectOption("Tile");

  await expect(page.locator("#config_profile")).toHaveValue("tile");
  await expect(page.locator("#domain")).toHaveValue("tile.example.com");
  await expect(page.locator("#tag")).toHaveValue("TILE");
  await expect(page.locator("#image")).toHaveValue("saashup/tile");
  await expect(page.locator("#version")).toHaveValue("v2.0.0");
  expect(imageTags).toContain("TILE");
});

test("create form derives version from a pasted image tag", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await page.locator("#image").fill("registry.example.com:5000/saashup/guide:v3.1.4");

  await expect(page.locator("#version")).toHaveValue("v3.1.4");
});

test("create form selects the network starting with traefik", async ({ page }) => {
  const instanceTags = [];

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "TILE",
      },
    }),
  }, {}, (route) => {
    instanceTags.push(new URL(route.request().url()).searchParams.get("tag"));
    return [
      { instance: "tile-app", networks: ["bridge", "traefik-tile"] },
    ];
  });

  await page.getByRole("link", { name: "Create" }).click();

  await expect(page.locator("#network")).toHaveValue("traefik-tile");
  expect(instanceTags).toContain("TILE");
});

test("create form requires an fqdn instance name", async ({ page }) => {
  let createSubmitted = false;

  await page.route("**/create", async (route) => {
    createSubmitted = true;
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
        tag: "TILE",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await page.locator("#instance").fill("guide-app");
  await page.locator("#image").fill("saashup/guide");
  await page.locator("#submitBtn").click();

  await expect(page.locator("#notif")).toContainText("Instance name must be a fully qualified domain name");
  expect(createSubmitted).toBe(false);
});

test("create form appends the configured domain to short instance names", async ({ page }) => {
  let createBody = "";

  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/tiles", version: "v1.0.0" },
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

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "daily.paashup.cloud",
        tag: "TILE",
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await page.locator("#instance").fill("tiles");
  await page.locator("#image").fill("saashup/tiles");
  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).toContain("instance=tiles.daily.paashup.cloud");
  expect(createBody).toContain("domain=daily.paashup.cloud");
  await expect(page.locator("#instance")).toHaveValue("tiles.daily.paashup.cloud");
});

test("create form can import a docker run command", async ({ page }) => {
  let instanceRequestCount = 0;

  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/guide", version: "v1.2.3" },
        { name: "saashup/guide", version: "v2.0.0" },
      ]),
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
  }, {}, () => {
    instanceRequestCount += 1;
    return [
      {
        instance: "guide-app",
        networks: instanceRequestCount === 1
          ? ["bridge", "traefik-net"]
          : ["bridge", "traefik-later"],
      },
    ];
  });

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 1 images");
  const requestsBeforeImport = instanceRequestCount;
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
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  expect(instanceRequestCount).toBe(requestsBeforeImport);
  await expect(page.locator("#image")).toHaveValue("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v2.0.0");
  await expect(page.locator("#var_env_key")).toHaveValue("APP_ENV");
  await expect(page.locator("#var_env_value")).toHaveValue("production");
  await expect(page.locator("#label_key")).toHaveValue("traefik.enable");
  await expect(page.locator("#label_value")).toHaveValue("true");
  await expect(page.locator("#volume_source")).toHaveValue("/app/data");
  await expect(page.locator("#volume_name")).toHaveValue("guide-data");
});

test("create form can save and load templates", async ({ page }) => {
  let imageRequestCount = 0;

  await page.route("**/images?**", async (route) => {
    imageRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/guide", version: "v1.2.3" },
        { name: "saashup/guide", version: "v1.10.0" },
      ]),
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

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#saveTemplateBtn")).toBeVisible();
  await expect(page.locator("#saveTemplateBtn")).toHaveText("Save template");
  await expect(page.locator("#deleteTemplateBtn")).toBeVisible();

  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 1 images");
  await page.locator("#instance").fill("guide-app");
  await page.locator("#image").fill("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.10.0");
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
  const imageRequestsBeforeLoad = imageRequestCount;

  await page.locator("#templateSelect").selectOption("Guide");
  await expect(page.locator("#notif")).toContainText('Template "Guide" loaded');
  expect(imageRequestCount).toBeGreaterThanOrEqual(imageRequestsBeforeLoad);
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  await expect(page.locator("#instance")).toHaveValue("guide-app");
  await expect(page.locator("#image")).toHaveValue("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.10.0");
  await expect(page.locator("#var_env_key")).toHaveValue("APP_ENV");
  await expect(page.locator("#label_key")).toHaveValue("traefik.enable");
  await expect(page.locator("#volume_source")).toHaveValue("/app/data");

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#deleteTemplateBtn").click();
  await expect(page.locator("#notif")).toContainText('Template "Guide" deleted');
  await expect(page.locator("#templateSelect option")).toHaveText("No templates saved");
});

test("order page creates an instance from the requested template", async ({ page }) => {
  let createBody = "";
  let logsRequests = 0;
  const templates = {
    curiootiles: {
      config_profile: "tile",
      network: "traefik-public",
      instance: "curiootiles",
      image: "saashup/curiootiles",
      env: [{ key: "APP_ENV", value: "production" }],
      labels: [{ key: "traefik.enable", value: "true" }],
      volumes: [{ key: "/app/data", value: "curiootiles-data" }],
    },
  };

  await page.route("**/images?**", async (route) => {
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
  }, templates, [
    { instance: "tiles.example.com", networks: ["traefik-public"] },
  ], async (route) => {
    logsRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "",
    });
  }, "/order?template=curiootiles");

  await expect(page).toHaveURL(/\/order\?template=curiootiles$/);
  await expect(page.locator("#submitBtn")).toBeVisible();
  await expect(page.locator(".order-question")).toHaveText("Are you sure you want to install an instance?");
  await expect(page.locator("#submitBtn")).toHaveText("Yes");
  await expect(page.locator("#orderCancelBtn")).toHaveText("No");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator("#image")).toBeHidden();
  await expect(page.locator("#config_profile")).toHaveValue("tile");
  await expect(page.locator("#instance")).toHaveValue(/^tile-[a-z0-9]{16}$/);
  const generatedName = await page.locator("#instance").inputValue();
  await expect(page.locator("#image")).toHaveValue("saashup/curiootiles");
  await expect(page.locator("#version")).toHaveValue("v2.0.0");

  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).toContain(`instance=${generatedName}.daily.paashup.cloud`);
  await expect(page.locator("#orderActions")).toBeHidden();
  await expect(page.locator("#orderStatus")).toHaveClass(/success/);
  await expect(page.locator("#orderStatus")).toHaveText(`Thank you, your instance installation has been requested for ${generatedName}.daily.paashup.cloud.`);
  expect(createBody).toContain("profile=tile");
  expect(createBody).toContain("tag=TILE");
  expect(createBody).toContain("network=traefik-public");
  expect(createBody).toContain("image=saashup%2Fcuriootiles");
  expect(createBody).toContain("version=v2.0.0");
  expect(createBody).toContain("var_env_key=APP_ENV");
  expect(createBody).toContain("var_env_value=production");
  expect(logsRequests).toBe(0);
});

test("order page generates and submits an instance name when the template has none", async ({ page }) => {
  let createBody = "";
  const templates = {
    curiootiles: {
      config_profile: "tile",
      network: "traefik-public",
      image: "saashup/curiootiles",
      env: [],
      labels: [],
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
  const generatedName = await page.locator("#instance").inputValue();

  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).toContain(`instance=${generatedName}.daily.paashup.cloud`);
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
      env: [],
      labels: [],
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
  await expect(page).toHaveURL(/\/$/);
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
      body: JSON.stringify([
        { name: "saashup/app", version: "v1.0.0" },
        { name: "saashup/other", version: "v2.0.0" },
      ]),
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
  await page.locator("#image").fill("old-filter");
  await page.locator("#oldversion").fill("old-version");
  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#image")).toHaveValue("");
  await expect(page.locator("#oldversion")).toHaveValue("");
  await expect.poll(() => page.locator("#imageOptions option").evaluateAll((options) => options.map((option) => option.value))).toEqual([
    "saashup/app",
    "saashup/other",
  ]);
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

  await expect.poll(() => recreateBody).toContain("clean_name=true");
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

  await expect.poll(() => refreshBody).toContain("tag=production");
  expect(refreshBody).toContain("tag=production");
});

test("delete instance refresh submits the configured tag", async ({ page }) => {
  let instancesUrl = "";

  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "TILE",
      },
    }),
  }, {}, (route) => {
    instancesUrl = route.request().url();
    return [
      { instance: "tiles.example.com", networks: ["traefik-public"] },
    ];
  });

  await page.getByRole("link", { name: "Delete" }).click();
  await page.locator("#instance").fill("old-filter");
  await page.locator("#refreshInstancesBtn").click();

  await expect(page.locator("#notif")).toContainText("Loaded 1 instances");
  await expect(page.locator("#instance")).toHaveValue("");
  await expect.poll(() => page.locator("#instanceOptions option").evaluateAll((options) => options.map((option) => option.value))).toEqual(["tiles.example.com"]);
  expect(new URL(instancesUrl).searchParams.get("tag")).toBe("TILE");
});

test("restart instance refresh clears the instance input before showing choices", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "TILE",
      },
    }),
  }, {}, [
    { instance: "tiles.example.com", networks: ["traefik-public"] },
    { instance: "guide.example.com", networks: ["traefik-public"] },
  ]);

  await page.getByRole("link", { name: "Restart" }).click();
  await page.locator("#instance").fill("old-filter");
  await page.locator("#refreshInstancesBtn").click();

  await expect(page.locator("#notif")).toContainText("Loaded 2 instances");
  await expect(page.locator("#instance")).toHaveValue("");
  await expect.poll(() => page.locator("#instanceOptions option").evaluateAll((options) => options.map((option) => option.value))).toEqual([
    "guide.example.com",
    "tiles.example.com",
  ]);
});

test("refresh hosts requires saved NetBox credentials", async ({ page }) => {
  let requested = false;

  await page.route("**/refresh-hosts", async (route) => {
    requested = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });

  await openAdmin(page, {});

  await page.getByRole("link", { name: "Refresh" }).click();
  await page.locator("#submitBtn").click();

  await expect(page.locator("#notif")).toHaveText("Save NetBox URL and token for this profile first");
  expect(requested).toBe(false);
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
  await expect(page.locator("#logsFullscreenBtn")).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#logsCard")).not.toHaveClass(/fullscreen/);
  await expect(page.locator("#logsFullscreenBtn")).toHaveAttribute("aria-pressed", "false");

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#clearLogsBtn").click();
  await expect(page.locator("#notif")).toContainText("Logs cleared");
});

test("submitting an action clears logs before starting the job", async ({ page }) => {
  const events = [];

  await page.route("**/refresh-hosts", async (route) => {
    events.push("refresh");
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
        tag: "TILE",
      },
    }),
  }, {}, [
    { instance: "guide-app", networks: ["bridge", "traefik-net"] },
  ], async (route) => {
    if (route.request().method() === "DELETE") events.push("clear");

    await route.fulfill({
      status: route.request().method() === "DELETE" ? 204 : 200,
      contentType: "text/plain",
      body: "old log",
    });
  });

  await page.getByRole("link", { name: "Refresh" }).click();
  await page.locator("#submitBtn").click();

  await expect(page.locator("#notif")).toContainText("Refresh Docker hosts requested");
  await expect.poll(() => events).toEqual(["clear", "refresh"]);
});

test("docker run parser supports quoted values and registry ports", async ({ page }) => {
  await openAdmin(page, {});

  const parsed = await page.evaluate(() => window.parseDockerRun([
    "docker run --name tile-api --network proxy",
    "--env PUBLIC_URL=https://tiles.example.com/a?b=c",
    "--label traefik.http.routers.tile.rule=Host(`tiles.example.com`)",
    "--volume tile-cache:/app/cache:ro",
    "registry.example.com:5000/saashup/tile-api:v2.4.1",
  ].join(" ")));

  expect(parsed).toMatchObject({
    instance: "tile-api",
    network: "proxy",
    image: "registry.example.com:5000/saashup/tile-api",
    version: "v2.4.1",
  });
  expect(parsed.env).toContainEqual({ key: "PUBLIC_URL", value: "https://tiles.example.com/a?b=c" });
  expect(parsed.labels).toContainEqual({
    key: "traefik.http.routers.tile.rule",
    value: "Host(`tiles.example.com`)",
  });
  expect(parsed.volumes).toContainEqual({ name: "tile-cache", source: "/app/cache" });
});

test("log formatter escapes unexpected html content", async ({ page }) => {
  await openAdmin(page, {});

  const formatted = await page.evaluate(() => window.formatLogs(
    "2026-05-29T11:43:31.806Z REFRESH_HOST : <script>alert(1)</script> 200",
  ));

  expect(formatted).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(formatted).not.toContain("<script>alert(1)</script>");
});

test("flows do not use function nodes", () => {
  const functionNodes = readFlows().filter((node) => node.type === "function");

  expect(functionNodes).toEqual([]);
});

test("all flow JSONata expressions compile", () => {
  const errors = [];

  for (const node of readFlows()) {
    for (const rule of node.rules || []) {
      if (rule.tot !== "jsonata") continue;

      try {
        nodeRedUtil.prepareJSONataExpression(rule.to, node);
      } catch (error) {
        errors.push(`${node.id}:${node.name || node.type}:${rule.p} ${error.message}`);
      }
    }
  }

  expect(errors).toEqual([]);
});

test("host lookups fetch all hosts and do not rely on NetBox tag query", () => {
  const hostLookupRules = readFlows()
    .flatMap((node) => (node.rules || []).map((rule) => ({ node, rule })))
    .filter(({ rule }) => rule.p === "url" && String(rule.to).includes("/api/plugins/docker/hosts/?limit=1000"));

  expect(hostLookupRules.length).toBeGreaterThan(0);
  for (const { node, rule } of hostLookupRules) {
    expect(rule.to, node.name || node.id).not.toContain("&tag=");
  }
});

test("refresh host filter selects every host tagged with the requested tag", async () => {
  const hosts = await evaluateJsonata("refresh_hosts_results", "payload", {
    tag: "TILE",
    tag_slug: "tile",
    payload: {
      results: [
        { id: 1, name: "curio-city-guide-1", tags: [{ name: "GUIDE", slug: "guide", display: "GUIDE" }] },
        { id: 2, name: "curioo-city-overpass1", tags: [{ name: "TILE", slug: "tile", display: "TILE" }] },
        { id: 3, name: "curioo-city-overpass2", tags: [{ name: "TILE", slug: "tile", display: "TILE" }] },
        { id: 4, name: "curioo-city-index", tags: [] },
      ],
    },
  });

  expect(hosts.map((host) => host.name)).toEqual(["curioo-city-overpass1", "curioo-city-overpass2"]);
});

test("refresh host filter supports custom field tag fallbacks", async () => {
  const hosts = await evaluateJsonata("refresh_hosts_results", "payload", {
    tag: "TILE",
    tag_slug: "tile",
    payload: {
      results: [
        { id: 1, name: "tag-object", tags: [], custom_fields: { role: "TILE" } },
        { id: 2, name: "cf-object", tags: [], cf: { role: "tile" } },
        { id: 3, name: "plain-property", tags: [], tag: "TILE" },
        { id: 4, name: "not-a-match", tags: [], custom_fields: { role: "GUIDE" } },
      ],
    },
  });

  expect(hosts.map((host) => host.name)).toEqual(["tag-object", "cf-object", "plain-property"]);
});

test("refresh host filter returns all hosts when no tag is configured", async () => {
  const hosts = await evaluateJsonata("refresh_hosts_results", "payload", {
    tag: "",
    tag_slug: "",
    payload: {
      results: [
        { id: 1, name: "host-a", tags: [] },
        { id: 2, name: "host-b", tags: [{ name: "TILE", slug: "tile" }] },
      ],
    },
  });

  expect(hosts.map((host) => host.name)).toEqual(["host-a", "host-b"]);
});

test("refresh host queue log stays concise without debug tag scan", () => {
  expect(ruleValue("refresh_hosts_log_queue", "payload")).not.toContain("host tag scan");
});

test("recreate host queue log reports how many hosts will be recreated", async () => {
  const node = flowNode("45e0558750363197");
  const rule = node.rules.find((item) => item.p === "payload" && item.to.includes("queued for recreation"));

  expect(rule).toBeTruthy();

  const message = await evaluateJsonataRule(node, rule, {
    tag: "TILE",
    logs: "previous log",
    host_queue: [
      { id: 10, host: { display: "curioo-city-overpass1" } },
      { id: 11, host: { name: "curioo-city-overpass2" } },
    ],
  });

  expect(message).toContain("RECREATE : 2 hosts queued for recreation");
  expect(message).toContain("[curioo-city-overpass1, curioo-city-overpass2]");
  expect(message).toContain("tag=TILE");
  expect(message).toContain("previous log");
});

test("restart image queue log reports how many hosts will be restarted", async () => {
  const node = flowNode("013b14aee24eebf9");
  const rule = node.rules.find((item) => item.p === "payload" && item.to.includes("$hostNames"));

  expect(rule).toBeTruthy();

  const message = await evaluateJsonataRule(node, rule, {
    tag: "TILE",
    logs: "previous log",
    image_queue: [
      { id: 20, host: { display: "curioo-city-overpass1" } },
      { id: 21, host: { display: "curioo-city-overpass1" } },
      { id: 22, host: { name: "curioo-city-overpass2" } },
    ],
  });

  expect(message).toContain("RESTART : 2 hosts queued for restart");
  expect(message).toContain("[curioo-city-overpass1, curioo-city-overpass2]");
  expect(message).toContain("tag=TILE");
  expect(message).toContain("previous log");
});

test("refresh host requests patch each host detail endpoint", () => {
  expect(ruleValue("refresh_hosts_patch_prepare", "url")).toContain("/api/plugins/docker/hosts/\" & msg.host.id & \"/\"");
  expect(ruleValue("refresh_hosts_patch_prepare", "payload")).toBe("{ \"operation\": \"refresh\" }");
});

test("refresh host loop waits for each host before dequeuing the next", () => {
  const logNode = flowNode("refresh_hosts_log");
  const readyLogNode = flowNode("refresh_hosts_wait_ready_log");
  const timeoutLogNode = flowNode("refresh_hosts_wait_timeout_log");

  expect(logNode.wires.flat()).toContain("refresh_hosts_wait_prepare");
  expect(readyLogNode.wires.flat()).toContain("refresh_hosts_dequeue_host");
  expect(timeoutLogNode.wires.flat()).toContain("refresh_hosts_dequeue_host");
});

test("instances response includes only network names starting with traefik", async () => {
  const instances = await evaluateJsonata("a1c1b1a0f0010004", "payload", {
    payload: {
      results: [
        {
          name: "tile-app",
          network_settings: [
            { network: { name: "bridge" } },
            { network: { name: "traefik-public" } },
            { network: { display: "Traefik-private" } },
          ],
        },
      ],
    },
  });

  expect(instances).toEqual([
    { instance: "tile-app", networks: ["Traefik-private", "traefik-public"] },
  ]);
});

test("tagged instances keep container network data after host fanout", async () => {
  const perHostInstances = await evaluateJsonata("instances_tagged_format_host_containers", "payload", {
    tag: "TILE",
    tag_slug: "tile",
    payload: {
      results: [
        {
          display: "tile-app",
          network_settings: [
            { network: { value: 1, name: "bridge" } },
            { network: { value: 2, name: "traefik-public" } },
          ],
        },
      ],
    },
  });
  const flattened = await evaluateJsonata("instances_tagged_flatten_containers", "payload", {
    payload: [
      perHostInstances,
      [{ instance: "guide-app", networks: ["guide-private"] }],
    ],
  });

  expect(flattened).toEqual([
    { instance: "tile-app", networks: ["traefik-public"] },
    { instance: "guide-app", networks: ["guide-private"] },
  ]);
});

test("create host candidate filter uses the same host tag semantics", async () => {
  const hosts = await evaluateJsonata("create_prepare_host_candidates", "host_candidates", {
    tag: "TILE",
    tag_slug: "tile",
    payload: {
      results: [
        { id: 1, name: "guide", tags: [{ name: "GUIDE", slug: "guide" }] },
        { id: 2, name: "overpass1", tags: [{ name: "TILE", slug: "tile" }] },
        { id: 3, name: "overpass2", tags: [], custom_fields: { role: "tile" } },
      ],
    },
  });

  expect(hosts.map((host) => host.name)).toEqual(["overpass1", "overpass2"]);
});

test("create init reads submitted version from the form payload", async () => {
  const version = await evaluateJsonata("2dcca2a38409fe43", "version", {
    config: {
      version: "v2.0.0",
    },
  });

  expect(version).toBe("v2.0.0");
});

test("create flow logs each provisioning stage", () => {
  expect(flowNode("62e25cd5752991bc").wires[0]).toContain("create_log_image_found");
  expect(flowNode("apply_proxy_1233e36c1ed40b2c").wires[0]).toContain("create_log_volume_created");
  expect(flowNode("apply_proxy_9f73f45cd7734d7f").wires[0]).toContain("create_log_container_created");
  expect(flowNode("apply_proxy_ddfa991fa8e68500").wires[0]).toContain("create_log_container_configured");
  expect(flowNode("apply_proxy_e0ec5be02bee7c3e").wires[0]).toContain("create_log_recreate_requested");
});

test("create cloudflare dns record uses post and logs the result", async () => {
  expect(ruleValue("458387080417f52a", "method")).toBe("GET");
  expect(ruleValue("2bc10654858e4154", "method")).toBe("POST");
  expect(flowNode("2dcca2a38409fe43").wires[0]).not.toContain("c9baa00a19d15c11");
  expect(flowNode("create_select_host").wires[0]).toContain("c9baa00a19d15c11");
  expect(flowNode("08a921bf4f9a4dc0").wires[1]).toContain("create_log_dns_zone_missing");
  expect(flowNode("apply_proxy_9a0bc1c9cbbaf0e2").wires[0]).toContain("create_log_dns_record_requested");

  const payload = await evaluateJsonata("2bc10654858e4154", "payload", {
    zoneid: 42,
    instance: "tiles.example.com",
    hostname: "curioo-city-overpass1",
    instanceZone: "example.com",
  });

  expect(payload).toEqual({
    zone: 42,
    name: "tiles.example.com",
    type: "CNAME",
    content: "curioo-city-overpass1.example.com",
    ttl: 60,
    proxied: true,
  });
});

test("create host candidate query includes all selected host ids", async () => {
  const queryString = await evaluateJsonata("create_prepare_host_candidates", "host_ids_qs", {
    host_candidates: [
      { id: 12, name: "overpass1" },
      { id: 13, name: "overpass2" },
    ],
  });

  expect(queryString).toBe("&host_id=12&host_id=13");
});

test("create host image lookup includes requested image, version, and selected host ids", async () => {
  const url = await evaluateJsonata("create_prepare_host_candidates", "url", {
    netbox: "https://netbox.example.com",
    image: "saashup/tiles",
    version: "v2.0.0",
    host_ids_qs: "&host_id=12&host_id=13",
  });

  expect(url).toBe("https://netbox.example.com/api/plugins/docker/images/?name=saashup/tiles&version=v2.0.0&limit=1000&host_id=12&host_id=13");
});

test("image refresh formatter preserves versions from display references", async () => {
  const images = await evaluateJsonata("a1c1b1a0f0020004", "payload", {
    payload: {
      results: [
        { display: "registry.example.com:5000/saashup/tiles:v2.7.10" },
        { name: "saashup/guide:v1.3.0" },
        { name: "saashup/guide", tag: { display: "v1.5.0" } },
      ],
    },
  });

  expect(images).toEqual([
    {
      name: "registry.example.com:5000/saashup/tiles",
      version: "v2.7.10",
      display: "registry.example.com:5000/saashup/tiles:v2.7.10",
    },
    {
      name: "saashup/guide",
      version: "v1.3.0",
    },
    {
      name: "saashup/guide",
      version: "v1.5.0",
    },
  ]);
});

test("create filters candidate hosts to hosts that have the requested image", async () => {
  const hosts = await evaluateJsonata("create_filter_hosts_with_image", "host_candidates", {
    host_candidates: [
      { id: 12, name: "overpass1" },
      { id: 13, name: "overpass2" },
      { id: 14, name: "overpass3" },
    ],
    payload: {
      results: [
        { id: 201, name: "saashup/tiles", version: "v2.0.0", host: { id: 13 } },
        { id: 202, name: "saashup/tiles", version: "v2.0.0", host: { value: 14 } },
      ],
    },
  });

  expect(hosts.map((host) => host.name)).toEqual(["overpass2", "overpass3"]);
});

test("delete init keeps the configured tag for instance lookup", async () => {
  const tag = await evaluateJsonata("3241395b128eac06", "tag", {
    req: { query: {} },
    config: {
      tag: "TILE",
    },
  });

  expect(tag).toBe("TILE");
});

test("delete container lookup is scoped to hosts with the selected tag", async () => {
  const queryString = await evaluateJsonata("delete_tagged_host_ids", "host_ids_qs", {
    tag: "TILE",
    tag_slug: "tile",
    payload: {
      results: [
        { id: 1, name: "guide", tags: [{ name: "GUIDE", slug: "guide" }] },
        { id: 2, name: "overpass1", tags: [{ name: "TILE", slug: "tile" }] },
        { id: 3, name: "overpass2", tags: [{ display: "TILE" }] },
      ],
    },
  });

  const url = await evaluateJsonata("90e279516261e3c3", "url", {
    netbox: "https://netbox.example.com",
    instanceShort: "tiles",
    host_ids_qs: queryString,
  });

  expect(queryString).toBe("&host_id=2&host_id=3");
  expect(url).toBe("https://netbox.example.com/api/plugins/docker/containers/?name=tiles&host_id=2&host_id=3");
});

test("delete filters broad container results to the exact instance and tagged host", async () => {
  const payload = await evaluateJsonata("delete_filter_container_results", "payload", {
    instanceShort: "tiles",
    host_ids: ["2"],
    payload: {
      results: [
        { id: 10, name: "tiles", host: { id: 1 } },
        { id: 11, name: "tiles", host: { id: 2 } },
        { id: 12, name: "tiles-worker", host: { id: 2 } },
      ],
    },
  });

  expect(payload).toEqual({
    count: 1,
    results: [
      { id: 11, name: "tiles", host: { id: 2 } },
    ],
  });
});

test("delete flow routes tagged deletes through the tagged host lookup", () => {
  expect(flowNode("3241395b128eac06").wires[0]).toContain("delete_tag_switch");
  expect(flowNode("delete_tag_switch").wires[0]).toContain("delete_tagged_hosts_url");
  expect(flowNode("delete_tag_switch").wires[1]).toContain("90e279516261e3c3");
  expect(flowNode("delete_tagged_hosts_found").wires[0]).toContain("90e279516261e3c3");
  expect(flowNode("apply_proxy_b08a1029cbcb8fc8").wires[0]).toContain("delete_filter_container_results");
  expect(flowNode("3c246a6ce6ebab03").wires[1]).toContain("delete_log_container_not_unique");
  expect(flowNode("apply_proxy_68d767e300ed1980").wires[0]).toContain("delete_log_container_deleted");
});

test("delete flow deletes the cloudflare dns record and logs the outcome", async () => {
  expect(flowNode("3241395b128eac06").wires[0]).toContain("51d47d8a40445af3");
  expect(ruleValue("51d47d8a40445af3", "method")).toBe("GET");
  expect(ruleValue("5fceda08ca763358", "method")).toBe("DELETE");
  expect(flowNode("9135b25f8c332ccd").wires[0]).toContain("5fceda08ca763358");
  expect(flowNode("9135b25f8c332ccd").wires[1]).toContain("delete_log_dns_record_missing");
  expect(flowNode("apply_proxy_16745e1a3e42d7d6").wires[0]).toContain("delete_log_dns_record_deleted");

  const lookupUrl = await evaluateJsonata("51d47d8a40445af3", "url", {
    netbox: "https://netbox.example.com",
    instance: "tiles.example.com",
  });
  const deleteUrl = await evaluateJsonata("5fceda08ca763358", "url", {
    netbox: "https://netbox.example.com",
    payload: {
      results: [
        { id: 42 },
      ],
    },
  });

  expect(lookupUrl).toBe("https://netbox.example.com/api/plugins/cloudflare/dns/records/?name=tiles.example.com");
  expect(deleteUrl).toBe("https://netbox.example.com/api/plugins/cloudflare/dns/records/42/");
});
