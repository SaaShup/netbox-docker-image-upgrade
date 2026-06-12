const { test, expect, fs, openAdmin, appVersion } = require("./fixtures");

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

  await page.addInitScript(() => {
    localStorage.setItem("current_config_profile", "production");
  });

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
        saashup_visible: true,
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
  let imagesUrl = "";
  const deleteBodies = [];

  await page.route("**/delete", async (route) => {
    deleteBody = route.request().postData() || "";
    deleteBodies.push(deleteBody);
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
        { name: "saashup/tile", version: "v1.0.0" },
      ]),
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
  await expect(page.locator('[data-delete-section="options"] h4')).toHaveText("Options");
  await expect(page.locator('[data-delete-section="instance"] h4')).toHaveText("Delete Instance");
  await expect(page.locator('[data-delete-section="image"] h4')).toHaveText("Delete By Image");
  await expect(page.locator("[data-field='delete_volumes']")).toBeVisible();
  await expect(page.locator("[data-field='image']")).toBeVisible();
  await expect(page.locator("[data-field='remove_image']")).toBeVisible();
  await expect(page.locator("#deleteInstanceBtn")).toBeVisible();
  await expect(page.locator("#deleteImageBtn")).toBeVisible();
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
  await page.locator("#deleteInstanceBtn").click();
  await expect.poll(() => deleteBody).toContain("delete_volumes=true");
  expect(deleteBody).toContain("tag=TILE");

  await page.locator("#refreshImagesBtn").click();
  await expect(page.locator("#notif")).toContainText("Loaded 1 images");
  await expect.poll(() => page.locator("#imageOptions option").evaluateAll((options) => options.map((option) => option.value))).toEqual(["saashup/tile"]);
  expect(new URL(imagesUrl).searchParams.get("tag")).toBe("TILE");

  await page.locator("#image").fill("saashup/tile");
  await page.locator("#remove_image").check();
  await page.locator("#deleteImageBtn").click();
  await expect.poll(() => deleteBodies.at(-1) || "").toContain("delete_mode=image");
  expect(deleteBodies.at(-1)).toContain("image=saashup%2Ftile");
  expect(deleteBodies.at(-1)).toContain("remove_image=true");
  expect(deleteBodies.at(-1)).toContain("tag=TILE");
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

  await page.getByRole("link", { name: "Workflow" }).click();
  await page.locator("#logsFullscreenBtn").click();
  await expect(page.locator("#logsCard")).toHaveClass(/fullscreen/);
  await expect(page.locator("#workflowCard")).toBeHidden();
  await page.locator("#logsFullscreenBtn").click();
  await expect(page.locator("#workflowCard")).toBeVisible();

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
    "--log-driver=syslog --log-opt syslog-address=udp://127.0.0.1:5514 --log-opt tag=\"{{.Name}}\"",
    "--env PUBLIC_URL=https://tiles.example.com/a?b=c",
    "--label traefik.http.routers.tile.rule=Host(`tiles.example.com`)",
    "--publish 127.0.0.1:8443:443/tcp",
    "--volume tile-cache:/app/cache:ro",
    "--volume /var/run/docker.sock:/var/run/docker.sock:ro",
    "registry.example.com:5000/saashup/tile-api:v2.4.1",
  ].join(" ")));

  expect(parsed).toMatchObject({
    instance: "tile-api",
    network: "proxy",
    log_driver: "syslog",
    log_driver_options: { "syslog-address": "udp://127.0.0.1:5514", tag: "{{.Name}}" },
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
  expect(parsed.binds).toContainEqual({ host_path: "/var/run/docker.sock", container_path: "/var/run/docker.sock", read_only: true });
});

test("log formatter escapes unexpected html content", async ({ page }) => {
  await openAdmin(page, {});

  const formatted = await page.evaluate(() => window.formatLogs(
    "2026-05-29T11:43:31.806Z REFRESH_HOST : <script>alert(1)</script> 200",
  ));

  expect(formatted).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(formatted).not.toContain("<script>alert(1)</script>");
});
