const { test, expect, fs, openAdmin, appVersion } = require("./fixtures");

test("create form supports repeatable env, labels, ports, volumes, and binds", async ({ page }) => {
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

  await page.getByRole("link", { name: "Template" }).click();

  await expect(page.locator("[data-field='hostname']")).toHaveCount(0);
  await expect(page.locator("#refreshInstancesBtn")).toBeHidden();
  await expect(page.locator("#instance")).toHaveValue(/^production-[a-z0-9]{16}$/);
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  await expect(page.locator("#network")).toHaveAttribute("readonly", "");
  await expect(page.locator("[data-field='env_vars']")).toBeVisible();
  await expect(page.locator("[data-field='labels']")).toBeVisible();
  await expect(page.locator("[data-field='ports']")).toBeVisible();
  await expect(page.locator("[data-field='volumes']")).toBeVisible();
  await expect(page.locator("[data-field='binds']")).toBeVisible();
  await expect(page.locator("#port_value")).toHaveAttribute("required", "");
  await expect(page.locator("#envList .env-remove")).toBeEnabled();
  await expect(page.locator("#labelList .repeat-remove")).toBeEnabled();
  await expect(page.locator("#volume_name")).toHaveAttribute("readonly", "");
  await expect(page.locator("#volumeList .repeat-remove")).toBeEnabled();
  await expect(page.locator("#bindList .repeat-remove")).toBeEnabled();

  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 2 images");
  await page.locator("#image").fill("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.10.0");
  const generatedInstance = await page.locator("#instance").inputValue();

  await page.locator("#addEnvBtn").click();
  await page.locator("#addLabelBtn").click();
  await page.locator("#addVolumeBtn").click();
  await page.locator("#addBindBtn").click();

  await expect(page.locator("#envList .env-row")).toHaveCount(2);
  await expect(page.locator("#labelList .repeat-row")).toHaveCount(2);
  await expect(page.locator("#portList .repeat-row")).toHaveCount(1);
  await expect(page.locator("#volumeList .repeat-row")).toHaveCount(2);
  await expect(page.locator("#bindList .repeat-row")).toHaveCount(2);
  await page.locator('#volumeList [name="volume_source"]').first().fill("/app/data");
  await page.locator('#volumeList [name="volume_source"]').nth(1).fill("/app/cache");
  await page.locator('#bindList [name="bind_host_path"]').first().fill("/var/run/docker.sock");
  await page.locator('#bindList [name="bind_container_path"]').first().fill("/var/run/docker.sock");
  await page.locator('#bindList [name="bind_read_only"]').first().check();
  await page.locator('#bindList [name="bind_host_path"]').nth(1).fill("/etc/localtime");
  await page.locator('#bindList [name="bind_container_path"]').nth(1).fill("/etc/localtime");
  await expect(page.locator('#volumeList [name="volume_name"]').first()).toHaveValue("instance-data");
  await expect(page.locator('#volumeList [name="volume_name"]').nth(1)).toHaveValue("instance-data-2");

  await page.locator("#envList .env-remove").last().click();
  await page.locator("#labelList .repeat-remove").last().click();
  await page.locator("#volumeList .repeat-remove").last().click();
  await page.locator("#bindList .repeat-remove").last().click();

  await expect(page.locator("#envList .env-row")).toHaveCount(1);
  await expect(page.locator("#labelList .repeat-row")).toHaveCount(1);
  await expect(page.locator("#volumeList .repeat-row")).toHaveCount(1);
  await expect(page.locator("#bindList .repeat-row")).toHaveCount(1);
  await page.locator("#envList .env-remove").click();
  await expect(page.locator("#envList .env-row")).toHaveCount(0);
  await page.locator("#labelList .repeat-remove").click();
  await expect(page.locator("#labelList .repeat-row")).toHaveCount(0);
  await page.locator("#volumeList .repeat-remove").click();
  await expect(page.locator("#volumeList .repeat-row")).toHaveCount(0);
  await page.locator("#bindList .repeat-remove").click();
  await expect(page.locator("#bindList .repeat-row")).toHaveCount(0);
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

  await page.getByRole("link", { name: "Template" }).click();

  const firstName = await page.locator("#instance").inputValue();
  expect(firstName).toMatch(/^production-[a-z0-9]{16}$/);

  await page.locator("#clearBtn").click();

  await expect(page.locator("#instance")).toHaveValue(/^production-[a-z0-9]{16}$/);
  await expect.poll(() => page.locator("#instance").inputValue()).not.toBe(firstName);
});

test("create form preloads a profile-based random instance name on page load", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("current_action", "create");
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
        domain: "apps.example.com",
        tag: "production",
      },
    }),
  });

  await expect(page.locator("#form-title")).toHaveText("Create instance");
  await expect(page.locator("#instance")).toHaveValue(/^production-[a-z0-9]{16}$/);
  await expect(page.locator("#instance")).not.toHaveValue(/^app-[a-z0-9]{16}$/);
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

  await page.getByRole("link", { name: "Template" }).click();
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

  await page.getByRole("link", { name: "Template" }).click();
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

  await page.getByRole("link", { name: "Template" }).click();
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

  await page.getByRole("link", { name: "Template" }).click();
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
      ports: [{ value: "8080" }],
      volumes: [],
    },
  });

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#config_profile")).toHaveValue("guide");

  await page.locator("#create_template_select").selectOption("Tile");

  await expect(page.locator("#config_profile")).toHaveValue("tile");
  await expect(page.locator("#domain")).toHaveValue("tile.example.com");
  await expect(page.locator("#tag")).toHaveValue("TILE");
  await expect(page.locator("#instance")).toHaveValue(/^tile-[a-z0-9]{16}$/);
  await expect(page.locator("#instance")).not.toHaveValue("tile-app");
  await expect(page.locator("#image")).toHaveValue("saashup/tile");
  await expect(page.locator("#version")).toHaveValue("v2.0.0");
  await expect(page.locator("#port_value")).toHaveValue("8080");
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

  await page.getByRole("link", { name: "Template" }).click();
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

  await page.getByRole("link", { name: "Template" }).click();

  await expect(page.locator("#network")).toHaveValue("traefik-tile");
  expect(instanceTags).toContain("TILE");
});

test("create form requires an fqdn DNS name when Traefik is enabled", async ({ page }) => {
  let createSubmitted = false;
  let createBody = "";

  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/guide", version: "v1.0.0" },
      ]),
    });
  });

  await page.route("**/create", async (route) => {
    createSubmitted = true;
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
        tag: "TILE",
      },
    }),
  }, {
    "Guide App": {
      config_profile: "production",
      network: "traefik-net",
      traefik: true,
      log_driver: "syslog",
      log_driver_options: { "syslog-address": "udp://127.0.0.1:5514", tag: "{{.Name}}" },
      image: "saashup/guide",
      version: "v1.0.0",
      ports: [{ value: "3000" }],
    },
  });

  await page.getByRole("link", { name: "Create" }).click();
  await page.locator("#create_template_select").selectOption("Guide App");
  await page.locator("#instance").fill("guide-app");
  await page.locator("#submitBtn").click();

  await expect(page.locator("#notif")).toContainText("DNS name must be a fully qualified domain name");
  expect(createSubmitted).toBe(false);

  await page.locator("#dns_name").fill("guide-app.example.com");
  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).toContain("instance=guide-app");
  expect(createBody).toContain("dns_name=guide-app.example.com");
  expect(createBody).toContain("traefik=true");
  expect(createBody).toContain("log_driver=syslog");
  expect(createBody).toContain("log_driver_options=%7B%22syslog-address%22%3A%22udp%3A%2F%2F127.0.0.1%3A5514%22%2C%22tag%22%3A%22%7B%7B.Name%7D%7D%22%7D");
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
        owner_env_var: "OWNER",
        cloudflare_filter: false,
      },
    }),
  }, {
    Tiles: {
      config_profile: "production",
      network: "traefik-public",
      traefik: true,
      image: "saashup/tiles",
      version: "v1.0.0",
      ports: [{ value: "3000" }],
    },
  });

  await page.getByRole("link", { name: "Create" }).click();
  await page.locator("#create_template_select").selectOption("Tiles");
  await expect(page.locator("#traefik")).toBeChecked();
  await page.locator("#instance").fill("tiles");
  await page.locator("#dns_name").fill("tiles.daily.paashup.cloud/dashboard");
  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).toContain("instance=tiles");
  expect(createBody).toContain("dns_name=tiles.daily.paashup.cloud%2Fdashboard");
  expect(createBody).toContain("domain=daily.paashup.cloud");
  expect(createBody).toContain("owner_env_var=OWNER");
  expect(createBody).toContain("cloudflare_filter=false");
  expect(createBody).toContain("traefik=true");
  expect(createBody).toContain("port_value=3000");
  await expect(page.locator("#instance")).toHaveValue("tiles");
  await expect(page.locator("#dns_name")).toHaveValue("tiles.daily.paashup.cloud/dashboard");
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

  await page.getByRole("link", { name: "Template" }).click();
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 1 images");
  const requestsBeforeImport = instanceRequestCount;
  await expect(page.locator("#dockerRunBtn")).toBeVisible();
  await expect(page.locator("#dockerRunBtn")).toHaveText("Import");
  await page.locator("#dockerRunBtn").click();
  await expect(page.locator("#dockerRunModal")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Run" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveAttribute("aria-selected", "false");
  await page.getByRole("tab", { name: "Compose" }).click();
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Run" }).click();
  await expect(page.locator("#dockerRunApplyBtn")).toBeEnabled();

  await page.locator("#dockerRunInput").fill([
    "docker run -d --name guide-app --network mgmt",
    "--log-driver=syslog --log-opt syslog-address=udp://127.0.0.1:5514 --log-opt tag=\"{{.Name}}\"",
    "-e APP_ENV=production -e saashup_template_url=https://templates.example.com/guide --label traefik.enable=true -p 8080:3000",
    "-v guide-data:/app/data -v /var/run/docker.sock:/var/run/docker.sock:ro saashup/guide:v1.2.3",
  ].join(" "));
  await page.locator("#dockerRunApplyBtn").click();

  await expect(page.locator("#dockerRunModal")).toBeHidden();
  await expect(page.locator("#instance")).toHaveValue("guide-app");
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  expect(instanceRequestCount).toBe(requestsBeforeImport);
  await expect(page.locator("#image")).toHaveValue("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.2.3");
  await expect(page.locator("#log_driver")).toHaveValue("syslog");
  await expect(page.locator("#log_syslog_address")).toHaveValue("udp://127.0.0.1:5514");
  await expect(page.locator("#log_syslog_tag")).toHaveValue("{{.Name}}");
  await expect(page.locator("#loggingList .logging-row")).toBeVisible();
  await page.locator("#removeLoggingBtn").click();
  await expect(page.locator("#loggingList .logging-row")).toBeHidden();
  await page.locator("#addLoggingBtn").click();
  await expect(page.locator("#loggingList .logging-row")).toBeVisible();
  await expect(page.locator("#log_driver")).toHaveValue("syslog");
  await expect(page.locator("#template_url")).toHaveValue("https://templates.example.com/guide");
  await expect(page.locator("#var_env_key")).toHaveValue("APP_ENV");
  await expect(page.locator("#var_env_value")).toHaveValue("production");
  await expect(page.locator("#label_key")).toHaveValue("traefik.enable");
  await expect(page.locator("#label_value")).toHaveValue("true");
  await expect(page.locator("#port_value")).toHaveValue("3000");
  await expect(page.locator("#volume_source")).toHaveValue("/app/data");
  await expect(page.locator("#volume_name")).toHaveValue("instance-data");
  await expect(page.locator("#bind_host_path")).toHaveValue("/var/run/docker.sock");
  await expect(page.locator("#bind_container_path")).toHaveValue("/var/run/docker.sock");
  await expect(page.locator("#bind_read_only")).toBeChecked();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Template name");
    await dialog.accept("guide");
  });
  await page.locator("#saveTemplateBtn").click();
  await expect(page.locator("#notif")).toContainText('Template "guide" saved');
  const templates = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")));
  expect(templates.guide).toMatchObject({
    log_driver: "syslog",
    log_driver_options: { "syslog-address": "udp://127.0.0.1:5514", tag: "{{.Name}}" },
  });
});

test("create import can save docker compose services as templates", async ({ page }) => {
  const createBodies = [];
  const recreateBodies = [];
  const deleteBodies = [];

  await page.route("**/images?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { name: "saashup/guide", version: "v2.0.0" },
      ]),
    });
  });
  await page.route("**/create", async (route) => {
    createBodies.push(route.request().postData() || "");
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/delete", async (route) => {
    deleteBodies.push(route.request().postData() || "");
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.route("**/recreate", async (route) => {
    recreateBodies.push(route.request().postData() || "");
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });

  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
      },
      staging: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "staging",
      },
    }),
  });

  await page.getByRole("link", { name: "Template" }).click();
  await page.locator("#dockerRunBtn").click();
  await expect(page.locator("#importProfileSelect")).toHaveValue("production");
  await page.locator("#importProfileSelect").selectOption("staging");
  await expect(page.getByRole("tab", { name: "Run" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Compose" }).click();
  await page.locator("#dockerComposeInput").fill([
    "name: stack",
    "services:",
    "  web:",
    "    container_name: web-container",
    "    image: registry.example.com:5000/saashup/web:v1.2.3",
    "    networks:",
    "      - proxy",
    "    ports:",
    "      - \"8080:3000\"",
    "    environment:",
    "      APP_ENV: production",
    "      FEATURE_FLAG: \"true\"",
    "    labels:",
    "      traefik.enable: \"true\"",
    "      saashup_traefik: \"true\"",
    "      saashup_dns: \"web.staging.example.com/dashboard\"",
    "      saashup_enabled: false;",
    "      saashup_template_url: https://templates.example.com/web",
    "    volumes:",
    "      - web-data:/app/data",
    "      - /var/run/docker.sock:/var/run/docker.sock:ro",
    "    logging:",
    "      driver: syslog",
    "      options:",
    "        syslog-address: udp://127.0.0.1:5514",
    "        tag: \"{{.Name}}\"",
    "  worker:",
    "    container_name: worker",
    "    image: saashup/worker:latest",
    "    environment:",
    "      - QUEUE=default",
    "    labels:",
    "      - saashup_traefik=false",
    "      - saashup_dns=worker.staging.example.com",
  ].join("\n"));
  await expect(page.locator("#createWorkflowInput")).toBeChecked();
  await expect(page.locator("#importTemplateOrdersInput")).toBeChecked();
  await page.locator("#importTemplateOrdersInput").uncheck();
  await page.locator("#dockerRunApplyBtn").click();

  await expect(page.locator("#dockerRunModal")).toBeHidden();
  await expect(page.locator("#notif")).toContainText("2 compose templates imported");
  await expect(page.locator("#templateSelect option")).toContainText(["Select template", "web", "worker"]);
  await expect(page.locator("#formTitleBadge")).toHaveText("2");
  await expect(page.locator("#formTitleBadge")).toHaveAttribute("aria-label", "2 templates");
  await expect(page.locator("[data-field='saashup_enabled']")).toHaveCount(0);

  const templates = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")));
  const workflows = await page.evaluate(() => JSON.parse(localStorage.getItem("create_workflows")));
  expect(workflows["staging::stack"]).toMatchObject({
    name: "stack",
    config_profile: "staging",
  });
  expect(workflows["staging::stack"].steps.map((step) => step.template)).toEqual(["web", "worker"]);
  expect(templates.web).toMatchObject({
    config_profile: "staging",
    instance: "web-container",
    dns_name: "web.staging.example.com/dashboard",
    traefik: true,
    network: "proxy",
    image: "registry.example.com:5000/saashup/web",
    version: "v1.2.3",
    env: [
      { key: "APP_ENV", value: "production" },
      { key: "FEATURE_FLAG", value: "true" },
    ],
    labels: [{ key: "traefik.enable", value: "true" }],
    saashup_enabled: false,
    template_url: "https://templates.example.com/web",
    ports: [{ value: "3000" }],
    volumes: [{ name: "web-data", source: "/app/data" }],
    binds: [{ host_path: "/var/run/docker.sock", container_path: "/var/run/docker.sock", read_only: true }],
    log_driver: "syslog",
    log_driver_options: { "syslog-address": "udp://127.0.0.1:5514", tag: "{{.Name}}" },
  });
  expect(templates.worker).toMatchObject({
    dns_name: "worker.staging.example.com",
    traefik: false,
    image: "saashup/worker",
    version: "latest",
    env: [{ key: "QUEUE", value: "default" }],
    labels: [],
  });

  await page.locator("#templateSelect").selectOption("web");
  await expect(page.locator("#version")).toHaveValue("v1.2.3");
  await page.locator("#version").fill("v2.0.0");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Template name");
    expect(dialog.defaultValue()).toBe("web");
    await dialog.accept("web");
  });
  await page.locator("#saveTemplateBtn").click();
  await expect(page.locator("#notif")).toContainText('Template "web" saved');

  await page.getByRole("link", { name: "Workflow" }).click();
  await expect(page.locator("#workflowTitleBadge")).toHaveText("1");
  await expect(page.locator("#workflowTitleBadge")).toHaveAttribute("aria-label", "1 workflow");
  await expect(page.locator("#workflowSelect")).toHaveValue("staging::stack");
  await expect(page.locator("#workflowSelect option:checked")).toHaveText("staging / stack");
  await expect(page.locator("#workflowSummary")).toContainText("staging");
  await expect(page.locator("#workflowTableBody")).toContainText("web");
  await expect(page.locator("#workflowTableBody")).toContainText("v2.0.0");
  await expect(page.locator("#workflowTableBody")).toContainText("worker");
  await expect(page.locator(".workflow-step-status-pending")).toHaveCount(2);
  await expect(page.locator("#runWorkflowBtn")).toHaveText("Execute");
  await expect(page.locator("#saveWorkflowBtn")).toBeDisabled();
  await expect(page.locator("#workflowTableBody tr")).toHaveCount(2);
  const dragWorkflowStep = async (sourceIndex, targetIndex) => {
    await page.locator(`[data-workflow-step-drag="${sourceIndex}"]`).scrollIntoViewIfNeeded();
    const handle = await page.locator(`[data-workflow-step-drag="${sourceIndex}"]`).boundingBox();
    const target = await page.locator("#workflowTableBody tr").nth(targetIndex).boundingBox();
    const viewport = page.viewportSize();
    expect(handle).toBeTruthy();
    expect(target).toBeTruthy();
    const targetY = Math.max(20, Math.min((viewport?.height || 720) - 20, target.y + target.height - 24));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, targetY, { steps: 8 });
    await page.mouse.up();
  };
  await dragWorkflowStep(1, 0);
  await expect(page.locator("#notif")).toContainText("Workflow order changed");
  await expect(page.locator("#saveWorkflowBtn")).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem("create_workflows"))["staging::stack"].steps.map((step) => step.template)
  ))).toEqual(["worker", "web"]);
  await dragWorkflowStep(0, 1);
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem("create_workflows"))["staging::stack"].steps.map((step) => step.template)
  ))).toEqual(["web", "worker"]);
  const workflowSavePayloads = [];
  await page.route("**/templates?**", async (route) => {
    if (route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() || "{}");
      workflowSavePayloads.push(payload);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
      return;
    }
    await route.fallback();
  });
  await page.locator("[data-workflow-step-enabled='1']").uncheck();
  await expect(page.locator("#saveWorkflowBtn")).toBeEnabled();
  await page.locator("#saveWorkflowBtn").scrollIntoViewIfNeeded();
  await page.locator("#saveWorkflowBtn").click();
  await expect(page.locator("#notif")).toContainText("Workflow saved");
  await expect(page.locator("#saveWorkflowBtn")).toBeDisabled();
  await expect.poll(() => workflowSavePayloads.length).toBe(1);
  expect(workflowSavePayloads[0].workflows["staging::stack"].steps.map((step) => ({
    template: step.template,
    enabled: step.enabled,
  }))).toEqual([
    { template: "web", enabled: true },
    { template: "worker", enabled: false },
  ]);
  await page.locator("[data-workflow-step-enabled='1']").check();
  await page.locator("#runWorkflowBtn").click();
  await expect.poll(() => createBodies.length).toBe(2);
  expect(createBodies[0]).toContain("instance=web-container");
  expect(createBodies[0]).toContain("image=registry.example.com%3A5000%2Fsaashup%2Fweb");
  expect(createBodies[0]).toContain("version=v2.0.0");
  expect(createBodies[0]).toContain("dns_name=web.staging.example.com%2Fdashboard");
  expect(createBodies[0]).toContain("traefik=true");
  expect(createBodies[0]).toContain("log_driver=syslog");
  expect(createBodies[0]).toContain("log_driver_options=%7B%22syslog-address%22%3A%22udp%3A%2F%2F127.0.0.1%3A5514%22%2C%22tag%22%3A%22%7B%7B.Name%7D%7D%22%7D");
  expect(createBodies[0]).toContain("wait=true");
  expect(createBodies[0]).toContain("bind_host_path=%2Fvar%2Frun%2Fdocker.sock");
  expect(createBodies[0]).toContain("bind_container_path=%2Fvar%2Frun%2Fdocker.sock");
  expect(createBodies[0]).toContain("bind_read_only=true");
  expect(createBodies[1]).toContain("instance=worker");
  expect(createBodies[1]).toContain("image=saashup%2Fworker");
  expect(createBodies[1]).toContain("traefik=false");
  expect(createBodies[1]).toContain("dns_name=");
  expect(createBodies[1]).toContain("wait=true");
  await expect(page.locator(".workflow-step-status-done")).toHaveCount(2);
  await expect(page.locator("#notif")).toContainText('Workflow "staging / stack" requested');

  await page.locator("#workflowActionSelect").selectOption("upgrade");
  await expect(page.locator("#runWorkflowBtn")).toHaveText("Execute");
  await expect(page.locator("#workflowDeleteVolumesField")).toBeHidden();
  await page.locator("#runWorkflowBtn").click();
  await expect.poll(() => recreateBodies.length).toBe(2);
  expect(recreateBodies[0]).toContain("image=registry.example.com%3A5000%2Fsaashup%2Fweb");
  expect(recreateBodies[0]).toContain("version=v2.0.0");
  expect(recreateBodies[0]).toContain("oldversion=");
  expect(recreateBodies[0]).toContain("clean_name=false");
  expect(recreateBodies[0]).toContain("remove_old_images=false");
  expect(recreateBodies[0]).toContain("wait=true");
  expect(recreateBodies[1]).toContain("image=saashup%2Fworker");
  expect(recreateBodies[1]).toContain("version=latest");
  expect(recreateBodies[1]).toContain("wait=true");
  await expect(page.locator(".workflow-step-status-done")).toHaveCount(2);
  await expect(page.locator("#notif")).toContainText('Workflow "staging / stack" upgrade requested');

  await expect(page.locator("#workflowDeleteVolumesField")).toBeHidden();
  await page.locator("#workflowActionSelect").selectOption("delete");
  await expect(page.locator("#runWorkflowBtn")).toHaveText("Execute");
  await expect(page.locator("#workflowDeleteVolumesField")).toBeVisible();
  await page.locator("#workflowDeleteVolumesInput").check();
  await page.locator("#runWorkflowBtn").click();
  await expect(page.locator(".workflow-step-status-running")).toHaveCount(1);
  await expect.poll(() => deleteBodies.length).toBe(2);
  expect(deleteBodies[0]).toContain("delete_mode=image");
  expect(deleteBodies[0]).toContain("image=saashup%2Fworker");
  expect(deleteBodies[0]).toContain("delete_volumes=true");
  expect(deleteBodies[0]).toContain("wait=true");
  expect(deleteBodies[1]).toContain("delete_mode=image");
  expect(deleteBodies[1]).toContain("image=registry.example.com%3A5000%2Fsaashup%2Fweb");
  expect(deleteBodies[1]).toContain("delete_volumes=true");
  expect(deleteBodies[1]).toContain("wait=true");
  await expect(page.locator(".workflow-step-status-done")).toHaveCount(2);
  await expect(page.locator("#notif")).toContainText('Workflow "staging / stack" delete requested');

  deleteBodies.length = 0;
  await page.locator('[data-workflow-step-enabled="1"]').uncheck();
  await expect(page.locator("#workflowSummary")).toContainText("1/2 enabled");
  await page.locator("#runWorkflowBtn").click();
  await expect.poll(() => deleteBodies.length).toBe(1);
  expect(deleteBodies[0]).toContain("image=registry.example.com%3A5000%2Fsaashup%2Fweb");
  expect(deleteBodies[0]).not.toContain("image=saashup%2Fworker");

  await page.locator('[data-workflow-step-delete="1"]').click();
  await expect(page.locator("#workflowTableBody")).not.toContainText("worker");
  const workflowAfterTaskDelete = await page.evaluate(() => JSON.parse(localStorage.getItem("create_workflows"))["staging::stack"]);
  expect(workflowAfterTaskDelete.steps.map((step) => step.template)).toEqual(["web"]);

  await page.getByRole("link", { name: "Template" }).click();
  await page.locator("#dockerRunBtn").click();
  await page.locator("#importProfileSelect").selectOption("production");
  await page.locator("#dockerRunInput").fill([
    "name: stack",
    "services:",
    "  api:",
    "    image: saashup/api:v9.9.9",
  ].join("\n"));
  await page.locator("#dockerRunApplyBtn").click();

  const workflowsByProfile = await page.evaluate(() => JSON.parse(localStorage.getItem("create_workflows")));
  expect(Object.keys(workflowsByProfile).sort()).toEqual(["production::stack", "staging::stack"]);
  await page.getByRole("link", { name: "Workflow" }).click();
  await expect(page.locator("#workflowSelect option")).toContainText(["production / stack", "staging / stack"]);

  await page.getByRole("link", { name: "Template" }).click();
  await page.locator("#dockerRunBtn").click();
  await page.getByRole("tab", { name: "Compose" }).click();
  await page.locator("#dockerComposeInput").fill([
    "services:",
    "  db:",
    "    image: ${POSTGRES_IMAGE:-postgres:18}",
  ].join("\n"));
  await page.locator("#dockerRunApplyBtn").click();

  const templatesWithDefaultImage = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")));
  expect(templatesWithDefaultImage.db).toMatchObject({
    image: "postgres",
    version: "18",
  });

  await page.locator("#templateSelect").selectOption("db");
  await expect(page.locator("#image")).toHaveValue("postgres");
  await expect(page.locator("#version")).toHaveValue("18");
  await page.locator("#templateSelect").selectOption("web");
  await expect(page.locator("#config_profile")).toHaveValue("staging");
  await expect(page.locator("#network")).toHaveValue("proxy");
  await expect(page.locator("[data-field='dns_name']")).toBeHidden();
  await page.waitForTimeout(50);
  await expect(page.locator("#network")).toHaveValue("proxy");
  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 1 images");
  await page.locator("#image").fill("saashup/guide");
  await page.locator("#image").dispatchEvent("input");
  await expect(page.locator("#version")).toHaveValue("v2.0.0");
});

test("workflow delete uses image mode without an explicit instance name", async ({ page }) => {
  const deleteBodies = [];

  await page.route("**/delete", async (route) => {
    deleteBodies.push(route.request().postData() || "");
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem("create_templates", JSON.stringify({
      daily: {
        config_profile: "staging",
        traefik: false,
        image: "saashup/daily",
        version: "latest",
      },
    }));
    localStorage.setItem("create_workflows", JSON.stringify({
      "staging::stack": {
        name: "stack",
        config_profile: "staging",
        steps: [{ template: "daily", enabled: true }],
      },
    }));
  });

  await openAdmin(page, {
    profile: "staging",
    profiles: JSON.stringify({
      staging: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "staging",
      },
    }),
  }, {
    daily: {
      config_profile: "staging",
      traefik: false,
      image: "saashup/daily",
      version: "latest",
    },
  });

  await page.getByRole("link", { name: "Workflow" }).click();
  await page.locator("#workflowSelect").selectOption("staging::stack");
  await page.locator("#workflowActionSelect").selectOption("delete");
  await page.locator("#runWorkflowBtn").click();

  await expect.poll(() => deleteBodies.length).toBe(1);
  expect(deleteBodies[0]).toContain("delete_mode=image");
  expect(deleteBodies[0]).toContain("image=saashup%2Fdaily");
  await expect(page.locator("#notif")).toContainText('Workflow "staging / stack" delete requested');
});

test("compose import reads SaaShup labels from map labels", async ({ page }) => {
  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
      },
    }),
  });

  await page.getByRole("link", { name: "Template" }).click();
  await page.locator("#dockerRunBtn").click();
  await page.locator("#dockerRunInput").fill([
    "name: paashup",
    "services:",
    "  traefik:",
    "    image: saashup/traefik:v3.7.1",
    "    container_name: traefik",
    "    labels:",
    "      saashup_traefik: false",
    "  saashup:",
    "    image: saashup/netbox-docker-image-upgrade:v2.4.2",
    "    container_name: saashup",
    "    labels:",
    "      saashup_traefik: true",
    "      saashup_dns: https://daily.paashup.cloud",
    "      prometheus_address: saashup:1880",
    "  netbox:",
    "    image: saashup/netbox-docker:v4.6.1.2",
    "    container_name: netbox",
    "    labels:",
    "      saashup_traefik: true",
    "      saashup_dns: https://daily.paashup.cloud/cmdb",
  ].join("\n"));
  await page.locator("#dockerRunApplyBtn").click();

  const templates = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")));
  expect(templates.traefik).toMatchObject({ traefik: false });
  expect(templates.traefik.labels).toEqual([]);
  expect(templates.saashup).toMatchObject({
    traefik: true,
    dns_name: "https://daily.paashup.cloud",
    labels: [{ key: "prometheus_address", value: "saashup:1880" }],
  });
  expect(templates.netbox).toMatchObject({
    traefik: true,
    dns_name: "https://daily.paashup.cloud/cmdb",
  });

  await page.locator("#templateSelect").selectOption("traefik");
  await expect(page.locator("#traefik")).not.toBeChecked();
  await page.locator("#templateSelect").selectOption("netbox");
  await expect(page.locator("#traefik")).toBeChecked();
  await expect(page.locator("[data-field='saashup_enabled']")).toHaveCount(0);
  await expect(page.locator("[data-field='dns_name']")).toBeHidden();
});

test("saved templates are normalized from SaaShup labels", async ({ page }) => {
  await openAdmin(page, {
    profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
      },
    }),
  }, {
    legacy: {
      image: "saashup/traefik",
      version: "v3.7.1",
      traefik: true,
      labels: [
        { key: "saashup_traefik", value: "false" },
        { key: "saashup_dns", value: "https://daily.paashup.cloud" },
        { key: "saashup_enabled", value: "false;" },
        { key: "saashup_template_url", value: "https://templates.example.com/legacy" },
      ],
    },
  });

  await page.getByRole("link", { name: "Template" }).click();
  await page.locator("#templateSelect").selectOption("legacy");
  await expect(page.locator("#traefik")).not.toBeChecked();
  await expect(page.locator("[data-field='saashup_enabled']")).toHaveCount(0);
  await expect(page.locator("#orderTemplateBtn")).toBeDisabled();
  await expect(page.locator("[data-field='dns_name']")).toBeHidden();
  await expect(page.locator("#template_url")).toHaveValue("https://templates.example.com/legacy");

  const templates = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")));
  expect(templates.legacy).toMatchObject({
    traefik: false,
    dns_name: "https://daily.paashup.cloud",
    saashup_enabled: false,
    template_url: "https://templates.example.com/legacy",
    labels: [],
  });
});

test("template import can upload a template export", async ({ page }) => {
  await openAdmin(page, {}, {});

  await page.getByRole("link", { name: "Template" }).click();
  await page.locator("#dockerRunBtn").click();
  await expect(page.locator("#dockerRunModal")).toBeVisible();
  await page.locator('[data-import-tab="export"]').click();
  await expect(page.locator("#templateExportPanel")).toBeVisible();
  await expect(page.locator("#templateExportFileName")).toHaveText("JSON file from Export all templates");
  await page.locator("#templateExportFile").setInputFiles({
    name: "saashup-templates.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      type: "saashup-template-export",
      version: 1,
      templates: {
        Guide: {
          image: "saashup/guide",
          version: "v1.2.3",
          max_instances: 2,
          saashup_enabled: true,
        },
      },
      workflows: {
        "production::guide-stack": {
          name: "guide-stack",
          config_profile: "production",
          steps: [{ template: "Guide", enabled: true }],
        },
      },
    })),
  });
  await expect(page.locator("#templateExportFileName")).toHaveText("saashup-templates.json");
  await page.locator("#dockerRunApplyBtn").click();

  await expect(page.locator("#dockerRunModal")).toBeHidden();
  await expect(page.locator("#notif")).toContainText("1 template and 1 workflow imported from export");
  await expect(page.locator("#templateSelect")).toHaveValue("Guide");
  const templates = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")));
  const workflows = await page.evaluate(() => JSON.parse(localStorage.getItem("create_workflows")));
  expect(templates.Guide).toMatchObject({
    image: "saashup/guide",
    version: "v1.2.3",
    max_instances: 2,
    saashup_enabled: true,
  });
  expect(workflows["production::guide-stack"]).toMatchObject({
    name: "guide-stack",
    config_profile: "production",
    steps: [{ template: "Guide", enabled: true }],
  });
});

test("template export import creates a workflow when the export only has templates", async ({ page }) => {
  await openAdmin(page, {
    profile: "production",
    config_profile: "production",
    profiles: JSON.stringify({
      production: { netbox: "https://netbox.example.com", token: "secret", tag: "prod" },
    }),
  }, {});

  await page.getByRole("link", { name: "Template" }).click();
  await page.locator("#dockerRunBtn").click();
  await page.locator('[data-import-tab="export"]').click();
  await page.locator("#templateExportFile").setInputFiles({
    name: "saashup-templates-only.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      type: "saashup-template-export",
      version: 1,
      template_order: ["Worker", "Guide"],
      templates: {
        Guide: {
          image: "saashup/guide",
          version: "v1.2.3",
        },
        Worker: {
          image: "saashup/worker",
          version: "v4.5.6",
        },
      },
    })),
  });
  await page.locator("#dockerRunApplyBtn").click();

  await expect(page.locator("#notif")).toContainText("2 templates and 1 workflow imported from export");
  const workflows = await page.evaluate(() => JSON.parse(localStorage.getItem("create_workflows")));
  expect(workflows["production::templates"]).toMatchObject({
    name: "templates",
    config_profile: "production",
    steps: [
      { template: "Worker", enabled: true, template_data: expect.objectContaining({ image: "saashup/worker" }) },
      { template: "Guide", enabled: true, template_data: expect.objectContaining({ image: "saashup/guide" }) },
    ],
  });
});

test("import profile selector includes server profiles beyond local cache", async ({ page }) => {
  await openAdmin(page, {
    profile: "install",
    config_profile: "install",
    netbox: "https://netbox.example.com",
    token: "secret",
    tag: "install",
    profiles: JSON.stringify({
      PaaShup: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "paashup",
      },
      install: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "install",
      },
    }),
  });

  await page.evaluate(() => {
    localStorage.setItem("config_profiles", JSON.stringify({
      install: {
        netbox: "https://netbox.example.com",
        token: "secret",
        tag: "install",
      },
    }));
  });
  await page.reload();
  await page.getByRole("link", { name: "Template" }).click();
  await page.locator("#dockerRunBtn").click();

  await expect(page.locator("#importProfileSelect option")).toContainText(["install", "PaaShup"]);
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

  await page.getByRole("link", { name: "Template" }).click();
  await expect(page.locator("#saveTemplateBtn")).toBeVisible();
  await expect(page.locator("#saveTemplateBtn")).toHaveText("Save template");
  await expect(page.locator("#saveTemplateBtn")).toHaveClass(/btn-primary/);
  await expect(page.locator("#saveAllTemplatesBtn")).toBeVisible();
  await expect(page.locator("#saveAllTemplatesBtn")).toHaveText("Export all templates");
  await expect(page.locator("#saveAllTemplatesBtn")).toBeDisabled();
  await expect(page.locator("#orderTemplateBtn")).toBeVisible();
  await expect(page.locator("#orderTemplateBtn")).toBeEnabled();
  await expect(page.locator("#orderTemplateBtn")).toHaveText("Select template to order");
  await expect(page.locator("#orderTemplateBtn")).toHaveClass(/btn-danger-outline/);
  await expect(page.locator("#deleteTemplateBtn")).toBeVisible();

  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 1 images");
  await expect(page.locator("[data-field='instance']")).toBeHidden();
  await expect(page.locator("[data-field='dns_name']")).toBeHidden();
  await page.locator("#image").fill("saashup/guide");
  await expect(page.locator("[data-field='version']")).toBeVisible();
  await expect(page.locator("#version")).toHaveValue("v1.10.0");
  await page.locator("#var_env_key").fill("APP_ENV");
  await page.locator("#var_env_value").fill("production");
  await page.locator("#label_key").fill("traefik.enable");
  await page.locator("#label_value").fill("true");
  await page.locator("#max_instances").fill("2");
  await page.locator("#port_value").fill("3000");
  await page.locator("#volume_source").fill("/app/data");
  await expect(page.locator("#volume_name")).toHaveValue("instance-data");
  await expect(page.locator("[data-field='saashup_enabled']")).toHaveCount(0);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Template name");
    expect(dialog.defaultValue()).toBe("");
    await dialog.accept("Guide");
  });
  await page.locator("#saveTemplateBtn").click();
  await expect(page.locator("#notif")).toContainText('Template "Guide" saved');
  const savedTemplate = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")).Guide);
  expect(savedTemplate.instance).toBeUndefined();
  expect(savedTemplate.dns_name).toBeUndefined();
  expect(savedTemplate.saashup_enabled).toBe(true);
  expect(savedTemplate.max_instances).toBe(2);
  expect(savedTemplate.version).toBe("v1.10.0");
  expect(savedTemplate.volumes).toEqual([{ key: "/app/data" }]);
  await expect(page.locator("#saveAllTemplatesBtn")).toBeEnabled();

  await page.evaluate(() => localStorage.removeItem("create_templates"));
  await page.reload();
  await page.getByRole("link", { name: "Template" }).click();

  await page.locator("#clearBtn").click();
  await expect(page.locator("#image")).toHaveValue("");
  const imageRequestsBeforeLoad = imageRequestCount;

  await page.locator("#templateSelect").selectOption("Guide");
  await expect(page.locator("#notif")).toContainText('Template "Guide" loaded');
  await expect(page.locator("#orderTemplateBtn")).toBeEnabled();
  await expect(page.locator("#orderTemplateBtn")).toHaveText("Order template");
  await expect(page.locator("#orderTemplateBtn")).toHaveClass(/btn-primary/);
  expect(imageRequestCount).toBeGreaterThanOrEqual(imageRequestsBeforeLoad);
  await expect(page.locator("#templateCreatorEmailWrap")).toBeVisible();
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  await expect(page.locator("[data-field='instance']")).toBeHidden();
  await expect(page.locator("[data-field='dns_name']")).toBeHidden();
  await expect(page.locator("#image")).toHaveValue("saashup/guide");
  await expect(page.locator("[data-field='version']")).toBeVisible();
  await expect(page.locator("#version")).toHaveValue("v1.10.0");
  await page.locator("#version").fill("v1.2.3");
  await expect(page.locator("[data-field='saashup_enabled']")).toHaveCount(0);
  await expect(page.locator("#max_instances")).toHaveValue("2");
  await expect(page.locator("#var_env_key")).toHaveValue("APP_ENV");
  await expect(page.locator("#label_key")).toHaveValue("traefik.enable");
  await expect(page.locator("#port_value")).toHaveValue("3000");
  await expect(page.locator("#volume_source")).toHaveValue("/app/data");
  await expect(page.locator("#volume_name")).toHaveValue("instance-data");

  await page.locator("#templateCreatorEmail").fill("creator@example.com");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Template name");
    expect(dialog.defaultValue()).toBe("Guide");
    await dialog.accept("Guide");
  });
  await page.locator("#saveTemplateBtn").click();
  await expect(page.locator("#notif")).toContainText('Template "Guide" saved');
  const updatedTemplate = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")).Guide);
  expect(updatedTemplate.creator_email).toBe("creator@example.com");
  expect(updatedTemplate.version).toBe("v1.2.3");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveAllTemplatesBtn").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^saashup-templates-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.locator("#notif")).toContainText("1 template exported");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Template name");
    expect(dialog.defaultValue()).toBe("Guide");
    await dialog.dismiss();
  });
  await page.locator("#saveTemplateBtn").click();

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#deleteTemplateBtn").click();
  await expect(page.locator("#notif")).toContainText('Template "Guide" deleted');
  await expect(page.locator("#templateSelect option")).toHaveText("No templates saved");
});

test("template management is split from create from template", async ({ page }) => {
  let createBody = "";

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
        domain: "example.com",
        tag: "production",
      },
    }),
  }, {
    Guide: {
      config_profile: "production",
      network: "traefik-net",
      traefik: true,
      image: "saashup/guide",
      version: "v1.2.3",
      ports: [{ value: "3000" }],
      env: [{ key: "APP_ENV", value: "production" }],
      volumes: [{ key: "/app/data" }],
    },
  });

  await page.getByRole("link", { name: "Template" }).click();
  await expect(page.locator("#form-title")).toHaveText("Template");
  await expect(page.locator("#saveTemplateBtn")).toBeVisible();
  await expect(page.locator("#submitBtn")).toBeHidden();
  await expect(page.locator("[data-field='image']")).toBeVisible();
  await expect(page.locator("[data-field='all_hosts']")).toBeHidden();
  await expect(page.locator("[data-field='version']")).toBeVisible();
  await expect(page.locator("[data-field='instance']")).toBeHidden();
  await expect(page.locator("[data-field='dns_name']")).toBeHidden();

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#form-title")).toHaveText("Create instance");
  await expect(page.locator("#saveTemplateBtn")).toBeHidden();
  await expect(page.locator("#templateSelect")).toBeHidden();
  await expect(page.locator("#loadTemplateBtn")).toBeHidden();
  await expect(page.locator("#submitBtn")).toBeVisible();
  await expect(page.locator("[data-field='config_profile']")).toBeHidden();
  await expect(page.locator("[data-field='create_template']")).toBeVisible();
  await expect(page.locator("[data-field='image']")).toBeVisible();
  await expect(page.locator("#image")).toHaveAttribute("readonly", "");
  await expect(page.locator("[data-field='version']")).toBeVisible();
  await expect(page.locator("[data-field='all_hosts']")).toBeHidden();

  await page.locator("#create_template_select").selectOption("Guide");
  await expect(page.locator("#image")).toHaveValue("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.2.3");
  await page.locator("#version").fill("v1.2.4");
  await page.locator("#instance").fill("guide-copy");
  await page.locator("#dns_name").fill("guide-copy.example.com");
  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).toContain("instance=guide-copy");
  expect(createBody).toContain("dns_name=guide-copy.example.com");
  expect(createBody).not.toContain("all_hosts=true");
  expect(createBody).toContain("image=saashup%2Fguide");
  expect(createBody).toContain("version=v1.2.4");
  expect(createBody).toContain("network=traefik-net");
  expect(createBody).toContain("port_value=3000");
  expect(createBody).toContain("var_env_key=APP_ENV");
  expect(createBody).toContain("volume_name=guide-copy-data");
});

test("create template order button reflects disabled order templates", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
      },
    }),
  }, {
    "Guide App": {
      config_profile: "production",
      network: "traefik-net",
      image: "saashup/guide",
      ports: [{ value: "3000" }],
      saashup_enabled: false,
    },
  });

  await page.getByRole("link", { name: "Template" }).click();
  await expect(page.locator("#templateCreatorEmailWrap")).toBeVisible();
  await expect(page.locator("#templateCreatorEmail")).toBeDisabled();
  await page.locator("#templateSelect").selectOption("Guide App");
  await expect(page.locator("#templateCreatorEmailWrap")).toBeVisible();
  await expect(page.locator("#templateCreatorEmail")).toHaveValue("");
  await expect(page.locator("#templateCreatorEmail")).toBeEnabled();
  await expect(page.locator("[data-field='saashup_enabled']")).toHaveCount(0);
  await expect(page.locator("#orderTemplateBtn")).toBeDisabled();
  await expect(page.locator("#orderTemplateBtn")).toHaveText("Template disabled");
});

test("create template order button opens the selected order page", async ({ page }) => {
  await openAdmin(page, {
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        tag: "production",
      },
    }),
  }, {
    "Guide App": {
      config_profile: "production",
      network: "traefik-net",
      image: "saashup/guide",
      ports: [{ value: "3000" }],
    },
  });

  await page.getByRole("link", { name: "Template" }).click();
  await expect(page.locator("#orderTemplateBtn")).toBeEnabled();
  await expect(page.locator("#orderTemplateBtn")).toHaveText("Select template to order");
  await expect(page.locator("#orderTemplateBtn")).toHaveClass(/btn-danger-outline/);
  await page.locator("#orderTemplateBtn").click();
  await expect(page.locator("#notif")).toHaveText("Select a template first");

  await page.locator("#templateSelect").selectOption("Guide App");
  await expect(page.locator("#orderTemplateBtn")).toBeEnabled();
  await expect(page.locator("#orderTemplateBtn")).toHaveText("Order template");
  await page.locator("#orderTemplateBtn").click();

  await expect(page).toHaveURL(/\/order\?template=Guide%20App$/);
});
