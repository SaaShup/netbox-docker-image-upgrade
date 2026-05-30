const fs = require("fs");
const path = require("path");
const express = require("express");
const { ProxyAgent, fetch } = require("undici");
const packageJson = require("./package.json");

const app = express();
const dataPath = path.resolve(process.env.DATAPATH || "/data");
const appPath = path.resolve(process.env.APPPATH || __dirname);
const stateFile = path.join(dataPath, "app-state.json");
const legacyContextFile = path.join(dataPath, "context", "global", "global.json");
const publicPath = path.join(appPath, "public");
const startedAt = Date.now();
const operationTimeoutSeconds = Number(process.env.OPERATION_TIMEOUT_SECONDS || 30);
const adminAllowedEmails = String(process.env.ADMIN_ALLOWED_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
let netboxFetch = fetch;

const metrics = {
  adminForbidden: 0,
  httpRequests: Object.fromEntries(["/", "/admin", "/config", "/create", "/delete", "/dockerhub", "/images", "/instances", "/logs", "/metrics", "/order", "/portable-config", "/recreate", "/refresh-hosts", "/restart", "/session/user", "/templates", "/test", "/version", "/webhook", "other"].map((route) => [route, 0])),
  operationRequests: Object.fromEntries(["config", "create", "delete", "refresh", "restart", "upgrade"].map((name) => [name, { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 }])),
};

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function parseProfiles(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function defaultState() {
  return {
    config: {},
    templates: {},
    order_counts: {},
    logs: "",
  };
}

function migrateLegacyState() {
  const legacy = readJson(legacyContextFile, {});
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return defaultState();
  return {
    config: plainObject(legacy.config),
    templates: plainObject(legacy.templates),
    order_counts: plainObject(legacy.order_counts),
    logs: typeof legacy.logs === "string" ? legacy.logs : "",
  };
}

function readState() {
  const state = fs.existsSync(stateFile) ? readJson(stateFile, defaultState()) : migrateLegacyState();
  return { ...defaultState(), ...plainObject(state) };
}

function writeState(mutator) {
  const state = readState();
  const next = typeof mutator === "function" ? mutator(state) || state : mutator;
  writeJson(stateFile, { ...defaultState(), ...plainObject(next) });
  return next;
}

function logLine(message) {
  writeState((state) => {
    state.logs = `${new Date().toISOString()} ${message}<br>${state.logs || ""}`;
    return state;
  });
}

function valueText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value.display || value.name || value.label || value.value || "";
  return String(value);
}

function normalizedStatus(item, key) {
  return String(valueText(item?.[key])).toLowerCase();
}

function isReadyContainer(item) {
  const status = normalizedStatus(item, "status");
  const operation = normalizedStatus(item, "operation");
  return status.startsWith("running") && (!operation || operation === "none" || operation === "null");
}

function isOperationDone(item) {
  const operation = normalizedStatus(item, "operation");
  return !operation || operation === "none" || operation === "null";
}

function maxInstancesValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(10, Math.max(0, Math.floor(number)));
}

function routeLabel(req) {
  const requestPath = String(req.originalUrl || req.url || "").split("?")[0].replace(/\/+$/, "") || "/";
  if (requestPath === "/admin.html") return "/admin";
  if (requestPath === "/order.html") return "/order";
  if (metrics.httpRequests[requestPath] !== undefined) return requestPath;
  return "other";
}

function operationLabel(req) {
  return {
    "/config": "config",
    "/webhook": "config",
    "/create": "create",
    "/delete": "delete",
    "/refresh-hosts": "refresh",
    "/restart": "restart",
    "/recreate": "upgrade",
    "/dockerhub": "upgrade",
  }[routeLabel(req)] || "";
}

function statusClass(statusCode) {
  const code = Number(statusCode);
  if (code >= 100 && code < 600) return `${Math.floor(code / 100)}xx`;
  return "other";
}

function metricLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function metricLine(name, value, labels = {}) {
  const entries = Object.entries(labels);
  const labelText = entries.length ? `{${entries.map(([key, val]) => `${key}="${metricLabel(val)}"`).join(",")}}` : "";
  return `${name}${labelText} ${value}`;
}

function firstHeader(req, names) {
  for (const name of names) {
    const value = req.headers[name];
    if (Array.isArray(value) && value[0]) return value[0];
    if (value) return value;
  }
  return "";
}

function authUserFromRequest(req) {
  const email = firstHeader(req, ["x-auth-request-email", "x-forwarded-email", "x-auth-request-user-email"]);
  const user = firstHeader(req, ["x-auth-request-user", "x-forwarded-user", "x-auth-request-preferred-username", "x-forwarded-preferred-username"]);
  const name = firstHeader(req, ["x-auth-request-preferred-username", "x-forwarded-preferred-username", "x-auth-request-user", "x-forwarded-user", "x-auth-request-email", "x-forwarded-email"]);
  if (name || user || email || !("ENABLE_EDITOR" in process.env)) return { user, email, name };
  const devUser = process.env.USER || process.env.LOGNAME || "Local dev";
  return { user: devUser, email: "", name: devUser };
}

function isAdminAllowed(req) {
  if (!adminAllowedEmails.length) return true;
  const { email } = authUserFromRequest(req);
  return Boolean(email && adminAllowedEmails.includes(String(email).toLowerCase()));
}

function userOrderKey(req) {
  const { email, user } = authUserFromRequest(req);
  return String(email || user || req.ip || "anonymous").trim().toLowerCase();
}

function selectedProfileConfig(source) {
  const state = readState();
  const config = { ...state.config, ...plainObject(source) };
  const profiles = parseProfiles(config.profiles);
  const profile = config.profile || config.config_profile || source?.profile || source?.config_profile || "";
  const profileConfig = profile && profiles[profile] ? profiles[profile] : {};
  return {
    ...config,
    ...profileConfig,
    ...plainObject(source),
    profile,
    config_profile: profile,
  };
}

function hostMatchesTag(host, tag) {
  if (!tag) return true;
  const expected = String(tag).toLowerCase();
  const tags = Array.isArray(host.tags) ? host.tags : [];
  return tags.some((item) => [item?.name, item?.slug, item?.display, item].some((value) => String(value || "").toLowerCase() === expected))
    || [host.tag, host.role, host.custom_fields?.role, host.cf?.role].some((value) => String(value || "").toLowerCase() === expected);
}

function imageNameFromRef(ref) {
  const text = String(ref || "");
  if (!text) return "";
  const slash = text.lastIndexOf("/");
  const colon = text.lastIndexOf(":");
  return colon > slash ? text.slice(0, colon) : text;
}

function hostName(item) {
  return valueText(item?.host) || valueText(item);
}

function instanceShort(name) {
  return String(name || "").split(".")[0];
}

function formData(req) {
  return req.method === "GET" ? req.query : req.body;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

class NetBoxClient {
  constructor(config) {
    this.base = String(config.netbox || "").replace(/\/+$/, "");
    this.token = config.token || "";
    this.proxy = config.proxy || "";
  }

  async request(method, apiPath, { query = {}, body, expected = [200, 201, 202, 204] } = {}) {
    if (!this.base || !this.token) {
      const error = new Error("NetBox URL and token are required");
      error.statusCode = 400;
      throw error;
    }

    const url = new URL(apiPath, this.base);
    Object.entries(query).forEach(([key, value]) => {
      for (const item of asArray(value)) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(key, item);
      }
    });
    const options = {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Token ${this.token}`,
      },
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    if (this.proxy) options.dispatcher = new ProxyAgent(this.proxy);

    const response = await netboxFetch(url, options);
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = text;
    }
    if (!expected.includes(response.status)) {
      const error = new Error(`NetBox request failed ${response.status}`);
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }
    return { statusCode: response.status, payload };
  }

  async list(apiPath, query = {}) {
    const { payload } = await this.request("GET", apiPath, { query });
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
  }
}

async function dockerHosts(client, tag = "") {
  const hosts = await client.list("/api/plugins/docker/hosts/", { limit: 1000 });
  return hosts.filter((host) => hostMatchesTag(host, tag));
}

async function hostIdQuery(client, tag = "") {
  if (!tag) return {};
  const hosts = await dockerHosts(client, tag);
  return hosts.length ? { host_id: hosts.map((host) => host.id) } : { host_id: "__none__" };
}

function containerNetworkNames(container) {
  return (Array.isArray(container.network_settings) ? container.network_settings : [])
    .map((setting) => valueText(setting.network))
    .filter(Boolean);
}

function containerPayloadFromForm(data, imageId) {
  const envKeys = asArray(data.var_env_key);
  const envValues = asArray(data.var_env_value);
  const labelKeys = asArray(data.label_key);
  const labelValues = asArray(data.label_value);
  const volumeSources = asArray(data.volume_source);
  const volumeNames = asArray(data.volume_name);
  const port = asArray(data.port_value).find(Boolean);
  const name = instanceShort(data.instance);
  const labels = labelKeys.map((key, index) => ({ key, value: labelValues[index] || "" })).filter((item) => item.key);
  if (port) labels.push({ key: `traefik.http.services.${name}.loadbalancer.server.port`, value: String(port) });

  return {
    name,
    host: data.host_id,
    image: imageId,
    restart_policy: "unless-stopped",
    environment_variables: envKeys.map((key, index) => ({ key, value: envValues[index] || "" })).filter((item) => item.key),
    labels,
    mounts: volumeSources.map((source, index) => ({
      source,
      volume: { name: volumeNames[index] || `${name}-data-${index + 1}` },
      read_only: false,
    })).filter((item) => item.source),
  };
}

async function waitForContainerReady(client, id, displayName, operation) {
  const deadline = Date.now() + operationTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const { payload } = await client.request("GET", `/api/plugins/docker/containers/${id}/`);
    if (isReadyContainer(payload)) {
      logLine(`${operation} : ${displayName} ready status=${normalizedStatus(payload, "status")} operation=${normalizedStatus(payload, "operation")}`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  logLine(`${operation} : ${displayName} timeout after ${operationTimeoutSeconds}s, moving to next item`);
  return false;
}

async function waitForHostReady(client, id, displayName) {
  const deadline = Date.now() + operationTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const { payload } = await client.request("GET", `/api/plugins/docker/hosts/${id}/`);
    if (isOperationDone(payload)) {
      logLine(`REFRESH_HOST : ${displayName} refresh complete operation=${normalizedStatus(payload, "operation")} state=${normalizedStatus(payload, "state")}`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  logLine(`REFRESH_HOST : ${displayName} timeout after ${operationTimeoutSeconds}s, moving to next host`);
  return false;
}

async function requestContainerOperation(client, container, operation, prefix) {
  const display = `${hostName(container)}/${valueText(container.display || container.name)}`;
  await client.request("PATCH", "/api/plugins/docker/containers/", { body: [{ id: container.id, operation }] });
  logLine(`${prefix} : ${display} ${operation} requested`);
  await waitForContainerReady(client, container.id, display, prefix);
}

async function ensureImageOnHost(client, oldImage, image, version) {
  const hostId = oldImage.host?.id || oldImage.host;
  const matches = await client.list("/api/plugins/docker/images/", { name: image, version, host_id: hostId });
  if (matches[0]) return matches[0];

  const { payload } = await client.request("POST", "/api/plugins/docker/images/", {
    body: {
      host: hostId,
      name: image,
      version,
      registry: oldImage.registry?.id || oldImage.registry,
    },
    expected: [200, 201, 202],
  });
  const created = Array.isArray(payload) ? payload[0] : payload;
  logLine(`RECREATE : created image ${image}:${version} on ${hostName(oldImage)} status=201`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return created;
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
  const userKey = userOrderKey(req);
  const used = Number(counts[userKey]?.[profile] || 0);
  const config = selectedProfileConfig({ profile, config_profile: profile });
  const max = maxInstancesValue(config.max_instances);
  return { profile, used, max, remaining: Math.max(0, max - used), reached: used >= max };
}

function setNetBoxFetchForTests(fetchImpl) {
  netboxFetch = fetchImpl || fetch;
}

function incrementUsage(req, profile) {
  writeState((state) => {
    const userKey = userOrderKey(req);
    state.order_counts = plainObject(state.order_counts);
    if (!state.order_counts[userKey]) state.order_counts[userKey] = {};
    state.order_counts[userKey][profile] = Number(state.order_counts[userKey][profile] || 0) + 1;
    return state;
  });
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

function requireAdmin(req, res, next) {
  if (isAdminAllowed(req)) return next();
  metrics.adminForbidden += 1;
  res.status(403).sendFile(path.join(publicPath, "forbidden.html"));
}

app.get("/session/user", (req, res) => res.json(authUserFromRequest(req)));
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

app.get("/admin", requireAdmin, (req, res) => res.sendFile(path.join(publicPath, "admin.html")));
app.get("/admin.html", requireAdmin, (req, res) => res.sendFile(path.join(publicPath, "admin.html")));
app.get("/order", (req, res) => res.sendFile(path.join(publicPath, "order.html")));
app.use(express.static(publicPath));

app.get("/config", (req, res) => res.json(readState().config || {}));
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
    netbox: req.query.netbox || "",
    token: req.query.token || "",
    proxy: req.query.proxy || "",
    domain: req.query.domain || "",
    tag: req.query.tag || "",
    max_instances: maxInstancesValue(req.query.max_instances),
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

app.get("/test", requireAdmin, async (req, res) => {
  try {
    const client = new NetBoxClient(selectedProfileConfig(req.query));
    const { payload } = await client.request("GET", "/api/status/", { expected: [200] });
    res.json(payload);
  } catch (error) {
    res.status(error.statusCode || 502).json({ detail: error.message, payload: error.payload });
  }
});

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

app.get("/order/limit", (req, res) => res.json(currentUsage(req, req.query.profile || "")));

app.post("/create", async (req, res) => {
  const data = { ...selectedProfileConfig(req.body), ...req.body };
  const usage = currentUsage(req, data.profile || data.config_profile || "");
  if (req.body.order_request === "true" && usage.reached) {
    return res.status(429).json({ code: "max_instances_reached", detail: `You have reached your maximum of ${usage.max} instance${usage.max === 1 ? "" : "s"} for this config.`, max_instances: usage.max, used_instances: usage.used });
  }
  asyncOperation(res, async () => {
    const client = new NetBoxClient(data);
    const hosts = await dockerHosts(client, data.tag);
    if (!hosts.length) return logLine(`CREATE : no Docker hosts found${data.tag ? ` with tag ${data.tag}` : ""}`);
    const containers = await client.list("/api/plugins/docker/containers/", { limit: 1000, host_id: hosts.map((host) => host.id) });
    const selectedHost = hosts.map((host) => ({ host, count: containers.filter((c) => (c.host?.id || c.host) === host.id).length })).sort((a, b) => a.count - b.count)[0].host;
    data.host_id = selectedHost.id;
    const images = await client.list("/api/plugins/docker/images/", { name: data.image, version: data.version, host_id: data.host_id });
    if (!images[0]) return logLine(`CREATE : image ${data.image}:${data.version} not found on ${hostName(selectedHost)}`);
    const containerPayload = containerPayloadFromForm(data, images[0].id);
    const { payload } = await client.request("POST", "/api/plugins/docker/containers/", { body: containerPayload, expected: [200, 201, 202] });
    const container = Array.isArray(payload) ? payload[0] : payload;
    logLine(`CREATE : container ${containerPayload.name} created on ${hostName(selectedHost)}`);
    await client.request("PATCH", "/api/plugins/docker/containers/", { body: [containerPayload] }).catch(() => {});
    await requestContainerOperation(client, container, "recreate", "CREATE");
    if (req.body.order_request === "true") incrementUsage(req, data.profile || data.config_profile || "");
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
    const client = new NetBoxClient(data);
    const hostFilter = await hostIdQuery(client, data.tag);
    if (hostFilter.host_id === "__none__") return logLine(`RESTART : no Docker hosts found with tag ${data.tag}`);
    let containers = [];
    if (data.restart_mode === "instance") {
      containers = await client.list("/api/plugins/docker/containers/", { name: instanceShort(data.instance), ...hostFilter });
    } else {
      const images = await client.list("/api/plugins/docker/images/", { name: data.image, version: data.restart_version, limit: 200, ...hostFilter });
      for (const image of images) containers.push(...await client.list("/api/plugins/docker/containers/", { image_id: image.id, limit: 200 }));
    }
    for (const container of containers) await requestContainerOperation(client, container, "restart", "RESTART");
    logLine("RESTART : finished restart loop");
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
    await client.request("PATCH", "/api/plugins/docker/containers/", { body: [{ id: container.id, operation: "stop" }] });
    await client.request("DELETE", `/api/plugins/docker/containers/${container.id}/`, { expected: [200, 202, 204] });
    logLine(`DELETE : container ${instanceShort(data.instance)} deleted id=${container.id}`);
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

app.post("/dockerhub", (req, res) => {
  res.status(202).json({ status: "accepted" });
  const tag = req.body?.push_data?.tag;
  if (!tag || tag === "latest") return;
  const image = req.body?.repository?.repo_name;
  const config = selectedProfileConfig({});
  const body = { ...config, image, version: tag, clean_name: false };
  Promise.resolve()
    .then(() => recreateContainers(body))
    .catch((error) => logLine(`DOCKERHUB : failed ${error.message}`));
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
  containerPayloadFromForm,
  hostMatchesTag,
  imageNameFromRef,
  instanceShort,
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
  statusClass,
  valueText,
};
