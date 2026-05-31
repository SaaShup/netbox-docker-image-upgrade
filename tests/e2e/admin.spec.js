const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const packageJson = require(path.join(repoRoot, "package.json"));
const appVersion = `v${packageJson.version}`;

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

  await page.route("**/dockerhub-webhook-secret", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ secret: "hook-secret" }),
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
  await expect(page.locator("[data-app-version]")).toHaveText(appVersion);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("#form-title")).toHaveText("Config");
  await expect(page.locator("[data-app-version]")).toHaveText(appVersion);
});

test("config tab starts without a forced default profile", async ({ page }) => {
  await openAdmin(page, {});

  await expect(page.locator("#form-title")).toHaveText("Config");
  await expect(page.locator("#config_profile")).toHaveValue("");
  await expect(page.locator("#config_profile option")).toHaveText("No config saved");
  await expect(page.locator("#profileSyncWarning")).toBeHidden();
  await expect(page.locator("#config_name")).toHaveValue("");
  await expect(page.locator("#netbox")).toHaveValue("");
  await expect(page.locator("#token")).toHaveValue("");
  await expect(page.locator("#token")).toHaveAttribute("type", "password");
  await page.locator("#tokenToggle").click();
  await expect(page.locator("#token")).toHaveAttribute("type", "text");
  await expect(page.locator("#tokenToggle")).toHaveAttribute("aria-label", "Hide NetBox token");
  await page.locator("#tokenToggle").click();
  await expect(page.locator("#token")).toHaveAttribute("type", "password");
  await expect(page.locator("#dockerhub_webhook_secret")).toHaveValue("hook-secret");
  await expect(page.locator("#dockerhub_webhook_secret")).toHaveAttribute("type", "password");
  await expect(page.locator("#dockerhub_webhook_secret")).toHaveAttribute("placeholder", "Empty uses env default");
  await page.locator("#profileDockerhubSecretToggle").click();
  await expect(page.locator("#dockerhub_webhook_secret")).toHaveAttribute("type", "text");
  await expect(page.locator("#profileDockerhubSecretToggle")).toHaveAttribute("aria-label", "Hide Docker Hub webhook password");
  await page.locator("#profileDockerhubSecretToggle").click();
  await expect(page.locator("#dockerhub_webhook_secret")).toHaveAttribute("type", "password");
  await expect(page.locator("#smtp_config")).toHaveAttribute("type", "password");
  await page.locator("#smtpConfigToggle").click();
  await expect(page.locator("#smtp_config")).toHaveAttribute("type", "text");
  await expect(page.locator("#smtpConfigToggle")).toHaveAttribute("aria-label", "Hide SMTP config");
  await page.locator("#smtpConfigToggle").click();
  await expect(page.locator("#smtp_config")).toHaveAttribute("type", "password");
  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator('[data-field="dockerhub_webhook_secret"]')).toBeHidden();
  await page.getByRole("link", { name: "Config" }).click();
  await expect(page.locator('[data-field="dockerhub_webhook_secret"]')).toBeVisible();
  await expect(page.locator("#domain")).toHaveValue("");
  await expect(page.locator("#tag")).toHaveValue("");
  await expect(page.locator("#max_instances")).toHaveValue("1");
  await expect(page.locator("#owner_env_var")).toHaveValue("SAASHUP_OWNER");
  await expect(page.locator("#cloudflare_filter")).toBeChecked();
  await page.locator('[data-field="netbox"] .field-label').click({ position: { x: 4, y: 8 } });
  await expect(page.locator("#profileHelpModal")).toBeHidden();
  await page.locator('[data-profile-help="netbox"]').click();
  await expect(page.locator("#profileHelpTitle")).toHaveText("NetBox URL");
  await expect(page.locator("#profileHelpBody")).toContainText("base URL of the NetBox instance");
  await page.locator("#profileHelpOkBtn").click();
  await expect(page.locator("#profileHelpModal")).toBeHidden();
  await page.getByRole("link", { name: "Upgrade" }).click();
  await page.locator('[data-profile-help="remove_old_images"]').click();
  await expect(page.locator("#profileHelpTitle")).toHaveText("Remove old images");
  await expect(page.locator("#profileHelpBody")).toContainText("after all containers using that old image have recreated successfully");
  await page.locator("#profileHelpOkBtn").click();
  await page.getByRole("link", { name: "Delete" }).click();
  await page.locator('[data-profile-help="delete_volumes"]').click();
  await expect(page.locator("#profileHelpTitle")).toHaveText("Delete volumes");
  await expect(page.locator("#profileHelpBody")).toContainText("Leave it off to keep data volumes");
  await page.locator("#profileHelpOkBtn").click();
  await page.getByRole("link", { name: "Config" }).click();
  await expect(page.locator("#deleteConfigBtn")).toBeVisible();
  await expect(page.locator("#clearBtn")).toBeHidden();
  await expect(page.locator("#dockerRunBtn")).toBeHidden();
  await expect(page.locator("#saveTemplateBtn")).toBeHidden();
});

test("config profile warns when local profile is not synced to server", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("config_profiles", JSON.stringify({
      local: {
        netbox: "https://netbox.local.test",
        token: "local-secret",
        proxy: "",
        domain: "local.test",
        tag: "LOCAL",
        max_instances: 1,
      },
    }));
    localStorage.setItem("current_config_profile", "local");
  });

  await openAdmin(page, {});

  await expect(page.locator("#config_profile")).toHaveValue("local");
  await expect(page.locator("#profileSyncWarning")).toBeVisible();
  await expect(page.locator("#profileSyncWarning")).toHaveAttribute("aria-label", /exists only in this browser/);
  await expect(page.locator("#profileSyncWarning")).toHaveAttribute("title", /Save config/);
});

test("config profile shows green status when synced to server", async ({ page }) => {
  await openAdmin(page, {
    profile: "production",
    config_profile: "production",
    profiles: JSON.stringify({
      production: {
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "apps.example.com",
        tag: "production",
        max_instances: 1,
      },
    }),
  });

  await expect(page.locator("#config_profile")).toHaveValue("production");
  await expect(page.locator("#profileSyncWarning")).toBeVisible();
  await expect(page.locator("#profileSyncWarning")).toHaveClass(/is-ok/);
  await expect(page.locator("#profileSyncWarning")).toHaveAttribute("aria-label", "Profile synced with server.");
});

test("config page can send a test email when smtp and owner email are configured", async ({ page }) => {
  let emailBody = "";
  await page.route("**/mail-settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ owner_email_configured: true }),
    });
  });
  await page.route("**/test-email", async (route) => {
    emailBody = route.request().postData() || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "sent" }),
    });
  });
  await openAdmin(page, {
    profile: "prod",
    config_profile: "prod",
    profiles: JSON.stringify({
      prod: {
        netbox: "https://netbox.example.com",
        token: "secret",
        smtp_config: "mailer:smtp-secret@smtp.example.com:587",
      },
    }),
  });

  await expect(page.locator("#testEmailBtn")).toBeVisible();
  await page.locator("#testEmailBtn").click();
  await expect(page.locator("#notif")).toContainText("Test email sent");
  expect(emailBody).toContain('"smtp_config":"mailer:smtp-secret@smtp.example.com:587"');
});

test("config page exports config profiles and templates", async ({ page }) => {
  const exportPayload = {
    type: "saashup-config-export",
    version: 1,
    config: {
      profile: "production",
      profiles: {
        production: {
          netbox: "https://netbox.example.com",
          token: "secret",
          max_instances: 2,
        },
      },
    },
    templates: {
      Guide: {
        image: "saashup/guide",
      },
    },
    order_counts: {},
  };

  await page.route("**/portable-config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(exportPayload),
    });
  });

  await openAdmin(page, {});

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportConfigBtn").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^saashup-config-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(exported).toMatchObject(exportPayload);
  await expect(page.locator("#notif")).toContainText("Config export ready");
});

test("config page imports config profiles and templates", async ({ page }) => {
  let importedPayload;
  await page.route("**/portable-config", async (route) => {
    importedPayload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "imported" }),
    });
  });

  await openAdmin(page, {});
  page.on("dialog", (dialog) => dialog.accept());

  const importPayload = {
    type: "saashup-config-export",
    version: 1,
    config: {
      profile: "production",
      profiles: {
        production: {
          netbox: "https://netbox.example.com",
          token: "secret",
          proxy: "",
          domain: "apps.example.com",
          tag: "production",
          max_instances: 3,
          owner_env_var: "OWNER",
          cloudflare_filter: false,
        },
      },
    },
    templates: {
      Guide: {
        image: "saashup/guide",
        version: "v1.0.0",
      },
    },
    order_counts: {
      "ada@example.com": {
        production: 1,
      },
    },
  };

  await page.locator("#importConfigFile").setInputFiles({
    name: "saashup-config.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importPayload)),
  });

  await expect.poll(() => importedPayload).toMatchObject(importPayload);
  await expect(page.locator("#notif")).toContainText("Config import complete");
  await expect(page.locator("#config_profile")).toHaveValue("production");
  await expect(page.locator("#netbox")).toHaveValue("https://netbox.example.com");
  await expect(page.locator("#max_instances")).toHaveValue("3");
  await expect(page.locator("#owner_env_var")).toHaveValue("OWNER");
  await expect(page.locator("#cloudflare_filter")).not.toBeChecked();

  const localProfiles = await page.evaluate(() => JSON.parse(localStorage.getItem("config_profiles")));
  const localTemplates = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")));
  expect(localProfiles.production.tag).toBe("production");
  expect(localProfiles.production.owner_env_var).toBe("OWNER");
  expect(localProfiles.production.cloudflare_filter).toBe(false);
  expect(localTemplates.Guide.image).toBe("saashup/guide");
});

test("admin header shows oauth user and logs out through app auth", async ({ page }) => {
  await page.route("**/session/user", async (route) => {
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

  await openAdmin(page, {});

  await expect(page.locator("#authUser")).toBeVisible();
  await expect(page.locator("#authAvatar")).toHaveText("AL");
  await expect(page.locator("#authName")).toHaveText("Ada Lovelace");
  await expect(page.locator("#authEmail")).toHaveText("ada@example.com");

  await page.locator("#logoutBtn").click();
  await expect(page).toHaveURL("/");
});

test("admin sidebar can collapse and expand", async ({ page }) => {
  await page.goto("/admin");
  const shell = page.locator(".app-shell");
  const toggle = page.locator("#sidebarToggle");

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(shell).toHaveClass(/sidebar-collapsed/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#menu_config .nav-label")).toHaveCSS("opacity", "0");

  await page.reload();
  await expect(shell).toHaveClass(/sidebar-collapsed/);

  await toggle.click();
  await expect(shell).not.toHaveClass(/sidebar-collapsed/);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("metrics endpoint exposes prometheus runtime metrics", async ({ request }) => {
  const response = await request.get("/metrics");
  const body = await response.text();

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  expect(body).toContain("# HELP saashup_app_info Application build information.");
  expect(body).toContain('saashup_app_info{name="netbox-docker-image-upgrade"');
  expect(body).toContain("saashup_process_uptime_seconds");
  expect(body).toContain('saashup_process_memory_bytes{type="rss"}');
  expect(body).toContain('saashup_http_requests_total{route="/metrics"}');
  expect(body).toContain('saashup_http_requests_total{route="/create"}');
  expect(body).toContain('saashup_http_requests_total{route="/refresh-hosts"}');
  expect(body).toContain('saashup_http_requests_total{route="/delete"}');
  expect(body).toContain('saashup_http_requests_total{route="/restart"}');
  expect(body).toContain('saashup_http_requests_total{route="/recreate"}');
  expect(body).toContain('saashup_http_requests_total{route="/config"}');
  expect(body).toContain('saashup_operation_requests_total{operation="create",status_class="2xx"}');
  expect(body).toContain('saashup_operation_requests_total{operation="refresh",status_class="2xx"}');
  expect(body).toContain('saashup_operation_requests_total{operation="delete",status_class="2xx"}');
  expect(body).toContain('saashup_operation_requests_total{operation="restart",status_class="2xx"}');
  expect(body).toContain('saashup_operation_requests_total{operation="upgrade",status_class="2xx"}');
  expect(body).toContain('saashup_operation_requests_total{operation="config",status_class="2xx"}');
});

test("version endpoint exposes package version", async ({ request }) => {
  const response = await request.get("/version");

  expect(response.status()).toBe(200);
  await expect(response).toBeOK();
  expect(await response.json()).toMatchObject({
    name: packageJson.name,
    version: packageJson.version,
  });
});

test("report menu shows image usage for one config", async ({ page }) => {
  const config = {
    profile: "production",
    config_profile: "production",
    profiles: JSON.stringify({
      production: { netbox: "https://netbox.example.com", token: "secret", tag: "prod" },
      staging: { netbox: "https://netbox.example.com", token: "secret", tag: "stage" },
    }),
  };
  const reportRequests = [];
  let releaseFirstReport;

  await openAdmin(page, config);
  await expect(page.locator(".sidebar .nav-item")).toHaveText([
    "Config",
    "Create",
    "Upgrade",
    "Operate",
    "Delete",
    "Refresh",
    "Report",
  ]);
  await page.route("**/report/images?**", async (route) => {
    const url = new URL(route.request().url());
    reportRequests.push({
      profile: url.searchParams.get("profile"),
      profiles: JSON.parse(url.searchParams.get("profiles") || "{}"),
    });
    if (releaseFirstReport === undefined) {
      await new Promise((resolve) => {
        releaseFirstReport = resolve;
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: url.searchParams.get("profile"),
        total_hosts: 3,
        total_images: 2,
        total_containers: 5,
        total_users: 4,
        rows: [
          { profile: "production", image: "saashup/api", version: "v2.0.1", containers: 3 },
          { profile: "staging", image: "saashup/api", version: "v2.0.0", containers: 2 },
        ],
        users: [
          {
            user: "ada@example.com",
            profiles: ["production"],
            containers: 2,
            images: 1,
            items: [
              { profile: "production", container: "api-a", image: "saashup/api", version: "v2.0.1" },
              { profile: "production", container: "api-b", image: "saashup/api", version: "v2.0.1" },
            ],
          },
        ],
      }),
    });
  });

  await page.locator("#menu_report").click();
  await expect(page.locator("#reportCard")).toBeVisible();
  await expect(page.locator(".form-card")).toBeHidden();
  await expect(page.locator("#reportTableBody")).toContainText("Loading image report...");
  releaseFirstReport();
  await expect(page.locator("#reportProfileSelect option")).toHaveText(["production", "staging"]);

  await page.locator("#reportProfileSelect").selectOption("staging");
  await expect(page.locator('[data-report-stat="hosts"] strong')).toHaveText("3");
  await expect(page.locator('[data-report-stat="hosts"] small')).toHaveText("Hosts");
  await expect(page.locator('[data-report-stat="images"] strong')).toHaveText("2");
  await expect(page.locator('[data-report-stat="containers"] strong')).toHaveText("5");
  await expect(page.locator('[data-report-stat="users"] strong')).toHaveText("4");
  await expect(page.locator('[data-report-stat="users"] small')).toHaveText("Users");
  await expect(page.locator("#reportTableBody tr")).toHaveCount(2);
  await expect(page.locator("#reportTableBody")).toContainText("saashup/api");
  await expect(page.locator("#reportTableBody")).toContainText("v2.0.1");
  await page.getByRole("tab", { name: "Users" }).click();
  await expect(page.locator("#reportTableHead")).toContainText("What they have");
  await expect(page.locator("#reportTableBody")).toContainText("ada@example.com");
  await expect(page.locator("#reportTableBody")).toContainText("api-a - saashup/api:v2.0.1");
  await page.getByRole("tab", { name: "Images" }).click();
  await expect(page.locator("#reportTableHead")).toContainText("Image");
  expect(reportRequests.some((request) => request.profile === "all")).toBe(false);
  expect(reportRequests.at(-1).profiles.production.token).toBe("secret");
  expect(reportRequests.at(-1).profile).toBe("staging");
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

test("create form supports repeatable env, labels, ports, and volumes", async ({ page }) => {
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
  await expect(page.locator("[data-field='ports']")).toBeVisible();
  await expect(page.locator("[data-field='volumes']")).toBeVisible();
  await expect(page.locator("#port_value")).toHaveAttribute("required", "");
  await expect(page.locator("#envList .env-remove")).toBeEnabled();
  await expect(page.locator("#labelList .repeat-remove")).toBeEnabled();
  await expect(page.locator("#volume_name")).toHaveAttribute("readonly", "");
  await expect(page.locator("#volumeList .repeat-remove")).toBeEnabled();

  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 2 images");
  await page.locator("#image").fill("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.10.0");
  const generatedInstance = await page.locator("#instance").inputValue();

  await page.locator("#addEnvBtn").click();
  await page.locator("#addLabelBtn").click();
  await page.locator("#addVolumeBtn").click();

  await expect(page.locator("#envList .env-row")).toHaveCount(2);
  await expect(page.locator("#labelList .repeat-row")).toHaveCount(2);
  await expect(page.locator("#portList .repeat-row")).toHaveCount(1);
  await expect(page.locator("#volumeList .repeat-row")).toHaveCount(2);
  await page.locator('#volumeList [name="volume_source"]').first().fill("/app/data");
  await page.locator('#volumeList [name="volume_source"]').nth(1).fill("/app/cache");
  await expect(page.locator('#volumeList [name="volume_name"]').first()).toHaveValue(`${generatedInstance}-data`);
  await expect(page.locator('#volumeList [name="volume_name"]').nth(1)).toHaveValue(`${generatedInstance}-data-2`);

  await page.locator("#envList .env-remove").last().click();
  await page.locator("#labelList .repeat-remove").last().click();
  await page.locator("#volumeList .repeat-remove").last().click();

  await expect(page.locator("#envList .env-row")).toHaveCount(1);
  await expect(page.locator("#labelList .repeat-row")).toHaveCount(1);
  await expect(page.locator("#volumeList .repeat-row")).toHaveCount(1);
  await page.locator("#envList .env-remove").click();
  await expect(page.locator("#envList .env-row")).toHaveCount(0);
  await page.locator("#labelList .repeat-remove").click();
  await expect(page.locator("#labelList .repeat-row")).toHaveCount(0);
  await page.locator("#volumeList .repeat-remove").click();
  await expect(page.locator("#volumeList .repeat-row")).toHaveCount(0);
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

test("create form preloads a profile-based random instance name on page load", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("current_action", "create"));

  await openAdmin(page, {
    profile: "production",
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
      ports: [{ value: "8080" }],
      volumes: [],
    },
  });

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.locator("#config_profile")).toHaveValue("guide");

  await page.locator("#templateSelect").selectOption("Tile");

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
  await page.locator("#port_value").fill("3000");
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
        owner_env_var: "OWNER",
        cloudflare_filter: false,
      },
    }),
  });

  await page.getByRole("link", { name: "Create" }).click();
  await page.locator("#instance").fill("tiles");
  await page.locator("#image").fill("saashup/tiles");
  await page.locator("#port_value").fill("3000");
  await page.locator("#submitBtn").click();

  await expect.poll(() => createBody).toContain("instance=tiles.daily.paashup.cloud");
  expect(createBody).toContain("domain=daily.paashup.cloud");
  expect(createBody).toContain("owner_env_var=OWNER");
  expect(createBody).toContain("cloudflare_filter=false");
  expect(createBody).toContain("port_value=3000");
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
    "-e APP_ENV=production --label traefik.enable=true -p 8080:3000",
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
  await expect(page.locator("#port_value")).toHaveValue("3000");
  await expect(page.locator("#volume_source")).toHaveValue("/app/data");
  await expect(page.locator("#volume_name")).toHaveValue("guide-app-data");
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
  await expect(page.locator("#orderTemplateBtn")).toBeVisible();
  await expect(page.locator("#orderTemplateBtn")).toBeEnabled();
  await expect(page.locator("#orderTemplateBtn")).toHaveText("Select template to order");
  await expect(page.locator("#orderTemplateBtn")).toHaveClass(/btn-danger-outline/);
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
  await page.locator("#port_value").fill("3000");
  await page.locator("#volume_source").fill("/app/data");
  await expect(page.locator("#volume_name")).toHaveValue("guide-app-data");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Template name");
    expect(dialog.defaultValue()).toBe("");
    await dialog.accept("Guide");
  });
  await page.locator("#saveTemplateBtn").click();
  await expect(page.locator("#notif")).toContainText('Template "Guide" saved');
  const savedTemplate = await page.evaluate(() => JSON.parse(localStorage.getItem("create_templates")).Guide);
  expect(savedTemplate).not.toHaveProperty("instance");
  expect(savedTemplate.volumes).toEqual([{ key: "/app/data" }]);

  await page.evaluate(() => localStorage.removeItem("create_templates"));
  await page.reload();
  await page.getByRole("link", { name: "Create" }).click();

  await page.locator("#clearBtn").click();
  await expect(page.locator("#image")).toHaveValue("");
  const imageRequestsBeforeLoad = imageRequestCount;

  await page.locator("#templateSelect").selectOption("Guide");
  await expect(page.locator("#notif")).toContainText('Template "Guide" loaded');
  await expect(page.locator("#orderTemplateBtn")).toBeEnabled();
  await expect(page.locator("#orderTemplateBtn")).toHaveText("Order template");
  await expect(page.locator("#orderTemplateBtn")).toHaveClass(/btn-primary/);
  expect(imageRequestCount).toBeGreaterThanOrEqual(imageRequestsBeforeLoad);
  await expect(page.locator("#network")).toHaveValue("traefik-net");
  await expect(page.locator("#instance")).toHaveValue(/^production-[a-z0-9]{16}$/);
  await expect(page.locator("#instance")).not.toHaveValue("guide-app");
  await expect(page.locator("#image")).toHaveValue("saashup/guide");
  await expect(page.locator("#version")).toHaveValue("v1.10.0");
  await expect(page.locator("#var_env_key")).toHaveValue("APP_ENV");
  await expect(page.locator("#label_key")).toHaveValue("traefik.enable");
  await expect(page.locator("#port_value")).toHaveValue("3000");
  await expect(page.locator("#volume_source")).toHaveValue("/app/data");
  const loadedInstance = await page.locator("#instance").inputValue();
  await expect(page.locator("#volume_name")).toHaveValue(`${loadedInstance}-data`);

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

  await page.getByRole("link", { name: "Create" }).click();
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
      ports: [{ value: "3000" }],
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
  await expect(page.locator("[data-app-version]")).toHaveText(appVersion);
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
      ports: [{ value: "3000" }],
    },
  }, [], undefined, "/order?template=demo");

  await expect(page.locator("#orderLoading")).toBeHidden();
  await expect(page.locator("#orderActions")).toBeHidden();
  await expect(page.locator("#orderInstances")).toBeVisible();
  await expect(page.locator("#orderInstances")).toContainText("3 / 3");
  await expect(page.locator("#orderInstances")).toContainText("demo-1.daily.paashup.cloud");
  await expect(page.locator(".order-instance-card").first().locator(".order-instance-link")).toHaveAttribute("href", "https://demo-1.daily.paashup.cloud");
  await expect(page.locator(".order-instance-card").first().locator(".order-instance-delete")).toBeVisible();
  await expect(page.locator(".order-instance-card").nth(1).locator(".order-instance-delete")).toBeHidden();
  await expect(page.locator(".order-instance-card").nth(1).locator(".order-instance-status-creating")).toBeVisible();
  await expect(page.locator(".order-instance-card").nth(2).locator(".order-instance-delete")).toBeHidden();
  await expect(page.locator(".order-instance-card").nth(2).locator(".order-instance-status-failed")).toBeVisible();
  await expect(page.locator("#orderStatus")).toHaveClass(/error/);
  await expect(page.locator("#orderStatus")).toHaveText("You have reached your maximum of 3 instances for this config.");
  expect(createCalled).toBe(false);
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
  await expect(page.locator("#authUser")).toBeHidden();
  await expect(page.locator("#orderActions")).toBeHidden();

  resolveAuth();

  await expect(page.locator("#authUser")).toBeVisible();
  await expect(page.locator("#authAvatar")).toHaveText("AL");
  await expect(page.locator("#authName")).toHaveText("Ada Lovelace");
  await expect(page.locator("#authEmail")).toHaveText("ada@example.com");
  await expect(page.locator("#orderLoading")).toBeHidden();
  await expect(page.locator("#orderActions")).toBeVisible();
  await expect(page.locator(".order-question")).toHaveText("Are you sure you want to install an instance?");

  await page.locator("#logoutBtn").click();
  await expect(page).toHaveURL("/");
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
  await expect(page.locator("[data-field='remove_old_images']")).toBeVisible();
  await expect(page.locator("#remove_old_images")).not.toBeChecked();
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
  await page.locator("#version").fill("v1.0.0");
  await expect(page.locator("#remove_old_images")).toBeDisabled();
  await expect(page.locator("#remove_old_images")).not.toBeChecked();
  await expect(page.locator("#notif")).toHaveText("3 containers use saashup/app:v1.0.0");
  const countParams = new URL(countUrl).searchParams;
  expect(countParams.get("image")).toBe("saashup/app");
  expect(countParams.get("version")).toBe("v1.0.0");
  expect(countParams.get("tag")).toBe("production");
  await page.locator("#version").fill("v1.1.0");
  await expect(page.locator("#remove_old_images")).toBeEnabled();
  await page.locator("#remove_old_images").check();
  await page.locator("#clean_name").check();
  await page.locator("#submitBtn").click();

  await expect.poll(() => recreateBody).toContain("clean_name=true");
  expect(recreateBody).toContain("clean_name=true");
  expect(recreateBody).toContain("remove_old_images=true");
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
  let deleteBody = "";

  await page.route("**/delete", async (route) => {
    deleteBody = route.request().postData() || "";
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
  }, {}, (route) => {
    instancesUrl = route.request().url();
    return [
      { instance: "tiles.example.com", networks: ["traefik-public"] },
    ];
  });

  await page.getByRole("link", { name: "Delete" }).click();
  await expect(page.locator("[data-field='delete_volumes']")).toBeVisible();
  await expect(page.locator("#delete_volumes")).not.toBeChecked();
  await page.locator("#instance").fill("old-filter");
  await page.locator("#refreshInstancesBtn").click();

  await expect(page.locator("#notif")).toContainText("Loaded 1 instances");
  await expect(page.locator("#instance")).toHaveValue("");
  await expect.poll(() => page.locator("#instanceOptions option").evaluateAll((options) => options.map((option) => option.value))).toEqual(["tiles.example.com"]);
  expect(new URL(instancesUrl).searchParams.get("tag")).toBe("TILE");

  await page.locator("#instance").fill("tiles.example.com");
  await page.locator("#delete_volumes").check();
  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#submitBtn").click();
  await expect.poll(() => deleteBody).toContain("delete_volumes=true");
  expect(deleteBody).toContain("tag=TILE");
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

  await page.getByRole("link", { name: "Operate" }).click();
  await expect(page.locator("#operate_action option")).toHaveText(["Start", "Stop", "Restart", "Kill"]);
  await expect(page.locator("#operate_action")).toHaveValue("restart");
  await expect(page.locator("#restartInstanceBtn")).toHaveText("Operate instance");
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
  let restartBody = "";

  await page.route("**/containers-count?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 1 }),
    });
  });
  await page.route("**/restart", async (route) => {
    restartBody = route.request().postData() || "";
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

  await page.getByRole("link", { name: "Operate" }).click();
  await page.locator("#operate_action").selectOption("stop");
  await expect(page.locator("#restartInstanceBtn")).toHaveText("Operate instance");
  await expect(page.locator("#submitBtn")).toHaveText("Operate image");
  await page.locator("#submitBtn").click();
  await expect(page.locator("#notif")).toHaveText("Image name is required");

  await page.locator("#image").fill("saashup/app");
  await page.locator("#submitBtn").click();
  await expect(page.locator("#notif")).toHaveText("Version is required");

  await page.locator("#restart_version").fill("v1.0.0");
  await expect(page.locator("#notif")).toHaveText("1 container uses saashup/app:v1.0.0");
  await page.locator("#submitBtn").click();
  await expect.poll(() => restartBody).toContain("operate_action=stop");
  expect(restartBody).toContain("restart_mode=image");
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

  await page.getByRole("link", { name: "Report" }).click();
  await page.locator("#logsFullscreenBtn").click();
  await expect(page.locator("#logsCard")).toHaveClass(/fullscreen/);
  await expect(page.locator("#reportCard")).toBeHidden();
  await page.locator("#logsFullscreenBtn").click();
  await expect(page.locator("#reportCard")).toBeVisible();

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#clearLogsBtn").click();
  await expect(page.locator("#notif")).toContainText("Logs cleared");
});

test("logs polling network errors turn the notice danger", async ({ page }) => {
  await openAdmin(page, {}, {}, [
    { instance: "guide-app", networks: ["bridge", "traefik-net"] },
  ], async (route) => {
    if (route.request().method() === "GET") {
      await route.abort("failed");
      return;
    }

    await route.fulfill({ status: 204, body: "" });
  });

  await expect(page.locator("#notif")).toHaveText("Activity logs unavailable: network error");
  await expect(page.locator("#notif")).toHaveCSS("color", "rgb(153, 27, 27)");
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
    "--publish 127.0.0.1:8443:443/tcp",
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
  expect(parsed.ports).toContainEqual({ value: "443" });
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
