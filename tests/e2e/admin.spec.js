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

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#clearLogsBtn").click();
  await expect(page.locator("#notif")).toContainText("Logs cleared");
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

test("create host candidate query includes all selected host ids", async () => {
  const queryString = await evaluateJsonata("create_prepare_host_candidates", "host_ids_qs", {
    host_candidates: [
      { id: 12, name: "overpass1" },
      { id: 13, name: "overpass2" },
    ],
  });

  expect(queryString).toBe("&host_id=12&host_id=13");
});
