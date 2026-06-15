const { test, expect } = require("@playwright/test");

const profile = process.env.INTEGRATION_PROFILE || "integration";
const netboxUrl = process.env.INTEGRATION_NETBOX_URL || "http://integration-paasbox:8000";
const netboxToken = process.env.INTEGRATION_NETBOX_TOKEN || "integration";
const imageName = process.env.INTEGRATION_IMAGE || "saashup/curioo-tiles";
const imageVersion = process.env.INTEGRATION_IMAGE_VERSION || "v2.7.1";
const imagePort = process.env.INTEGRATION_IMAGE_PORT || "80";
const cleanupNames = new Set();
const cleanupTemplates = new Set();

test.skip(!netboxToken, "Set INTEGRATION_NETBOX_TOKEN to a Paasbox/NetBox API token before running integration tests.");
test.describe.configure({ mode: "serial" });

async function responseText(response) {
  return response.text().catch(() => "");
}

async function expectOk(response, label) {
  if (response.ok()) return;
  throw new Error(`${label} failed with HTTP ${response.status()}: ${await responseText(response)}`);
}

async function postForm(request, path, fields) {
  return request.post(path, {
    headers: { Accept: "application/json" },
    form: fields,
  });
}

async function firstResult(response, label) {
  await expectOk(response, label);
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results[0] : null;
}

async function refreshHost(request, host) {
  if (!host?.id) return;
  await request.patch(`http://localhost:8001/api/plugins/docker/hosts/${host.id}/`, {
    data: { operation: "refresh" },
  }).catch(() => {});
}

async function waitForHostReady(request, host) {
  if (!host?.id) return;
  await expect.poll(async () => {
    const response = await request.get(`http://localhost:8001/api/plugins/docker/hosts/${host.id}/`);
    if (!response.ok()) return "";
    const payload = await response.json();
    return String(payload.operation || "").toLowerCase();
  }, {
    timeout: 45_000,
    intervals: [3_000],
    message: "integration Docker host refresh should finish",
  }).toBe("none");
}

test('create docker host', async ({ request }) => {
  test.setTimeout(60000);
  let tag = await firstResult(
    await request.get('http://localhost:8001/api/extras/tags/', { params: { slug: "integration" } }),
    "lookup integration tag",
  );
  if (!tag) {
    const tagResponse = await request.post(
      'http://localhost:8001/api/extras/tags/',
      {
        data: {
          name: "integration",
          slug: "integration",
        }
      }
    );
    await expectOk(tagResponse, "create integration tag");
    tag = await tagResponse.json();
  }

  let host = await firstResult(
    await request.get('http://localhost:8001/api/plugins/docker/hosts/', { params: { name: "integration-agent" } }),
    "lookup integration host",
  );
  if (!host) {
    const hostResponse = await request.post(
      'http://localhost:8001/api/plugins/docker/hosts/',
      {
        data: {
          endpoint: "http://admin:saashup@integration-agent:1880",
          name: "integration-agent",
          tags: [tag.id],
          netbox_base_url: 'http://integration-paasbox:8000'
        }
      }
    );

    await expectOk(hostResponse, "create integration host");
    host = await hostResponse.json();
  }

  await refreshHost(request, host);
  await waitForHostReady(request, host);

  await expect.poll(async () => {
    const containersResponse = await request.get("http://localhost:8001/api/plugins/docker/containers/", {
      params: { limit: 1000 },
    });
    await expectOk(containersResponse, "lookup integration containers");
    const containersPayload = await containersResponse.json();
    const containerNames = (Array.isArray(containersPayload.results) ? containersPayload.results : [])
      .map((item) => item.name || item.display || "");
    return containerNames
      .filter((name) => [
        "integration-agent",
        "integration-paasbox",
        "integration-app",
      ].includes(name))
      .sort();
  }, {
    timeout: 45000,
    intervals: [3000],
    message: "integration agent should report the three stack containers",
  }).toEqual([
    "integration-agent",
    "integration-app",
    "integration-paasbox",
  ]);
});

async function saveIntegrationConfig(request) {
  const profileConfig = {
    netbox: netboxUrl,
    token: netboxToken,
    tag: "integration",
    domain: "integration.localhost",
    max_instances: 5,
    enrollment_limit: 5,
    owner_env_var: "SAASHUP_OWNER",
    cloudflare_filter: false,
    saashup_visible: true,
  };
  const response = await request.get("/webhook", {
    params: {
      profile,
      config_profile: profile,
      customer_name: "Integration",
      netbox: netboxUrl,
      token: netboxToken,
      tag: "integration",
      domain: "integration.localhost",
      max_instances: "5",
      enrollment_limit: "5",
      owner_env_var: "SAASHUP_OWNER",
      cloudflare_filter: "false",
      profiles: JSON.stringify({ [profile]: profileConfig }),
    },
  });
  await expectOk(response, "save integration config");
}

async function expectAppAndNetBoxReady(request) {
  await expect.poll(async () => (await request.get("/version")).status(), {
    timeout: 60_000,
    message: "app should answer /version",
  }).toBe(200);

  await saveIntegrationConfig(request);

  await expect.poll(async () => {
    const response = await request.get("/test", { params: { profile } });
    return response.status();
  }, {
    timeout: 10_000,
    intervals: [2_000],
    message: "configured Paasbox/NetBox profile should be reachable",
  }).toBe(200);
}

function createFields(name, extra = {}) {
  return {
    wait: "true",
    profile,
    config_profile: profile,
    instance: `${name}.integration.localhost`,
    image: imageName,
    network: "integration_default",
    version: imageVersion,
    port_value: imagePort,
    max_instances: "2",
    traefik: "true",
    cloudflare_filter: "false",
    saashup_enabled: "true",
    ...extra,
  };
}

async function deleteTemplate(request, name) {
  if (!name) return;
  await request.delete(`/enroll/template/${encodeURIComponent(name)}`).catch(() => {});
}

async function deleteInstance(request, name) {
  if (!name) return;
  await postForm(request, "/delete", {
    wait: "true",
    profile,
    config_profile: profile,
    instance: name,
  }).catch(() => {});
}

async function cleanupPreviousIntegrationContainers(request) {
  const host = await firstResult(
    await request.get('http://localhost:8001/api/plugins/docker/hosts/', { params: { name: "integration-agent" } }),
    "lookup integration host before cleanup",
  );
  await refreshHost(request, host);
  await waitForHostReady(request, host);

  const response = await request.get("http://localhost:8001/api/plugins/docker/containers/", {
    params: { limit: 1000 },
  });
  await expectOk(response, "lookup previous integration containers");
  const payload = await response.json();
  const previousNames = (Array.isArray(payload.results) ? payload.results : [])
    .map((item) => item.name || item.display || "")
    .filter((name) => String(name).startsWith("it-enroll-") || String(name).startsWith("it-order-"));
  for (const name of previousNames) await deleteInstance(request, name);
}

async function cleanupPreviousEnrollmentTemplates(request) {
  await cleanupPreviousIntegrationContainers(request);
  const response = await request.get("/enroll/limit", {
    params: { profile, owner_only: "false" },
  });
  await expectOk(response, "lookup previous enrollments");
  const payload = await response.json();
  const previousTemplates = (Array.isArray(payload.instances) ? payload.instances : [])
    .filter((item) => String(item.instance || "").startsWith("it-template-"))
    .filter((item) => String(item.image || "") === imageName)
    .map((item) => item.instance);
  for (const name of previousTemplates) await deleteTemplate(request, name);
}

test.afterEach(async ({ request }) => {
  for (const name of [...cleanupNames].reverse()) {
    await deleteInstance(request, `${name}.integration.localhost`);
    cleanupNames.delete(name);
  }
  for (const name of [...cleanupTemplates].reverse()) {
    await deleteTemplate(request, name);
    cleanupTemplates.delete(name);
  }
});

test("enrolls an image, creates an instance from it, and shows both in the app", async ({ page, request }) => {
  test.slow();
  await expectAppAndNetBoxReady(request);
  await cleanupPreviousEnrollmentTemplates(request);

  const suffix = Date.now().toString(36);
  const templateName = `it-template-${suffix}`;
  const templateInstance = `it-enroll-${suffix}`;
  const orderInstance = `it-order-${suffix}`;
  cleanupNames.add(orderInstance);
  cleanupNames.add(templateInstance);
  cleanupTemplates.add(templateName);

  const enrollResponse = await postForm(request, "/create", createFields(templateInstance, {
    enroll_request: "true",
    template_name: templateName,
    order_template: templateName,
  }));
  await expectOk(enrollResponse, "enroll image create");
  await expect(await enrollResponse.json()).toMatchObject({ status: "finished" });

  const enrollLimit = await request.get("/enroll/limit", {
    params: { profile, owner_only: "false" },
  });
  await expectOk(enrollLimit, "enroll limit");
  const enrollPayload = await enrollLimit.json();
  expect(enrollPayload.instances).toEqual(expect.arrayContaining([
    expect.objectContaining({
      instance: templateName,
      image: imageName,
      version: imageVersion,
      config_profile: profile,
      status: "ready",
    }),
  ]));

  const orderResponse = await postForm(request, "/create", createFields(orderInstance, {
    order_request: "true",
    order_template: templateName,
    template_name: templateName,
  }));
  await expectOk(orderResponse, "order instance create");
  await expect(await orderResponse.json()).toMatchObject({ status: "finished" });

  const orderLimit = await request.get("/order/limit", { params: { profile } });
  await expectOk(orderLimit, "order limit");
  const orderPayload = await orderLimit.json();
  expect(orderPayload.instances).toEqual(expect.arrayContaining([
    expect.objectContaining({
      instance: `${orderInstance}.integration.localhost`,
      image: imageName,
      version: imageVersion,
    }),
  ]));

  await page.goto("/catalog");
  await expect(page.locator("#catalogList")).toContainText(templateName);
  await expect(page.locator("#catalogList")).toContainText(profile);

  await page.goto(`/order?template=${encodeURIComponent(templateName)}`);
  await expect(page.locator("#config_profile")).toHaveValue(profile);
  await expect(page.locator("#image")).toHaveValue(imageName);
  await expect(page.locator("#version")).toHaveValue(imageVersion);
});
