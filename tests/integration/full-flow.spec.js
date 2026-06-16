const { test, expect } = require("@playwright/test");
const crypto = require("crypto");

const profile = process.env.INTEGRATION_PROFILE || "integration";
const netboxUrl = process.env.INTEGRATION_NETBOX_URL || "http://integration-paasbox:8000";
const netboxToken = process.env.INTEGRATION_NETBOX_TOKEN || "integration";
const paasboxUrl = process.env.INTEGRATION_PAASBOX_URL || "http://localhost:8001";
const imageName = process.env.INTEGRATION_IMAGE || "saashup/curioo-tiles";
const imageVersion = process.env.INTEGRATION_IMAGE_VERSION || "v2.7.1";
const imagePort = process.env.INTEGRATION_IMAGE_PORT || "80";
const suffix = Date.now().toString(36);
const flow = {
  templateName: `it-template-${suffix}`,
  templateInstance: `it-enroll-${suffix}`,
  orderInstance: `it-order-${suffix}`,
};
flow.templateInstanceName = `${flow.templateInstance}.integration.localhost`;
flow.orderInstanceName = `${flow.orderInstance}.integration.localhost`;

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

function instanceShort(name) {
  return String(name || "").split(".")[0];
}

function templateCatalogContextName() {
  const normalizedNetBoxUrl = String(netboxUrl || "").trim().replace(/\/+$/, "").toLowerCase();
  const tag = "integration";
  const scopeKey = crypto.createHash("sha1").update(`${profile}\n${normalizedNetBoxUrl}\n${tag}`).digest("hex").slice(0, 12);
  const profilePart = String(profile || "default").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
  return `saashup-template-catalog-${profilePart}-${scopeKey}`;
}

test('create docker host', async ({ request }) => {
  test.setTimeout(60000);
  let tag = await firstResult(
    await request.get(`${paasboxUrl}/api/extras/tags/`, { params: { slug: "integration" } }),
    "lookup integration tag",
  );
  if (!tag) {
    const tagResponse = await request.post(
      `${paasboxUrl}/api/extras/tags/`,
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
    await request.get(`${paasboxUrl}/api/plugins/docker/hosts/`, { params: { name: "integration-agent" } }),
    "lookup integration host",
  );
  if (!host) {
    const hostResponse = await request.post(
      `${paasboxUrl}/api/plugins/docker/hosts/`,
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

  await expect.poll(async () => {
    const containersResponse = await request.get(`${paasboxUrl}/api/plugins/docker/containers/`, {
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
  const response = await request.delete(`/enroll/template/${encodeURIComponent(name)}`, {
    params: { profile },
  });
  await expectOk(response, `delete template ${name}`);
  return response.json();
}

async function deleteInstance(request, name) {
  if (!name) return;
  const response = await postForm(request, "/delete", {
    wait: "true",
    profile,
    config_profile: profile,
    instance: name,
  });
  await expectOk(response, `delete instance ${name}`);
  await expect(await response.json()).toMatchObject({ status: "finished" });
}

async function expectOrderInstanceListed(request, instance, listed, expected = {}) {
  const response = await request.get("/order/limit", { params: { profile } });
  await expectOk(response, "order limit");
  const payload = await response.json();
  const matcher = expect.objectContaining({ instance, ...expected });
  if (listed) {
    expect(payload.instances).toEqual(expect.arrayContaining([matcher]));
  } else {
    expect(payload.instances || []).not.toEqual(expect.arrayContaining([matcher]));
  }
}

async function expectEnrollmentListed(request, templateName, listed) {
  const response = await request.get("/enroll/limit", {
    params: { profile, owner_only: "false" },
  });
  await expectOk(response, "enroll limit");
  const payload = await response.json();
  const matcher = expect.objectContaining({ instance: templateName });
  if (listed) {
    expect(payload.instances).toEqual(expect.arrayContaining([matcher]));
  } else {
    expect(payload.instances || []).not.toEqual(expect.arrayContaining([matcher]));
  }
}

async function netBoxContainersByInstance(request, instance) {
  const shortName = instanceShort(instance);
  const response = await request.get(`${paasboxUrl}/api/plugins/docker/containers/`, {
    params: { name: shortName, limit: 1000 },
  });
  await expectOk(response, `lookup Paasbox container ${instance}`);
  const payload = await response.json();
  const containers = Array.isArray(payload.results) ? payload.results : [];
  return containers.filter((item) => {
    const names = [item.name, item.display, item.dns_name, item.instance]
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase());
    return names.includes(shortName.toLowerCase()) || names.includes(String(instance).trim().toLowerCase());
  });
}

async function expectNetBoxContainerListed(request, instance, listed) {
  const containerCount = expect.poll(async () => (await netBoxContainersByInstance(request, instance)).length, {
    timeout: 45_000,
    intervals: [2_000],
    message: `Paasbox container ${instance} should ${listed ? "exist" : "be deleted"}`,
  });
  if (listed) {
    await containerCount.toBeGreaterThan(0);
  } else {
    await containerCount.toBe(0);
  }
}

async function netBoxTemplateNames(request) {
  const contextName = templateCatalogContextName();
  const response = await request.get(`${paasboxUrl}/api/extras/config-contexts/`, {
    params: { q: contextName, limit: 20 },
  });
  await expectOk(response, "lookup Paasbox template catalog config context");
  const payload = await response.json();
  const contexts = Array.isArray(payload.results) ? payload.results : [];
  const context = contexts.find((item) => String(item?.name || "") === contextName);
  const templates = context?.data?.saashup_templates || {};
  return Object.keys(templates);
}

async function expectNetBoxTemplateListed(request, templateName, listed) {
  await expect.poll(async () => {
    const names = await netBoxTemplateNames(request);
    return names.some((name) => name.toLowerCase() === templateName.toLowerCase());
  }, {
    timeout: 45_000,
    intervals: [2_000],
    message: `Paasbox template ${templateName} should ${listed ? "exist" : "be deleted"}`,
  }).toBe(listed);
}

test("enrolls an image, creates an instance from it", async ({ request }) => {
  test.slow();
  await expectAppAndNetBoxReady(request);

  const enrollResponse = await postForm(request, "/create", createFields(flow.templateInstance, {
    enroll_request: "true",
    template_name: flow.templateName,
    order_template: flow.templateName,
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
      instance: flow.templateName,
      image: imageName,
      version: imageVersion,
      config_profile: profile,
      status: "ready",
    }),
  ]));

  const orderResponse = await postForm(request, "/create", createFields(flow.orderInstance, {
    order_request: "true",
    order_template: flow.templateName,
    template_name: flow.templateName,
  }));
  await expectOk(orderResponse, "order instance create");
  await expect(await orderResponse.json()).toMatchObject({ status: "finished" });

  await expectOrderInstanceListed(request, flow.orderInstanceName, true, {
    image: imageName,
    version: imageVersion,
  });
});

test("shows both in the app", async ({ page }) => {
  await page.goto("/catalog");
  await expect(page.locator("#catalogList")).toContainText(flow.templateName);
  await expect(page.locator("#catalogList")).toContainText(profile);

  await page.goto(`/order?template=${encodeURIComponent(flow.templateName)}`);
  await expect(page.locator("#config_profile")).toHaveValue(profile);
  await expect(page.locator("#image")).toHaveValue(imageName);
  await expect(page.locator("#version")).toHaveValue(imageVersion);
});

test("deletes them", async ({ request }) => {
  test.slow();
  await expectNetBoxContainerListed(request, flow.orderInstanceName, true);
  await deleteInstance(request, flow.orderInstanceName);
  await expectNetBoxContainerListed(request, flow.orderInstanceName, false);
  await expectOrderInstanceListed(request, flow.orderInstanceName, false);

  await expectNetBoxContainerListed(request, flow.templateInstanceName, true);
  await expectNetBoxTemplateListed(request, flow.templateName, true);
  await deleteInstance(request, flow.templateInstanceName);
  await expectNetBoxContainerListed(request, flow.templateInstanceName, false);
  await deleteTemplate(request, flow.templateName);
  await expectNetBoxTemplateListed(request, flow.templateName, false);
  await expectEnrollmentListed(request, flow.templateName, false);
});
