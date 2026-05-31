const path = require("path");
const crypto = require("crypto");
const express = require("express");
const packageJson = require("./package.json");
const { authUserFromRequest, createAuthHelpers, maxInstancesValue } = require("./lib/auth");
const {
  asArray,
  containerConfigPayloadFromForm,
  containerCreatePayloadFromForm,
  containerNetworkNames,
  formData,
  hostMatchesTag,
  hostName,
  imageNameFromRef,
  instanceShort,
  instanceZone,
  ownerEnvVarName,
  isContainerRunning,
  isContainerStopped,
  isOperationDone,
  isReadyContainer,
  valueText,
  volumePayloadsFromForm,
} = require("./lib/docker");
const { createMetrics, metricLabel, metricLine, operationLabel: operationLabelForMetrics, routeLabel: routeLabelForMetrics, statusClass } = require("./lib/metrics");
const { NetBoxClient, dockerHosts, hostIdQuery, setNetBoxFetchForTests } = require("./lib/netbox");
const { createOidcAuth, setOidcFetchForTests } = require("./lib/oidc");
const { createOperationHelpers, delay } = require("./lib/operations");
const { createStateStore, parseProfiles, plainObject } = require("./lib/state");

const app = express();
const dataPath = path.resolve(process.env.DATAPATH || path.join(__dirname, "data"));
const appPath = path.resolve(process.env.APPPATH || __dirname);
const publicPath = path.join(appPath, "public");
const startedAt = Date.now();
const operationTimeoutSeconds = Number(process.env.OPERATION_TIMEOUT_SECONDS || 30);
const operationPollMs = Number(process.env.OPERATION_POLL_MS || 3000);
const createConfigureDelayMs = Number(process.env.CREATE_CONFIGURE_DELAY_MS || 5000);
const createRecreateDelayMs = Number(process.env.CREATE_RECREATE_DELAY_MS || 5000);
const dockerhubWebhookSecret = String(process.env.DOCKERHUB_WEBHOOK_SECRET || "");
const adminAllowedEmails = String(process.env.ADMIN_ALLOWED_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const oidcAuth = createOidcAuth({
  clientId: process.env.OIDC_CLIENT_ID || process.env.SAASHUP_OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET || process.env.SAASHUP_OIDC_CLIENT_SECRET,
  enabled: process.env.OIDC_ENABLED !== "false",
  issuerUrl: process.env.OIDC_ISSUER_URL || process.env.KEYCLOAK_ISSUER_URL,
  redirectUri: process.env.OIDC_REDIRECT_URI,
  sessionSecret: process.env.SESSION_SECRET || process.env.SAASHUP_SESSION_SECRET,
});

const metrics = createMetrics();
const { readState, writeState, logLine } = createStateStore(dataPath);
const { isAdminAllowed, selectedProfileConfig, userOrderKey } = createAuthHelpers({ adminAllowedEmails, readState });
const {
  createDnsRecord,
  deleteDnsRecord,
  ensureImageOnHost,
  requestContainerOperation,
  waitForContainerConfigured,
  waitForContainerStopped,
  waitForHostReady,
} = createOperationHelpers({ logLine, operationPollMs, operationTimeoutSeconds });

function routeLabel(req) {
  return routeLabelForMetrics(req, metrics);
}

function operationLabel(req) {
  return operationLabelForMetrics(req, metrics);
}

function sendAccepted(res, body = { status: "requested" }) {
  res.status(202).json(body);
}

function asyncOperation(res, fn) {
  sendAccepted(res);
  fn().catch((error) => {
    logLine(`ERROR : ${error.message || "operation failed"} payload=${JSON.stringify(error.payload || {}).slice(0, 240)}`);
  });
}

function currentUsage(req, profile) {
  const state = readState();
  const counts = plainObject(state.order_counts);
  const instances = plainObject(state.order_instances);
  const userKey = userOrderKey(req);
  const emailKey = String(authUserFromRequest(req).email || "").trim().toLowerCase();
  const used = Number(counts[userKey]?.[profile] || 0);
  const config = selectedProfileConfig({ profile, config_profile: profile });
  const max = maxInstancesValue(config.max_instances);
  const userInstances = emailKey && Array.isArray(instances[emailKey]?.[profile]) ? instances[emailKey][profile] : [];
  return { profile, used, max, remaining: Math.max(0, max - used), reached: used >= max, instances: userInstances };
}

function recordOrderInstance(req, profile, data) {
  writeState((state) => {
    const userKey = userOrderKey(req);
    const emailKey = String(authUserFromRequest(req).email || "").trim().toLowerCase();
    state.order_counts = plainObject(state.order_counts);
    if (!state.order_counts[userKey]) state.order_counts[userKey] = {};
    state.order_counts[userKey][profile] = Number(state.order_counts[userKey][profile] || 0) + 1;

    if (emailKey) {
      state.order_instances = plainObject(state.order_instances);
      if (!state.order_instances[emailKey]) state.order_instances[emailKey] = {};
      const instances = Array.isArray(state.order_instances[emailKey][profile]) ? state.order_instances[emailKey][profile] : [];
      instances.push({
        instance: data.instance || "",
        template: data.order_template || "",
        image: data.image || "",
        version: data.version || "",
        created_at: new Date().toISOString(),
      });
      state.order_instances[emailKey][profile] = instances;
    }
    return state;
  });
}

function removeOrderInstance(req, profile, instance) {
  writeState((state) => {
    const userKey = userOrderKey(req);
    const emailKey = String(authUserFromRequest(req).email || "").trim().toLowerCase();
    state.order_counts = plainObject(state.order_counts);
    if (state.order_counts[userKey]) {
      state.order_counts[userKey][profile] = Math.max(0, Number(state.order_counts[userKey][profile] || 0) - 1);
    }
    if (emailKey) {
      state.order_instances = plainObject(state.order_instances);
      const instances = Array.isArray(state.order_instances[emailKey]?.[profile]) ? state.order_instances[emailKey][profile] : [];
      if (state.order_instances[emailKey]) {
        state.order_instances[emailKey][profile] = instances.filter((item) => item.instance !== instance);
      }
    }
    return state;
  });
}

function requireAdmin(req, res, next) {
  const user = authUserFromRequest(req);
  if (oidcAuth.enabled && !user.email && !user.user && !user.name) return oidcAuth.loginRequired(req, res, next);
  if (isAdminAllowed(req)) return next();
  metrics.adminForbidden += 1;
  res.status(403).sendFile(path.join(publicPath, "forbidden.html"));
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function dockerhubWebhookAllowed(req) {
  if (!dockerhubWebhookSecret) return true;
  const provided = req.params.secret || req.query.secret || req.get("x-saashup-webhook-secret") || "";
  return timingSafeStringEqual(provided, dockerhubWebhookSecret);
}

app.disable("x-powered-by");
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const label = routeLabel(req);
  metrics.httpRequests[label] = (metrics.httpRequests[label] || 0) + 1;
  const operation = operationLabel(req);
  if (operation) {
    res.once("finish", () => {
      const bucket = statusClass(res.statusCode);
      metrics.operationRequests[operation][bucket] = (metrics.operationRequests[operation][bucket] || 0) + 1;
    });
  }
  next();
});

app.post(["/dockerhub/:profile", "/dockerhub/:profile/:secret"], (req, res) => {
  if (!dockerhubWebhookAllowed(req)) return res.status(403).json({ detail: "invalid webhook secret" });
  res.status(202).json({ status: "accepted" });
  const tag = req.body?.push_data?.tag;
  if (!tag || tag === "latest") return;
  const image = req.body?.repository?.repo_name;
  const config = selectedProfileConfig({ profile: req.params.profile });
  const body = { ...config, image, version: tag, clean_name: false };
  Promise.resolve()
    .then(() => recreateContainers(body))
    .catch((error) => logLine(`DOCKERHUB : failed ${error.message}`));
});

app.use(oidcAuth.attachUser);

app.get("/session/user", (req, res) => res.json(authUserFromRequest(req)));
app.get("/login", (req, res, next) => Promise.resolve(oidcAuth.login(req, res)).catch(next));
app.get("/oidc/callback", oidcAuth.callback);
app.get("/logout", oidcAuth.logout);
app.get("/version", (req, res) => res.json({ name: packageJson.name, version: packageJson.version }));
app.get("/metrics", (req, res) => {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const lines = [
    "# HELP saashup_app_info Application build information.",
    "# TYPE saashup_app_info gauge",
    metricLine("saashup_app_info", 1, { name: packageJson.name, version: packageJson.version, node_version: process.version }),
    "# HELP saashup_process_start_time_seconds Unix start time of this process.",
    "# TYPE saashup_process_start_time_seconds gauge",
    metricLine("saashup_process_start_time_seconds", Math.floor(startedAt / 1000)),
    "# HELP saashup_process_uptime_seconds Process uptime in seconds.",
    "# TYPE saashup_process_uptime_seconds gauge",
    metricLine("saashup_process_uptime_seconds", process.uptime().toFixed(3)),
    "# HELP saashup_process_memory_bytes Process memory usage by type.",
    "# TYPE saashup_process_memory_bytes gauge",
    ...Object.entries(memory).map(([type, value]) => metricLine("saashup_process_memory_bytes", value, { type })),
    "# HELP saashup_process_cpu_seconds_total Process CPU time in seconds.",
    "# TYPE saashup_process_cpu_seconds_total counter",
    metricLine("saashup_process_cpu_seconds_total", (cpu.user / 1e6).toFixed(6), { mode: "user" }),
    metricLine("saashup_process_cpu_seconds_total", (cpu.system / 1e6).toFixed(6), { mode: "system" }),
    "# HELP saashup_admin_forbidden_total Total denied admin requests.",
    "# TYPE saashup_admin_forbidden_total counter",
    metricLine("saashup_admin_forbidden_total", metrics.adminForbidden),
    "# HELP saashup_http_requests_total Total HTTP requests.",
    "# TYPE saashup_http_requests_total counter",
    ...Object.entries(metrics.httpRequests).map(([route, value]) => metricLine("saashup_http_requests_total", value, { route })),
    "# HELP saashup_operation_requests_total Total operation requests by operation and response status class.",
    "# TYPE saashup_operation_requests_total counter",
    ...Object.entries(metrics.operationRequests).flatMap(([operation, values]) => Object.entries(values).map(([status_class, value]) => metricLine("saashup_operation_requests_total", value, { operation, status_class }))),
    "",
  ];
  res.type("text/plain; version=0.0.4").send(lines.join("\n"));
});

app.get("/admin", oidcAuth.loginRequired, requireAdmin, (req, res) => res.sendFile(path.join(publicPath, "admin.html")));
app.get("/admin.html", oidcAuth.loginRequired, requireAdmin, (req, res) => res.sendFile(path.join(publicPath, "admin.html")));
app.get("/order", oidcAuth.loginRequired, (req, res) => res.sendFile(path.join(publicPath, "order.html")));
app.use(express.static(publicPath));

app.get("/config", (req, res) => res.json(readState().config || {}));
app.get("/dockerhub-webhook-secret", requireAdmin, (req, res) => res.json({ secret: dockerhubWebhookSecret }));
app.delete("/config", requireAdmin, (req, res) => {
  writeState((state) => {
    state.config = {};
    return state;
  });
  res.json({});
});
app.get("/webhook", requireAdmin, (req, res) => {
  const profiles = parseProfiles(req.query.profiles);
  const config = {
    customer_name: req.query.customer_name || "",
    netbox: req.query.netbox || "",
    token: req.query.token || "",
    proxy: req.query.proxy || "",
    domain: req.query.domain || "",
    tag: req.query.tag || "",
    max_instances: maxInstancesValue(req.query.max_instances),
    owner_env_var: String(req.query.owner_env_var || "SAASHUP_OWNER").trim() || "SAASHUP_OWNER",
    cloudflare_filter: req.query.cloudflare_filter !== "false",
    profile: req.query.profile || req.query.config_profile || "",
    config_profile: req.query.config_profile || req.query.profile || "",
    profiles: JSON.stringify(profiles),
  };
  writeState((state) => {
    state.config = config;
    return state;
  });
  res.json(config);
});

app.get("/templates", (req, res) => res.json(readState().templates || {}));
app.post("/templates", requireAdmin, (req, res) => {
  const templates = plainObject(req.body);
  writeState((state) => {
    state.templates = templates;
    return state;
  });
  res.json(templates);
});

app.get("/portable-config", requireAdmin, (req, res) => {
  const state = readState();
  const config = plainObject(state.config);
  const payload = {
    type: "saashup-config-export",
    version: 1,
    app_version: packageJson.version,
    exported_at: new Date().toISOString(),
    config: { ...config, profiles: parseProfiles(config.profiles) },
    templates: plainObject(state.templates),
    order_counts: plainObject(state.order_counts),
    order_instances: plainObject(state.order_instances),
  };
  res.attachment(`saashup-config-${new Date().toISOString().slice(0, 10)}.json`).json(payload);
});
app.post("/portable-config", requireAdmin, (req, res) => {
  const payload = plainObject(req.body);
  const config = plainObject(payload.config);
  const profiles = parseProfiles(payload.profiles || config.profiles);
  const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
  if (names.length) {
    config.profiles = JSON.stringify(profiles);
    if (!config.profile || !profiles[config.profile]) config.profile = names[0];
    if (!config.config_profile || !profiles[config.config_profile]) config.config_profile = config.profile;
  }
  writeState((state) => {
    state.config = config;
    state.templates = plainObject(payload.templates);
    state.order_counts = plainObject(payload.order_counts);
    state.order_instances = plainObject(payload.order_instances);
    return state;
  });
  res.json({ status: "imported", profiles: names.length, templates: Object.keys(plainObject(payload.templates)).length });
});

app.get("/logs", (req, res) => res.type("text/html").send(readState().logs || "&nbsp;<br>"));
app.delete("/logs", requireAdmin, (req, res) => {
  writeState((state) => {
    state.logs = "";
    return state;
  });
  res.json({ status: "cleared" });
});

async function testConnection(req, res) {
  try {
    const client = new NetBoxClient(selectedProfileConfig(formData(req)));
    const { payload } = await client.request("GET", "/api/status/", { expected: [200] });
    res.json(payload);
  } catch (error) {
    res.status(error.statusCode || 502).json({ detail: error.message, payload: error.payload });
  }
}

app.get("/test", requireAdmin, testConnection);
app.post("/test", requireAdmin, testConnection);

app.get("/instances", async (req, res) => {
  try {
    const config = selectedProfileConfig(req.query);
    const client = new NetBoxClient(config);
    const hostFilter = await hostIdQuery(client, req.query.tag || config.tag);
    if (hostFilter.host_id === "__none__") return res.json([]);
    const containers = await client.list("/api/plugins/docker/containers/", { limit: 1000, ...hostFilter });
    res.json(containers.map((item) => ({ ...item, instance: item.display || item.name, networks: containerNetworkNames(item) })));
  } catch (error) {
    res.status(error.statusCode || 502).json({ detail: error.message });
  }
});

app.get("/images", async (req, res) => {
  try {
    const config = selectedProfileConfig(req.query);
    const client = new NetBoxClient(config);
    const hostFilter = await hostIdQuery(client, req.query.tag || config.tag);
    if (hostFilter.host_id === "__none__") return res.json([]);
    const images = await client.list("/api/plugins/docker/images/", { limit: 1000, ...hostFilter });
    res.json(images);
  } catch (error) {
    res.status(error.statusCode || 502).json({ detail: error.message });
  }
});

app.get("/containers-count", async (req, res) => {
  try {
    const config = selectedProfileConfig(req.query);
    const client = new NetBoxClient(config);
    const hostFilter = await hostIdQuery(client, req.query.tag || config.tag);
    if (hostFilter.host_id === "__none__") return res.json({ count: 0 });
    const images = await client.list("/api/plugins/docker/images/", { limit: 1000, name: req.query.image, version: req.query.version, ...hostFilter });
    if (!images.length) return res.json({ count: 0 });
    const containers = await client.list("/api/plugins/docker/containers/", { limit: 1, image_id: images.map((image) => image.id) });
    res.json({ count: containers.length });
  } catch (error) {
    res.status(error.statusCode || 502).json({ detail: error.message });
  }
});

function reportProfiles(source) {
  const state = readState();
  const config = plainObject(state.config);
  const profiles = parseProfiles(config.profiles);
  const requested = source.profile || source.config_profile || "";
  const profileConfig = (name) => ({
    ...config,
    ...plainObject(profiles[name]),
    ...plainObject(source),
    profile: name,
    config_profile: name,
  });

  if (requested && requested !== "all") {
    return [{ name: requested, config: profileConfig(requested) }];
  }

  const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
  if (requested === "all" && names.length) {
    return names.map((name) => ({ name, config: profileConfig(name) }));
  }

  const selected = config.profile || config.config_profile || names[0] || "";
  if (selected) {
    return [{ name: selected, config: profileConfig(selected) }];
  }

  return [{ name: "", config: selectedProfileConfig(source) }];
}

function reportUserCount(profile, profiles) {
  const counts = plainObject(readState().order_counts);
  const profileNames = profile === "all" ? profiles.map((item) => item.name).filter(Boolean) : [profile || ""];
  const includeAllProfiles = profile === "all" && !profileNames.length;
  return Object.values(counts).filter((userCounts) => {
    const userProfileCounts = plainObject(userCounts);
    if (includeAllProfiles) return Object.values(userProfileCounts).some((count) => Number(count || 0) > 0);
    return profileNames.some((name) => Number(userProfileCounts[name] || 0) > 0);
  }).length;
}

function containerEnvValue(container, name) {
  const entries = [
    ...(Array.isArray(container?.env) ? container.env : []),
    ...(Array.isArray(container?.env_vars) ? container.env_vars : []),
    ...(Array.isArray(container?.environment) ? container.environment : []),
  ];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const key = valueText(entry.var_name || entry.name || entry.key);
    if (key === name) return valueText(entry.value);
  }

  return "";
}

async function imageReportForProfile(name, config) {
  const label = name || "default";
  if (!config.netbox || !config.token) {
    logLine(`REPORT_IMAGE : ${label} skipped missing NetBox config`);
    return { hosts: 0, rows: [] };
  }

  const client = new NetBoxClient(config);
  const hosts = await dockerHosts(client, config.tag);
  if (!hosts.length) {
    logLine(`REPORT_IMAGE : ${label} no Docker hosts found${config.tag ? ` with tag ${config.tag}` : ""}`);
    return { hosts: 0, rows: [] };
  }

  logLine(`REPORT_IMAGE : ${label} scanning ${hosts.length} host${hosts.length === 1 ? "" : "s"}${config.tag ? ` tag=${config.tag}` : ""}`);
  const images = await client.list("/api/plugins/docker/images/", { limit: 1000, host_id: hosts.map((host) => host.id) });
  logLine(`REPORT_IMAGE : ${label} found ${images.length} image record${images.length === 1 ? "" : "s"}`);
  const groups = new Map();
  const ownerEnvName = ownerEnvVarName(config);
  const owners = new Set();

  for (const image of images) {
    const imageName = imageNameFromRef(image.name || image.display || "");
    const version = valueText(image.version || image.tag);
    if (!imageName || !version || !image.id) continue;

    const key = `${imageName}\u0000${version}`;
    if (!groups.has(key)) {
      groups.set(key, {
        profile: name,
        image: imageName,
        version,
        image_ids: [],
        containers: 0,
      });
    }
    groups.get(key).image_ids.push(image.id);
  }

  for (const row of groups.values()) {
    const containers = await client.list("/api/plugins/docker/containers/", { limit: 1000, image_id: row.image_ids });
    row.containers = containers.length;
    containers
      .map((container) => containerEnvValue(container, ownerEnvName))
      .filter(Boolean)
      .forEach((owner) => owners.add(owner));
    logLine(`REPORT_IMAGE : ${label} ${row.image}:${row.version} containers=${row.containers}`);
  }

  const rows = Array.from(groups.values())
    .map(({ image_ids, ...row }) => row)
    .sort((left, right) => left.profile.localeCompare(right.profile) || left.image.localeCompare(right.image) || left.version.localeCompare(right.version, undefined, { numeric: true, sensitivity: "base" }));

  logLine(`REPORT_IMAGE : ${label} found ${owners.size} owner${owners.size === 1 ? "" : "s"} from ${ownerEnvName}`);
  return { hosts: hosts.length, rows, owners: [...owners] };
}

app.get("/report/images", requireAdmin, async (req, res) => {
  try {
    const profiles = reportProfiles(req.query);
    const requestedProfile = req.query.profile || req.query.config_profile || "";
    logLine(`REPORT_IMAGE : starting profile=${requestedProfile || "selected"} profiles=${profiles.map((item) => item.name || "default").join(",") || "default"}`);
    const results = [];
    const owners = new Set();
    let totalHosts = 0;

    for (const item of profiles) {
      const report = await imageReportForProfile(item.name, item.config);
      totalHosts += report.hosts;
      results.push(...report.rows);
      (report.owners || []).forEach((owner) => owners.add(owner));
    }

    const payload = {
      profile: requestedProfile,
      rows: results,
      total_hosts: totalHosts,
      total_images: results.length,
      total_containers: results.reduce((total, row) => total + Number(row.containers || 0), 0),
      total_users: owners.size || reportUserCount(requestedProfile, profiles),
    };
    logLine(`REPORT_IMAGE : finished profile=${requestedProfile || "selected"} hosts=${payload.total_hosts} images=${payload.total_images} containers=${payload.total_containers} users=${payload.total_users}`);
    res.json(payload);
  } catch (error) {
    logLine(`REPORT_IMAGE : failed ${error.message || "report error"}`);
    res.status(error.statusCode || 502).json({ detail: error.message, payload: error.payload });
  }
});

app.get("/order/limit", (req, res) => res.json(currentUsage(req, req.query.profile || "")));

app.post("/create", async (req, res) => {
  const data = { ...selectedProfileConfig(req.body), ...req.body };
  data.saashup_owner = authUserFromRequest(req).email || "";
  const orderProfile = data.profile || data.config_profile || "";
  const usage = currentUsage(req, orderProfile);
  const isOrderRequest = req.body.order_request === "true";
  if (isOrderRequest && usage.reached) {
    return res.status(429).json({ code: "max_instances_reached", detail: `You have reached your maximum of ${usage.max} instance${usage.max === 1 ? "" : "s"} for this config.`, max_instances: usage.max, used_instances: usage.used });
  }
  if (isOrderRequest) recordOrderInstance(req, orderProfile, data);
  asyncOperation(res, async () => {
    const client = new NetBoxClient(data);
    const hosts = await dockerHosts(client, data.tag);
    if (!hosts.length) return logLine(`CREATE : no Docker hosts found${data.tag ? ` with tag ${data.tag}` : ""}`);
    const containers = await client.list("/api/plugins/docker/containers/", { limit: 1000, host_id: hosts.map((host) => host.id) });
    const selectedHost = hosts.map((host) => ({ host, count: containers.filter((c) => (c.host?.id || c.host) === host.id).length })).sort((a, b) => a.count - b.count)[0].host;
    data.host_id = selectedHost.id;
    const images = await client.list("/api/plugins/docker/images/", { name: data.image, version: data.version, host_id: data.host_id });
    if (!images[0]) return logLine(`CREATE : image ${data.image}:${data.version} not found on ${hostName(selectedHost)}`);
    await createDnsRecord(client, data, selectedHost);
    const volumes = volumePayloadsFromForm(data);
    if (volumes.length) {
      await client.request("POST", "/api/plugins/docker/volumes/", { body: volumes.length === 1 ? volumes[0] : volumes, expected: [200, 201, 202] });
      logLine(`CREATE : ${volumes.length} volume${volumes.length === 1 ? "" : "s"} prepared on ${hostName(selectedHost)}`);
    }
    const containerPayload = containerCreatePayloadFromForm(data, images[0].id);
    const { payload } = await client.request("POST", "/api/plugins/docker/containers/", { body: containerPayload, expected: [200, 201, 202] });
    const container = Array.isArray(payload) ? payload[0] : payload;
    logLine(`CREATE : container ${containerPayload.name} created on ${hostName(selectedHost)}`);
    if (createConfigureDelayMs > 0) await delay(createConfigureDelayMs);
    const containerConfig = containerConfigPayloadFromForm(data, container.id);
    await client.request("PATCH", "/api/plugins/docker/containers/", { body: [containerConfig] });
    logLine(`CREATE : container ${containerPayload.name} configured on ${hostName(selectedHost)} env=${containerConfig.env.length} labels=${containerConfig.labels.length} mounts=${containerConfig.mounts.length}`);
    if (createRecreateDelayMs > 0) await delay(createRecreateDelayMs);
    await waitForContainerConfigured(client, container.id, `${hostName(container)}/${valueText(container.display || container.name)}`);
    await requestContainerOperation(client, container, "recreate", "CREATE");
  });
});

async function recreateContainers(data) {
  const client = new NetBoxClient(data);
  const hostFilter = await hostIdQuery(client, data.tag);
  if (hostFilter.host_id === "__none__") return logLine(`RECREATE : no Docker hosts found with tag ${data.tag}`);
  const query = { name: data.image, limit: 200, ...hostFilter };
  if (data.oldversion) query.version = data.oldversion;
  const oldImages = (await client.list("/api/plugins/docker/images/", query)).filter((image) => data.oldversion ? String(image.version) === String(data.oldversion) : String(image.version) !== String(data.version));
  if (!oldImages.length) return logLine(`RECREATE : no old images found for ${data.image}:${data.oldversion || "all previous versions"}`);
  for (const oldImage of oldImages) {
    const newImage = await ensureImageOnHost(client, oldImage, data.image, data.version);
    const containers = await client.list("/api/plugins/docker/containers/", { image_id: oldImage.id, limit: 200 });
    for (const container of containers) {
      const targetName = (data.clean_name === true || data.clean_name === "true" || data.clean_name === "on") ? String(container.name || container.display || "").replace(/-17[0-9]{8,}$/, "") : (container.name || container.display);
      await client.request("PATCH", "/api/plugins/docker/containers/", { body: [{ id: container.id, image: newImage.id, ...(targetName && targetName !== container.name ? { name: targetName } : {}) }] });
      logLine(`RECREATE : ${hostName(container)}/${valueText(container.display || container.name)} image set to ${data.image}:${data.version}`);
      await requestContainerOperation(client, container, "recreate", "RECREATE");
    }
  }
  logLine(`RECREATE : finished ${data.image}:${data.oldversion || "all previous versions"} -> ${data.version}`);
}

app.post("/recreate", (req, res) => {
  const data = { ...selectedProfileConfig(req.body), ...req.body };
  asyncOperation(res, () => recreateContainers(data));
});

app.post("/restart", (req, res) => {
  const data = { ...selectedProfileConfig(req.body), ...req.body };
  asyncOperation(res, async () => {
    const operation = ["start", "stop", "restart", "kill"].includes(data.operate_action) ? data.operate_action : "restart";
    const logPrefix = operation.toUpperCase();
    const client = new NetBoxClient(data);
    const hostFilter = await hostIdQuery(client, data.tag);
    if (hostFilter.host_id === "__none__") return logLine(`${logPrefix} : no Docker hosts found with tag ${data.tag}`);
    let containers = [];
    if (data.restart_mode === "instance") {
      containers = await client.list("/api/plugins/docker/containers/", { name: instanceShort(data.instance), ...hostFilter });
    } else {
      const images = await client.list("/api/plugins/docker/images/", { name: data.image, version: data.restart_version, limit: 200, ...hostFilter });
      for (const image of images) containers.push(...await client.list("/api/plugins/docker/containers/", { image_id: image.id, limit: 200 }));
    }
    for (const container of containers) await requestContainerOperation(client, container, operation, logPrefix);
    logLine(`${logPrefix} : finished ${operation} loop`);
  });
});

app.post("/delete", (req, res) => {
  const data = { ...selectedProfileConfig(req.body), ...req.body };
  asyncOperation(res, async () => {
    const client = new NetBoxClient(data);
    const hostFilter = await hostIdQuery(client, data.tag);
    const matches = await client.list("/api/plugins/docker/containers/", { name: instanceShort(data.instance), ...hostFilter });
    if (matches.length !== 1) return logLine(`DELETE : cannot delete ${instanceShort(data.instance)}, expected 1 container got ${matches.length}`);
    const container = matches[0];
    if (isContainerRunning(container)) {
      await client.request("PATCH", "/api/plugins/docker/containers/", { body: [{ id: container.id, operation: "stop" }] });
      logLine(`DELETE : container ${instanceShort(data.instance)} stop requested id=${container.id}`);
      await waitForContainerStopped(client, container.id, `${hostName(container)}/${valueText(container.display || container.name)}`);
    }
    await client.request("DELETE", `/api/plugins/docker/containers/${container.id}/`, { expected: [200, 202, 204] });
    logLine(`DELETE : container ${instanceShort(data.instance)} deleted id=${container.id}`);
    await deleteDnsRecord(client, data);
    if (req.body.order_request === "true") removeOrderInstance(req, data.profile || data.config_profile || "", data.instance || "");
  });
});

app.post("/refresh-hosts", (req, res) => {
  const data = { ...selectedProfileConfig(req.body), ...req.body };
  asyncOperation(res, async () => {
    const client = new NetBoxClient(data);
    const hosts = await dockerHosts(client, data.tag);
    for (const host of hosts) {
      await client.request("PATCH", `/api/plugins/docker/hosts/${host.id}/`, { body: { operation: "refresh" } });
      logLine(`REFRESH_HOST : ${valueText(host.display || host.name)} refresh requested`);
      await waitForHostReady(client, host.id, valueText(host.display || host.name));
    }
    logLine("REFRESH_HOST : finished host refresh loop");
  });
});

/* v8 ignore next 6 */
if (require.main === module) {
  const port = Number(process.env.PORT || 1880);
  app.listen(port, () => {
    console.log(`${packageJson.name} listening on ${port}`);
  });
}

module.exports = {
  app,
  asArray,
  authUserFromRequest,
  containerConfigPayloadFromForm,
  containerCreatePayloadFromForm,
  hostMatchesTag,
  imageNameFromRef,
  instanceShort,
  instanceZone,
  isContainerRunning,
  isContainerStopped,
  isOperationDone,
  isReadyContainer,
  maxInstancesValue,
  metricLabel,
  metricLine,
  operationLabel,
  parseProfiles,
  plainObject,
  routeLabel,
  setNetBoxFetchForTests,
  setOidcFetchForTests,
  statusClass,
  valueText,
  volumePayloadsFromForm,
};
