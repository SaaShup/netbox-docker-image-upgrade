const { request: apiRequest, test, expect } = require("@playwright/test");
const crypto = require("crypto");
const dns = require("dns").promises;
const fs = require("fs");
const path = require("path");

const profile = process.env.INTEGRATION_PROFILE || "integration";
const netboxUrl = process.env.INTEGRATION_NETBOX_URL || "http://integration-paasbox:8000";
const netboxToken = process.env.INTEGRATION_NETBOX_TOKEN || "integration";
const paasboxUrl = process.env.INTEGRATION_PAASBOX_URL || "http://localhost:8001";
const integrationAppUrl = process.env.INTEGRATION_APP_URL || "http://127.0.0.1:3000";
const imageName = process.env.INTEGRATION_IMAGE || "saashup/curioo-tiles";
const imageVersion = process.env.INTEGRATION_IMAGE_VERSION || "v2.7.1";
const defaultWebhookImageVersion = imageName === "saashup/curioo-tiles" && imageVersion === "v2.7.1" ? "v2.8.0" : "";
const webhookImageVersion = String(process.env.INTEGRATION_WEBHOOK_IMAGE_VERSION || defaultWebhookImageVersion).trim();
const defaultImagePort = imageName === "saashup/curioo-tiles" ? "3000" : "80";
const imagePort = process.env.INTEGRATION_IMAGE_PORT || defaultImagePort;
const deleteDelayMs = Number.parseInt(process.env.INTEGRATION_DELETE_DELAY_MS || "10000", 10);
const containerVersionCheckDelayMs = 5_000;
const dnsDeleteCheckDelayMs = 5_000;
const containerVersionPath = "/api/version";
const integrationTraefikUrl = String(process.env.INTEGRATION_TRAEFIK_URL || `http://127.0.0.1:${process.env.INTEGRATION_TRAEFIK_PORT || "80"}`).replace(/\/+$/, "");
const integrationLogDriver = process.env.INTEGRATION_LOG_DRIVER || "syslog";
const integrationLogDriverOptions = {
  "syslog-address": process.env.INTEGRATION_SYSLOG_ADDRESS || "udp://127.0.0.1:5514",
  tag: process.env.INTEGRATION_SYSLOG_TAG || "{{.Name}}",
};
const smtpOutputDir = process.env.INTEGRATION_SMTP_OUTPUT_DIR || path.join(__dirname, "smtp-out");
const smtpMessagesFile = path.join(smtpOutputDir, "messages.jsonl");
const smtpLatestFile = path.join(smtpOutputDir, "latest.eml");
const integrationCloudflareZone = String(process.env.INTEGRATION_CLOUDFLARE_ZONE || "").trim().toLowerCase();
const integrationCloudflareZoneId = String(process.env.INTEGRATION_CLOUDFLARE_ZONE_ID || "").trim().toLowerCase();
const integrationCloudflareApiSecret = String(process.env.INTEGRATION_CLOUDFLARE_API_TOKEN || process.env.INTEGRATION_CLOUDFLARE_SECRET_KEY || "").trim();
const configuredIntegrationDomain = String(process.env.INTEGRATION_DOMAIN || "").trim().toLowerCase();
const integrationDomain = configuredIntegrationDomain || integrationCloudflareZone || "integration.localhost";
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const flow = {
  templateName: `it-template-${suffix}`,
  templateInstance: `it-enroll-${suffix}`,
  duplicateTemplateInstance: `it-enroll-dup-${suffix}`,
  orderInstance: `it-order-${suffix}`,
  orderInstanceOtherUser: `it-order-other-${suffix}`,
};
let resolvedTemplateName = flow.templateName;
let resolvedTemplateInstanceName = integrationInstanceName(flow.templateInstance);
flow.templateInstanceName = integrationInstanceName(flow.templateInstance);
flow.orderInstanceName = integrationInstanceName(flow.orderInstance);
flow.orderInstanceOtherUserName = integrationInstanceName(flow.orderInstanceOtherUser);
const defaultUserEmail = String(process.env.INTEGRATION_DEFAULT_USER || "admin@local.test").trim().toLowerCase();
const defaultUserHeaders = requestHeaders(defaultUserEmail);
const otherUserEmail = String(process.env.INTEGRATION_OTHER_USER || "demo@local.test").trim().toLowerCase();
const otherUserHeaders = requestHeaders(otherUserEmail);

test.skip(!netboxToken, "Set INTEGRATION_NETBOX_TOKEN to a Paasbox/NetBox API token before running integration tests.");
test.describe.configure({ mode: "serial" });

async function responseText(response) {
  return response.text().catch(() => "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function integrationInstanceName(name) {
  return `${name}.${integrationDomain}`;
}

function expectedContainerVersion(version) {
  return String(version || "").trim().replace(/^v/i, "");
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

test("create cloudflare in paasbox", async ({ request }) => {
  if (!integrationCloudflareZone || !integrationCloudflareZoneId || !integrationCloudflareApiSecret) {
    throw new Error("Set INTEGRATION_CLOUDFLARE_ZONE, INTEGRATION_CLOUDFLARE_ZONE_ID and INTEGRATION_CLOUDFLARE_API_TOKEN (or INTEGRATION_CLOUDFLARE_SECRET_KEY) before running the cloudflare provisioning test.");
  }
  const account = await ensureCloudflareAccountInPaasbox(request);
  expect(account).not.toBeNull();
  expect(account).toMatchObject({
    zone_name: integrationCloudflareZone,
    zone_id: integrationCloudflareZoneId,
  });
});

async function saveIntegrationConfig(request) {
  const profileConfig = {
    netbox: netboxUrl,
    token: netboxToken,
    tag: "integration",
    domain: integrationDomain,
    max_instances: 5,
    enrollment_limit: 5,
    owner_env_var: "SAASHUP_OWNER",
    cloudflare_filter: false,
    saashup_visible: true,
    smtp_config: "integration-smtp:587",
  };
  const response = await request.get("/webhook", {
    params: {
      profile,
      config_profile: profile,
      customer_name: "Integration",
      netbox: netboxUrl,
      token: netboxToken,
      tag: "integration",
      domain: integrationDomain,
      max_instances: "5",
      enrollment_limit: "5",
      owner_env_var: "SAASHUP_OWNER",
      cloudflare_filter: "false",
      smtp_config: "integration-smtp:587",
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
    instance: integrationInstanceName(name),
    image: imageName,
    network: "integration_default",
    version: imageVersion,
    port_value: imagePort,
    log_driver: integrationLogDriver,
    log_driver_options: JSON.stringify(integrationLogDriverOptions),
    max_instances: "1",
    traefik: "true",
    cloudflare_filter: "false",
    saashup_enabled: "true",
    ...extra,
  };
}

function firstMatchField(schema = {}, candidates = []) {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(schema, candidate)) return candidate;
  }
  return "";
}

function pickCloudflareField(schema, candidates) {
  return firstMatchField(schema || {}, candidates);
}

function buildCloudflareAccountPayload(zoneName, zoneId, secret) {
  const payload = {
    zone_name: zoneName,
    zone_id: zoneId,
  };
  if (secret) payload.token = secret;
  return payload;
}

function normalizeCloudflareAccount(payload) {
  if (!payload || typeof payload !== "object") return null;
  const normalizedZoneName = String(payload.zone_name || payload.name || "").trim();
  return {
    id: String(payload.id || "").trim(),
    zone_name: normalizedZoneName,
    name: String(payload.name || "").trim(),
    zone_id: String(payload.zone_id || "").trim().toLowerCase(),
    zone: String(payload.zone || "").trim().toLowerCase(),
  };
}

function cloudflareAccountMatch(item, zoneName, zoneId) {
  if (!item) return false;
  const normalizedZoneName = String(zoneName || "").trim().toLowerCase();
  const normalizedZoneId = String(zoneId || "").trim().toLowerCase();
  const name = String(item.zone_name || "").trim().toLowerCase();
  const itemZone = String(item.zone_id || item.zone || "").trim().toLowerCase();
  if (normalizedZoneId && itemZone === normalizedZoneId) return true;
  if (normalizedZoneName && name === normalizedZoneName) return true;
  return false;
}

async function listCloudflareAccounts(request, nameLike = "") {
  const endpoint = `${paasboxUrl}/api/plugins/cloudflare/dns/accounts/`;
  const response = await request.get(endpoint, {
    params: { zone_name: nameLike || integrationCloudflareZone, limit: 1000 },
  });
  await expectOk(response, "cloudflare account list");
  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}

async function tryCreateCloudflareAccount(request, postBody) {
  const endpoint = `${paasboxUrl}/api/plugins/cloudflare/dns/accounts/`;
  const createResponse = await request.post(endpoint, { data: postBody });
  if (createResponse.ok()) {
    return {
      ok: true,
      status: createResponse.status(),
      payload: await createResponse.json(),
    };
  }

  const createStatus = createResponse.status();
  const bodyText = await createResponse.text();
  if (createStatus === 400 || createStatus === 409) {
    return {
      ok: false,
      status: createStatus,
      bodyText,
    };
  }

  throw new Error(`cloudflare account create failed with HTTP ${createStatus}: ${bodyText}`);
}

function cloudflareCreatePayloadFromSchema(schema, fallbackZoneName, fallbackZoneId, fallbackSecret) {
  const zoneField = pickCloudflareField(schema || {}, ["zone_name", "name", "zone", "zone_name"]);
  const zoneIdField = pickCloudflareField(schema || {}, ["zone_id", "zone", "cloudflare_zone_id"]);
  const secretField = pickCloudflareField(schema || {}, ["token", "api_token", "access_token"]);

  const postBody = {};
  const resolvedZoneField = zoneField || "zone_name";
  const resolvedZoneIdField = zoneIdField || "zone_id";
  const resolvedSecretField = secretField || "token";

  postBody[resolvedZoneField] = fallbackZoneName;
  postBody[resolvedZoneIdField] = fallbackZoneId;
  postBody[resolvedSecretField] = fallbackSecret;
  return postBody;
}

async function ensureCloudflareAccountInPaasbox(request) {
  if (!integrationCloudflareZone || !integrationCloudflareZoneId || !integrationCloudflareApiSecret) return null;
  const endpoint = `${paasboxUrl}/api/plugins/cloudflare/dns/accounts/`;

  const existing = (await listCloudflareAccounts(request, integrationCloudflareZone))
    .find((item) => cloudflareAccountMatch(item, integrationCloudflareZone, integrationCloudflareZoneId));

  if (existing) {
    return normalizeCloudflareAccount(existing);
  }

  let postBody = buildCloudflareAccountPayload(
    integrationCloudflareZone,
    integrationCloudflareZoneId,
    integrationCloudflareApiSecret,
  );

  const optionsResponse = await request.fetch(endpoint, { method: "OPTIONS" });
  if (optionsResponse.ok()) {
    const optionsPayload = await optionsResponse.json();
    const postSchema = optionsPayload?.actions?.POST || {};
    postBody = cloudflareCreatePayloadFromSchema(
      postSchema,
      integrationCloudflareZone,
      integrationCloudflareZoneId,
      integrationCloudflareApiSecret,
    );
  }

  const createResult = await tryCreateCloudflareAccount(request, postBody);
  if (createResult.ok) {
    const created = normalizeCloudflareAccount(createResult.payload);
    expect([200, 201]).toContain(createResult.status);
    expect(created).toMatchObject({
      zone_name: integrationCloudflareZone,
    });
    return created;
  }

  // Keep idempotent behaviour when create is denied because account already exists.
  const reread = (await listCloudflareAccounts(request, integrationCloudflareZone))
    .find((item) => cloudflareAccountMatch(item, integrationCloudflareZone, integrationCloudflareZoneId));
  if (reread) {
    return normalizeCloudflareAccount(reread);
  }

  if (createResult.status === 400 || createResult.status === 409) {
    await expect.poll(async () => {
      const pollAccounts = await listCloudflareAccounts(request, integrationCloudflareZone);
      return pollAccounts.some((item) => cloudflareAccountMatch(item, integrationCloudflareZone, integrationCloudflareZoneId));
    }, {
      timeout: 10_000,
      intervals: [2_000],
      message: `cloudflare account ${integrationCloudflareZone} should be created in Paasbox`,
    }).toBe(true);
    const account = (await listCloudflareAccounts(request, integrationCloudflareZone))
      .find((item) => cloudflareAccountMatch(item, integrationCloudflareZone, integrationCloudflareZoneId));
    if (account) return normalizeCloudflareAccount(account);
  }

  throw new Error(`Failed to ensure Cloudflare account for zone ${integrationCloudflareZone}`);
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

function containerImageVersion(item) {
  return String(item?.image?.version || item?.image?.tag || item?.image_version || "").trim();
}

function logDriverOptionsMap(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return logDriverOptionsMap(JSON.parse(value));
    } catch {
      const [key, ...rest] = value.split("=");
      return key ? { [key]: rest.join("=") } : {};
    }
  }
  if (Array.isArray(value)) {
    return value.reduce((options, item) => ({ ...options, ...logDriverOptionsMap(item) }), {});
  }
  if (typeof value === "object") {
    if (value.option_name || value.name || value.key) {
      const key = value.option_name || value.name || value.key;
      const optionValue = value.value ?? value.option_value ?? "";
      return { [key]: String(optionValue) };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
  }
  return {};
}

function containerLogDriverOptions(item) {
  return logDriverOptionsMap(item?.log_driver_options || item?.log_options || item?.logging_options);
}

async function expectNetBoxContainerLogging(request, instance) {
  await expect.poll(async () => {
    const containers = await netBoxContainersByInstance(request, instance);
    return containers.map((item) => ({
      log_driver: String(item?.log_driver || "").trim(),
      log_driver_options: containerLogDriverOptions(item),
    }));
  }, {
    timeout: 45_000,
    intervals: [3_000],
    message: `Paasbox container ${instance} should have ${integrationLogDriver} logging configured`,
  }).toContainEqual(expect.objectContaining({
    log_driver: integrationLogDriver,
    log_driver_options: expect.objectContaining(integrationLogDriverOptions),
  }));
}

async function expectOrderedContainersLogging(request) {
  await expectNetBoxContainerLogging(request, flow.orderInstanceName);
  await expectNetBoxContainerLogging(request, flow.orderInstanceOtherUserName);
}

async function expectNetBoxContainerImageVersion(request, instance, version) {
  await expect.poll(async () => {
    const containers = await netBoxContainersByInstance(request, instance);
    return containers.map(containerImageVersion).filter(Boolean);
  }, {
    timeout: 60_000,
    intervals: [3_000],
    message: `Paasbox container ${instance} should use image version ${version}`,
  }).toContain(version);
}

async function expectOrderedContainersImageVersion(request, version) {
  await expectNetBoxContainerImageVersion(request, flow.orderInstanceName, version);
  await expectNetBoxContainerImageVersion(request, flow.orderInstanceOtherUserName, version);
}

async function dnsCnameRecords(instance) {
  try {
    return (await dns.resolveCname(instance)).map(normalizeDnsName);
  } catch (error) {
    return [];
  }
}

async function dnsAddressRecords(instance) {
  try {
    const [ipv4, ipv6] = await Promise.all([
      dns.resolve4(instance).catch(() => []),
      dns.resolve6(instance).catch(() => []),
    ]);
    return [...ipv4, ...ipv6].map((item) => String(item || "").trim()).filter(Boolean);
  } catch (error) {
    return [];
  }
}

async function dnsRecords(instance) {
  const [cnames, addresses] = await Promise.all([
    dnsCnameRecords(instance),
    dnsAddressRecords(instance),
  ]);
  return { cnames, addresses };
}

function normalizeDnsName(name) {
  return String(name || "").trim().toLowerCase().replace(/\.+$/, "");
}

async function expectDnsRecordPresent(instance) {
  const expectedTarget = normalizeDnsName(`integration-agent.${integrationDomain}`);
  await expect.poll(async () => {
    const records = await dnsRecords(instance);
    return records.cnames.includes(expectedTarget) || records.addresses.length > 0;
  }, {
    timeout: 60_000,
    intervals: [3_000],
    message: `${instance} should resolve through Cloudflare DNS`,
  }).toBe(true);
}

async function cloudflareDnsRecordsByName(request, instance) {
  const response = await request.get(`${paasboxUrl}/api/plugins/cloudflare/dns/records/`, {
    params: { name: instance, limit: 1000 },
  });
  await expectOk(response, `lookup Cloudflare DNS record ${instance}`);
  const payload = await response.json();
  const records = Array.isArray(payload?.results) ? payload.results : [];
  const expectedName = normalizeDnsName(instance);
  return records.filter((item) => {
    const names = [item?.name, item?.display, item?.dns_name]
      .filter(Boolean)
      .map(normalizeDnsName);
    return names.includes(expectedName);
  });
}

async function expectCloudflareDnsRecordRemoved(request, instance) {
  await expect.poll(async () => (await cloudflareDnsRecordsByName(request, instance)).length, {
    timeout: 60_000,
    intervals: [3_000],
    message: `${instance} Cloudflare DNS record should be removed from Paasbox`,
  }).toBe(0);
}

async function expectOrderedDnsRecordsPresent() {
  await expectDnsRecordPresent(flow.orderInstanceName);
  await expectDnsRecordPresent(flow.orderInstanceOtherUserName);
}

async function expectOrderedDnsRecordsRemoved(request) {
  await expectCloudflareDnsRecordRemoved(request, flow.orderInstanceName);
  await expectCloudflareDnsRecordRemoved(request, flow.orderInstanceOtherUserName);
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
  if (normalizedTemplate.includes(".")) return integrationInstanceName(normalizedTemplate);
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

async function expectContainerVersion(instance, version) {
  const context = await apiRequest.newContext({
    baseURL: integrationTraefikUrl,
    extraHTTPHeaders: { Host: instance },
  });
  const expectedVersion = expectedContainerVersion(version);
  try {
    await expect.poll(async () => {
      const response = await context.get(containerVersionPath);
      const body = await responseText(response);
      if (!response.ok()) {
        return { ok: false, status: response.status(), version: "", body };
      }
      try {
        const payload = JSON.parse(body);
        return {
          ok: true,
          status: response.status(),
          version: String(payload?.version || ""),
          body,
        };
      } catch {
        return { ok: false, status: response.status(), version: "", body };
      }
    }, {
      timeout: 30_000,
      intervals: [5_000],
      message: `${instance}${containerVersionPath} through ${integrationTraefikUrl} should report ${expectedVersion}`,
    }).toMatchObject({
      ok: true,
      version: expectedVersion,
    });
  } finally {
    await context.dispose();
  }
}

async function expectOrderedContainersVersion(version) {
  await expectContainerVersion(flow.orderInstanceName, version);
  await expectContainerVersion(flow.orderInstanceOtherUserName, version);
}

function clearSmtpMessages() {
  fs.rmSync(smtpMessagesFile, { force: true });
  fs.rmSync(smtpLatestFile, { force: true });
}

function smtpMessages() {
  if (!fs.existsSync(smtpMessagesFile)) return [];
  return fs.readFileSync(smtpMessagesFile, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function smtpMessageMatches(message, recipient, instance = "") {
  const recipients = Array.isArray(message.recipients) ? message.recipients.join(" ").toLowerCase() : "";
  const data = String(message.data || "").toLowerCase();
  return fs.existsSync(smtpLatestFile)
    && recipients.includes(String(recipient || "").toLowerCase())
    && (!instance || data.includes(String(instance).toLowerCase()))
    && data.includes("is ready")
    && data.includes(imageName.toLowerCase());
}

function smtpUpgradeMessageMatches(message, recipient) {
  const recipients = Array.isArray(message.recipients) ? message.recipients.join(" ").toLowerCase() : "";
  const data = String(message.data || "").toLowerCase();
  return fs.existsSync(smtpLatestFile)
    && recipients.includes(String(recipient || "").toLowerCase())
    && data.includes("your image has now been upgraded")
    && data.includes(`from image: ${imageName.toLowerCase()}:${imageVersion.toLowerCase()}`)
    && data.includes(`to image: ${imageName.toLowerCase()}:${webhookImageVersion.toLowerCase()}`);
}

test("enrolls an image, creates an instance from it", async ({ request }) => {
  test.slow();
  clearSmtpMessages();
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

    clearSmtpMessages();

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

    await expect.poll(() => {
      const messages = smtpMessages();
      return [
        messages.some((message) => smtpMessageMatches(message, defaultUserEmail, flow.orderInstanceName)),
        messages.some((message) => smtpMessageMatches(message, otherUserEmail, flow.orderInstanceOtherUserName)),
      ];
    }, {
      timeout: 45_000,
      intervals: [2_000],
      message: "SMTP sink should receive both order ready emails",
    }).toEqual([true, true]);

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

test("ordered containers report the initial image version", async ({ request }) => {
  await delay(containerVersionCheckDelayMs);
  await expectOrderedDnsRecordsPresent();
  await expectOrderedContainersLogging(request);
  await expectOrderedContainersVersion(imageVersion);
});

test("registry webhook updates enrolled image and writes ready email to SMTP sink", async ({ request }) => {
  test.skip(!webhookImageVersion || webhookImageVersion === imageVersion, "Set INTEGRATION_WEBHOOK_IMAGE_VERSION to a different pullable tag for INTEGRATION_IMAGE.");
  const upgradeMessageCountBeforeWebhook = smtpMessages()
    .filter((message) => String(message.data || "").toLowerCase().includes("your image has now been upgraded"))
    .length;

  await delay(containerVersionCheckDelayMs);

  const response = await request.post(`/registry-webhook/${encodeURIComponent(profile)}/secret`, {
    data: {
      push_data: { tag: webhookImageVersion },
      repository: { repo_name: imageName },
    },
  });
  await expectOk(response, "registry webhook");

  await expect.poll(() => smtpMessages()
    .filter((message) => smtpUpgradeMessageMatches(message, defaultUserEmail))
    .length, {
    timeout: 120_000,
    intervals: [3_000],
    message: "SMTP sink should receive the webhook image upgrade email",
  }).toBeGreaterThan(0);

  await expect.poll(() => smtpMessages()
    .filter((message) => String(message.data || "").toLowerCase().includes("your image has now been upgraded"))
    .length, {
    timeout: 120_000,
    intervals: [3_000],
    message: "SMTP sink should receive one additional image upgrade email from the webhook",
  }).toBeGreaterThan(upgradeMessageCountBeforeWebhook);
});

test("ordered containers report the upgraded image version", async ({ request }) => {
  test.skip(!webhookImageVersion || webhookImageVersion === imageVersion, "Set INTEGRATION_WEBHOOK_IMAGE_VERSION to a different pullable tag for INTEGRATION_IMAGE.");
  await delay(containerVersionCheckDelayMs);
  await expectOrderedContainersImageVersion(request, webhookImageVersion);
  await expectOrderedContainersVersion(webhookImageVersion);
});

test("deletes them", async ({ request }) => {
  test.slow();

  if (deleteDelayMs > 0) await delay(deleteDelayMs);

  await expectNetBoxContainerListed(request, flow.orderInstanceName, true);
  await deleteInstance(request, flow.orderInstanceName);
  await expectNetBoxContainerListed(request, flow.orderInstanceName, false);
  await expectOrderInstanceListed(request, flow.orderInstanceName, false);
  await expectNetBoxContainerListed(request, flow.orderInstanceOtherUserName, true);
  await deleteInstance(request, flow.orderInstanceOtherUserName, { headers: otherUserHeaders });
  await expectNetBoxContainerListed(request, flow.orderInstanceOtherUserName, false);
  await expectOrderInstanceListed(request, flow.orderInstanceOtherUserName, false, {}, { headers: otherUserHeaders });

  await delay(dnsDeleteCheckDelayMs);
  await expectOrderedDnsRecordsRemoved(request);

  await deleteTemplate(request, resolvedTemplateName);
  await expectNetBoxTemplateListed(request, resolvedTemplateName, false);
  await expectEnrollmentListed(request, resolvedTemplateName, false);
});
