const { request: apiRequest, test, expect } = require("@playwright/test");
const crypto = require("crypto");

const profile = process.env.INTEGRATION_PROFILE || "integration";
const netboxUrl = process.env.INTEGRATION_NETBOX_URL || "http://integration-paasbox:8000";
const netboxToken = process.env.INTEGRATION_NETBOX_TOKEN || "integration";
const paasboxUrl = process.env.INTEGRATION_PAASBOX_URL || "http://localhost:8001";
const integrationAppUrl = process.env.INTEGRATION_APP_URL || "http://127.0.0.1:3000";
const imageName = process.env.INTEGRATION_IMAGE || "saashup/curioo-tiles";
const imageVersion = process.env.INTEGRATION_IMAGE_VERSION || "v2.7.1";
const imagePort = process.env.INTEGRATION_IMAGE_PORT || "80";
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const flow = {
  templateName: `it-template-${suffix}`,
  templateInstance: `it-enroll-${suffix}`,
  duplicateTemplateInstance: `it-enroll-dup-${suffix}`,
  orderInstance: `it-order-${suffix}`,
  orderInstanceOtherUser: `it-order-other-${suffix}`,
};
let resolvedTemplateName = flow.templateName;
let resolvedTemplateInstanceName = `${flow.templateInstance}.integration.localhost`;
flow.templateInstanceName = `${flow.templateInstance}.integration.localhost`;
flow.orderInstanceName = `${flow.orderInstance}.integration.localhost`;
flow.orderInstanceOtherUserName = `${flow.orderInstanceOtherUser}.integration.localhost`;
const defaultUserEmail = String(process.env.INTEGRATION_DEFAULT_USER || "admin@local.test").trim().toLowerCase();
const defaultUserHeaders = requestHeaders(defaultUserEmail);
const otherUserEmail = String(process.env.INTEGRATION_OTHER_USER || "demo@local.test").trim().toLowerCase();
const otherUserHeaders = requestHeaders(otherUserEmail);

test.skip(!netboxToken, "Set INTEGRATION_NETBOX_TOKEN to a Paasbox/NetBox API token before running integration tests.");
test.describe.configure({ mode: "serial" });

async function responseText(response) {
  return response.text().catch(() => "");
}

async function expectOk(response, label) {
  if (response.ok()) return;
  throw new Error(`${label} failed with HTTP ${response.status()}: ${await responseText(response)}`);
}

async function requestSessionUser(request, headers = {}) {
  const response = await request.get("/session/user", { headers });
  await expectOk(response, "session user");
  return response.json();
}

async function orderLimitPayload(request, templateName, headers = {}) {
  const params = { profile };
  if (templateName) params.template = templateName;
  const response = await request.get("/order/limit", { params, headers });
  await expectOk(response, "order limit");
  return response.json();
}

async function postForm(request, path, fields, headers = {}) {
  return request.post(path, {
    headers: { Accept: "application/json", ...headers },
    data: fields,
  });
}

async function createUserRequestContext(emailOrHeaders) {
  const headers = typeof emailOrHeaders === "string"
    ? requestHeaders(emailOrHeaders)
    : emailOrHeaders || {};
  return apiRequest.newContext({
    baseURL: integrationAppUrl,
    extraHTTPHeaders: headers,
  });
}

function requestHeaders(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return {};
  return {
    "x-auth-request-email": normalized,
    "x-forwarded-email": normalized,
    "x-auth-request-user-email": normalized,
    "x-auth-request-user": normalized,
    "x-forwarded-user": normalized,
    "x-auth-request-preferred-username": normalized,
    "x-forwarded-preferred-username": normalized,
  };
}

async function firstResult(response, label) {
  await expectOk(response, label);
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results[0] : null;
}

function instanceShort(name) {
  return String(name || "").split(".")[0];
}

function objectLabelValue(labels, wantedKey) {
  if (!labels) return "";
  if (Array.isArray(labels)) {
    const match = labels.find((item) => String(item?.key || "").trim().toLowerCase() === wantedKey);
    return String(match?.value || "").trim();
  }
  return String(labels[wantedKey] || "").trim();
}

function normalizedContainerInstance(item) {
  return String(item?.dns_name || item?.display || item?.name || "").trim();
}

function splitImageRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return ["", ""];
  const withoutDigest = raw.split("@")[0];
  const slashIndex = withoutDigest.lastIndexOf("/");
  const colonIndex = withoutDigest.lastIndexOf(":");
  if (colonIndex > slashIndex) return [withoutDigest.slice(0, colonIndex).toLowerCase(), withoutDigest.slice(colonIndex + 1).toLowerCase()];
  return [withoutDigest.toLowerCase(), ""];
}

function containerImageMatch(item, expectedImage, expectedVersion) {
  const expectedName = String(expectedImage || "").trim().toLowerCase();
  const expectedTag = String(expectedVersion || "").trim().toLowerCase();
  const candidates = new Set([
    item?.image,
    item?.image_name,
    item?.image_display,
    item?.image?.name,
    `${item?.image?.name || ""}:${item?.image?.tag || ""}`,
  ].filter(Boolean).map((value) => String(value).trim()));
  for (const candidate of candidates) {
    const [name, tag] = splitImageRef(candidate);
    if (!name || name !== expectedName) continue;
    if (!expectedTag) return true;
    if (tag && tag === expectedTag) return true;
  }
  return false;
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
    max_instances: "1",
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

async function deleteInstance(request, name, options = {}) {
  if (!name) return;
  const headers = options.headers || defaultUserHeaders;
  const response = await postForm(request, "/delete", {
    wait: "true",
    profile,
    config_profile: profile,
    instance: name,
  }, headers);
  await expectOk(response, `delete instance ${name}`);
  await expect(await response.json()).toMatchObject({ status: "finished" });
}

async function expectOrderInstanceListed(request, instance, listed, expected = {}, options = {}) {
  const headers = options.headers || defaultUserHeaders;
  const payload = await orderLimitPayload(request, undefined, headers);
  const matcher = expect.objectContaining({ instance, ...expected });
  if (listed) {
    expect(payload.instances).toEqual(expect.arrayContaining([matcher]));
  } else {
    expect(payload.instances || []).not.toEqual(expect.arrayContaining([matcher]));
  }
}

async function expectEnrollmentListed(request, templateName, listed) {
  const headers = defaultUserHeaders;
  const response = await request.get("/enroll/limit", {
    params: { profile, owner_only: "false" },
    headers,
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

async function netBoxContainersForTemplate(request, templateName, ownerEmail = "") {
  const response = await request.get(`${paasboxUrl}/api/plugins/docker/containers/`, {
    params: { limit: 1000 },
  });
  await expectOk(response, "lookup Paasbox containers");
  const payload = await response.json();
  const containers = Array.isArray(payload.results) ? payload.results : [];
  const normalizedTemplate = String(templateName || "").trim().toLowerCase();
  const normalizedOwner = String(ownerEmail || "").trim().toLowerCase();
  const byTemplate = containers.filter((item) => {
    const templateLabel = objectLabelValue(item?.labels, "saashup.template.name").toLowerCase();
    if (normalizedTemplate && templateLabel !== normalizedTemplate) return false;
    return true;
  });
  if (!normalizedOwner) return byTemplate;

  const byOwner = byTemplate.filter((item) => {
    const ownerLabel = objectLabelValue(item?.labels, "saashup.template.owner").toLowerCase();
    if (!ownerLabel) return true;
    return ownerLabel === normalizedOwner;
  });
  return byOwner.length ? byOwner : byTemplate;
}

async function resolveTemplateInstanceContainer(request, templateName, ownerEmail = "") {
  const labeledContainers = await netBoxContainersForTemplate(request, templateName, ownerEmail);
  if (labeledContainers.length) {
    const enrollMatch = labeledContainers.find((item) => normalizedContainerInstance(item).toLowerCase().startsWith("it-enroll-"));
    return normalizedContainerInstance(enrollMatch || labeledContainers[0]);
  }

  const response = await request.get(`${paasboxUrl}/api/plugins/docker/containers/`, {
    params: { limit: 1000 },
  });
  await expectOk(response, "lookup Paasbox containers");
  const payload = await response.json();
  const containers = Array.isArray(payload.results) ? payload.results : [];
  const normalizedTemplate = String(templateName || "").trim().toLowerCase();
  const normalizedOwner = String(ownerEmail || "").trim().toLowerCase();
  const byTemplate = containers.filter((item) => {
    const templateLabel = objectLabelValue(item?.labels, "saashup.template.name").toLowerCase();
    return !templateLabel || templateLabel === normalizedTemplate;
  });
  const imageMatched = byTemplate.filter((item) => containerImageMatch(item, imageName, imageVersion));
  const ownerMatched = normalizedOwner ? imageMatched.filter((item) => {
    const ownerLabel = objectLabelValue(item?.labels, "saashup.template.owner").toLowerCase();
    return !ownerLabel || ownerLabel === normalizedOwner;
  }) : imageMatched;
  const templateMatched = ownerMatched.filter((item) => {
    const templateLabel = objectLabelValue(item?.labels, "saashup.template.name").toLowerCase();
    return !templateLabel || templateLabel === normalizedTemplate;
  });
  const itEnrollMatch = templateMatched.find((item) => normalizedContainerInstance(item).toLowerCase().startsWith("it-enroll-"));
  const fallbackContainer = itEnrollMatch || templateMatched[0] || ownerMatched[0] || imageMatched[0];

  const fallbackShort = normalizedContainerInstance(fallbackContainer || {});
  if (!fallbackShort) return "";
  if (fallbackShort.includes(".")) return fallbackShort;
  if (normalizedTemplate.includes(".")) return `${normalizedTemplate}.integration.localhost`;
  return fallbackShort;
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

  const defaultUserRequest = await createUserRequestContext(defaultUserHeaders);
  const otherUserRequest = await createUserRequestContext(otherUserHeaders);

  try {
    const sessionDefault = await requestSessionUser(defaultUserRequest);
    const sessionOther = await requestSessionUser(otherUserRequest);
    const defaultIdentity = String(sessionDefault.email || sessionDefault.user || "").trim().toLowerCase();
    const otherIdentity = String(sessionOther.email || sessionOther.user || "").trim().toLowerCase();
    expect(otherIdentity).toBeTruthy();
    expect(otherIdentity).not.toBe(defaultIdentity);

    const enrollResponse = await postForm(defaultUserRequest, "/create", createFields(flow.templateInstance, {
      enroll_request: "true",
      template_name: resolvedTemplateName,
      order_template: resolvedTemplateName,
    }));
    if (enrollResponse.status() === 409) {
      const enrollError = await enrollResponse.json();
      const existingTemplate = String(enrollError.existing_template || "").trim();
      if (!existingTemplate) {
        throw new Error(`enroll image create returned ${enrollResponse.status()} without existing_template: ${await enrollResponse.text()}`);
      }
      resolvedTemplateName = existingTemplate;
      resolvedTemplateInstanceName = await resolveTemplateInstanceContainer(defaultUserRequest, resolvedTemplateName);
    } else {
      await expectOk(enrollResponse, "enroll image create");
      await expect(await enrollResponse.json()).toMatchObject({ status: "finished" });
      resolvedTemplateInstanceName = flow.templateInstanceName;
    }

    const duplicateEnrollResponse = await postForm(defaultUserRequest, "/create", createFields(flow.duplicateTemplateInstance, {
      enroll_request: "true",
      template_name: resolvedTemplateName,
      order_template: resolvedTemplateName,
    }));
    expect(duplicateEnrollResponse.status()).toBe(409);
    expect(await duplicateEnrollResponse.json()).toMatchObject({
      code: "template_already_enrolled",
      existing_template: resolvedTemplateName,
    });

    const enrollLimit = await request.get("/enroll/limit", {
      params: { profile, owner_only: "false" },
      headers: defaultUserHeaders,
    });
    await expectOk(enrollLimit, "enroll limit");
    const enrollPayload = await enrollLimit.json();
    expect(enrollPayload.instances).toEqual(expect.arrayContaining([
      expect.objectContaining({
        instance: resolvedTemplateName,
        image: imageName,
        version: imageVersion,
        config_profile: profile,
        status: "ready",
      }),
    ]));

    const preOrderPayloadDefaultUser = await orderLimitPayload(defaultUserRequest, undefined, defaultUserHeaders);
    if (preOrderPayloadDefaultUser.instances?.length) {
      for (const item of preOrderPayloadDefaultUser.instances) {
        await deleteInstance(defaultUserRequest, item.instance, { headers: defaultUserHeaders });
        await expectNetBoxContainerListed(request, item.instance, false);
      }
    }

    const preOrderPayloadOtherUser = await orderLimitPayload(otherUserRequest, undefined, otherUserHeaders);
    if (preOrderPayloadOtherUser.instances?.length) {
      for (const item of preOrderPayloadOtherUser.instances) {
        await deleteInstance(otherUserRequest, item.instance, { headers: otherUserHeaders });
        await expectNetBoxContainerListed(request, item.instance, false);
      }
    }

    const orderResponse = await postForm(defaultUserRequest, "/create", createFields(flow.orderInstance, {
      order_request: "true",
      order_template: resolvedTemplateName,
      template_name: resolvedTemplateName,
    }));
    await expectOk(orderResponse, "order instance create");
    await expect(await orderResponse.json()).toMatchObject({ status: "finished" });

    const orderResponseOtherUser = await postForm(otherUserRequest, "/create", createFields(flow.orderInstanceOtherUser, {
      order_request: "true",
      order_template: resolvedTemplateName,
      template_name: resolvedTemplateName,
    }));
    await expectOk(orderResponseOtherUser, "order instance create (other user)");
    await expect(await orderResponseOtherUser.json()).toMatchObject({ status: "finished" });

    const orderResponseOtherUserSecond = await postForm(otherUserRequest, "/create", createFields(flow.orderInstanceOtherUser, {
      order_request: "true",
      order_template: resolvedTemplateName,
      template_name: resolvedTemplateName,
    }));
    expect(orderResponseOtherUserSecond.status()).toBe(429);
    await expect(await orderResponseOtherUserSecond.json()).toMatchObject({
      code: "max_instances_reached",
      max_instances: 1,
      used_instances: 1,
      requester_email: otherUserEmail,
    });

    await expectOrderInstanceListed(request, flow.orderInstanceName, true, {
      image: imageName,
      version: imageVersion,
    }, { headers: defaultUserHeaders });

    await expectOrderInstanceListed(request, flow.orderInstanceOtherUserName, true, {
      image: imageName,
      version: imageVersion,
    }, { headers: otherUserHeaders });

    await expectOrderInstanceListed(request, flow.orderInstanceOtherUserName, false);

  } finally {
    await defaultUserRequest.dispose();
    await otherUserRequest.dispose();
  }
});


test("shows both in the app", async ({ page }) => {
  await page.goto("/catalog");
  await expect(page.locator("#catalogList")).toContainText(resolvedTemplateName);
  await expect(page.locator("#catalogList")).toContainText(profile);

  await page.goto("/enroll");
  await expect(page.locator("#enrollInstances")).toBeVisible();
  await expect(page.locator("#enrollInstances")).toContainText(resolvedTemplateName);

  await page.goto(`/order?template=${encodeURIComponent(resolvedTemplateName)}`);
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

  resolvedTemplateInstanceName = await resolveTemplateInstanceContainer(request, resolvedTemplateName);
  if (resolvedTemplateInstanceName) {
    await expectNetBoxContainerListed(request, resolvedTemplateInstanceName, true);
    await deleteInstance(request, resolvedTemplateInstanceName);
    await expectNetBoxContainerListed(request, resolvedTemplateInstanceName, false);
  }
  const templateNames = (await netBoxTemplateNames(request)).map((name) => String(name || "").trim().toLowerCase());
  if (templateNames.includes(String(resolvedTemplateName || "").trim().toLowerCase())) {
    await expectNetBoxTemplateListed(request, resolvedTemplateName, true);
  }

  const preDeleteOtherPayload = await orderLimitPayload(request, undefined, otherUserHeaders);
  const otherOrderStillExists = (preDeleteOtherPayload.instances || []).some((item) => item.instance === flow.orderInstanceOtherUserName);
  if (otherOrderStillExists) {
    await expectNetBoxContainerListed(request, flow.orderInstanceOtherUserName, true);
    await deleteInstance(request, flow.orderInstanceOtherUserName, { headers: otherUserHeaders });
    await expectNetBoxContainerListed(request, flow.orderInstanceOtherUserName, false);
  }
  await expectOrderInstanceListed(request, flow.orderInstanceOtherUserName, false, {}, { headers: otherUserHeaders });

  if (templateNames.includes(String(resolvedTemplateName || "").trim().toLowerCase())) {
    await deleteTemplate(request, resolvedTemplateName);
    await expectNetBoxTemplateListed(request, resolvedTemplateName, false);
    await expectEnrollmentListed(request, resolvedTemplateName, false);
  } else {
    await expectEnrollmentListed(request, resolvedTemplateName, false);
  }
});
