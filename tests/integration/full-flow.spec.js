const { test, expect } = require("@playwright/test");

const profile = process.env.INTEGRATION_PROFILE || "integration";
const netboxUrl = process.env.INTEGRATION_NETBOX_URL || "http://integration-paasbox:8000";
const netboxToken = process.env.INTEGRATION_NETBOX_TOKEN || "integration";
const imageName = process.env.INTEGRATION_IMAGE || "nginx";
const imageVersion = process.env.INTEGRATION_IMAGE_VERSION || "1.31.1";
const imagePort = process.env.INTEGRATION_IMAGE_PORT || "80";
const cleanupNames = new Set();

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

test('create docker host', async ({ request }) => {
  test.setTimeout(15000);
  const tagResponse = await request.post(
    'http://localhost:8001/api/extras/tags/',
    {
      data: {
        name: "integration",
        slug: "integration",
      }
    }
  );
  expect(tagResponse.ok()).toBeTruthy();

  const hostResponse = await request.post(
    'http://localhost:8001/api/plugins/docker/hosts/',
    {
      data: {
        endpoint: "http://admin:saashup@integration-agent:1880",
        name: "integration-agent",
        tags: ["1"],
        netbox_base_url: 'http://integration-paasbox:8000'
      }
    }
  );

  expect(hostResponse.ok()).toBeTruthy();
  await new Promise(resolve => setTimeout(resolve, 12000));
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

test.afterEach(async ({ request }) => {
  for (const name of [...cleanupNames].reverse()) {
    await postForm(request, "/delete", {
      profile,
      config_profile: profile,
      instance: `${name}.integration.localhost`,
    }).catch(() => {});
    cleanupNames.delete(name);
  }
});

test("enrolls an image, creates an instance from it, and shows both in the app", async ({ page, request }) => {
  test.slow();
  await expectAppAndNetBoxReady(request);

  const suffix = Date.now().toString(36);
  const templateName = `it-template-${suffix}`;
  const templateInstance = `it-enroll-${suffix}`;
  const orderInstance = `it-order-${suffix}`;
  cleanupNames.add(orderInstance);
  cleanupNames.add(templateInstance);

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
