const cloudflareSourceRanges = "173.245.48.0/20, 103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22, 141.101.64.0/18, 108.162.192.0/18, 190.93.240.0/20, 188.114.96.0/20, 197.234.240.0/22, 198.41.128.0/17, 162.158.0.0/15, 104.16.0.0/13, 104.24.0.0/14, 172.64.0.0/13, 131.0.72.0/22, 2400:cb00::/32, 2606:4700::/32, 2803:f800::/32, 2405:b500::/32, 2405:8100::/32, 2a06:98c0::/29, 2c0f:f248::/32";
const defaultLogDriver = "syslog";
const defaultLogDriverOptions = {
  "syslog-address": "udp://127.0.0.1:5514",
  tag: "{{.Name}}",
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function valueText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value.display || value.name || value.label || value.value || "";
  return String(value);
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return plainObject(parsed);
  } catch {
    return {};
  }
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

function isContainerRunning(item) {
  const state = normalizedStatus(item, "state");
  const status = normalizedStatus(item, "status");
  return state.startsWith("running") || status.startsWith("running");
}

function isContainerStopped(item) {
  const state = normalizedStatus(item, "state");
  const status = normalizedStatus(item, "status");
  return !isContainerRunning(item) && (!state || state === "none" || state === "null" || state === "created" || state === "exited" || state === "stopped" || status === "created" || status === "exited" || status === "stopped");
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

function cloudflareFilterEnabled(data) {
  const value = Array.isArray(data?.cloudflare_filter) ? data.cloudflare_filter.at(-1) : data?.cloudflare_filter;
  return !["false", "0", "off", "no"].includes(String(value ?? "true").toLowerCase());
}

function traefikEnabled(data) {
  const value = Array.isArray(data?.traefik) ? data.traefik.at(-1) : data?.traefik;
  return !["false", "0", "off", "no"].includes(String(value ?? "true").toLowerCase());
}

function normalizedSaashupLabelConfig(data) {
  const labelKeys = asArray(data?.label_key);
  const labelValues = asArray(data?.label_value);
  let nextTraefik = data?.traefik;
  let nextDnsName = data?.dns_name;
  const runtimeLabels = [];

  labelKeys.forEach((key, index) => {
    const normalized = String(key || "").trim().toLowerCase();
    const value = labelValues[index] || "";

    if (normalized === "saashup_traefik") {
      nextTraefik = value;
      return;
    }

    if (normalized === "saashup_dns") {
      nextDnsName = value;
      return;
    }

    runtimeLabels.push({ key, value });
  });

  return {
    ...data,
    traefik: nextTraefik,
    dns_name: nextDnsName,
    label_key: runtimeLabels.map((label) => label.key),
    label_value: runtimeLabels.map((label) => label.value),
  };
}

function ownerEnvVarName(data) {
  return String(data?.owner_env_var || "SAASHUP_OWNER").trim() || "SAASHUP_OWNER";
}

function instanceZone(name) {
  const text = String(name || "");
  const dot = text.indexOf(".");
  return dot >= 0 ? text.slice(dot + 1) : "";
}

function dnsNameFromData(data) {
  data = normalizedSaashupLabelConfig(data);
  return String(data?.dns_name || data?.instance || "").trim();
}

function dnsPartsFromName(name) {
  const text = String(name || "").trim();
  if (!text) return { host: "", path: "" };

  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const path = `${url.pathname}${url.search}${url.hash}`;
    return { host: url.hostname, path: path === "/" ? "" : path };
  } catch {
    const slash = text.indexOf("/");
    if (slash === -1) return { host: text, path: "" };
    return { host: text.slice(0, slash), path: text.slice(slash) };
  }
}

function dnsHostNameFromData(data) {
  return dnsPartsFromName(dnsNameFromData(data)).host;
}

function traefikRuleFromData(data) {
  const { host, path } = dnsPartsFromName(dnsNameFromData(data));
  const hostRule = `Host(\`${host}\`)`;
  return path ? `${hostRule} && PathPrefix(\`${path}\`)` : hostRule;
}

function formData(req) {
  return req.method === "GET" ? req.query : req.body;
}

function containerNetworkNames(container) {
  return (Array.isArray(container.network_settings) ? container.network_settings : [])
    .map((setting) => valueText(setting.network))
    .filter(Boolean);
}

function volumePayloadsFromForm(data) {
  const seen = new Set();
  return asArray(data.volume_name)
    .map((name) => ({ host: data.host_id, name }))
    .filter((volume) => {
      const key = `${volume.host || ""}:${volume.name || ""}`;
      if (!volume.name || isBindPath(volume.name) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isBindPath(value) {
  const text = String(value || "");
  return text.startsWith("/") || text.startsWith("./") || text.startsWith("../") || text.startsWith("~");
}

function bindPayloadsFromForm(data) {
  const hostPaths = asArray(data.bind_host_path);
  const containerPaths = asArray(data.bind_container_path);
  const readOnlyValues = asArray(data.bind_read_only);
  const migratedVolumeBinds = asArray(data.volume_name)
    .map((name, index) => ({
      host_path: name,
      container_path: asArray(data.volume_source)[index] || "",
      read_only: false,
    }))
    .filter((bind) => isBindPath(bind.host_path) && bind.container_path);

  return hostPaths
    .map((hostPath, index) => ({
      host_path: hostPath,
      container_path: containerPaths[index] || "",
      read_only: readOnlyValues[index] === true || readOnlyValues[index] === "true" || readOnlyValues[index] === "on",
    }))
    .filter((bind) => bind.host_path && bind.container_path)
    .concat(migratedVolumeBinds);
}

function containerCreatePayloadFromForm(data, imageId) {
  return {
    host: data.host_id,
    name: instanceShort(data.instance),
    image: imageId,
    restart_policy: "unless-stopped",
  };
}

function logDriverOptionsFromForm(data) {
  const options = {
    ...plainObject(data.log_driver_options),
    ...parseJsonObject(data.log_driver_options),
  };
  const address = data.log_syslog_address || options["syslog-address"];
  const tag = data.log_syslog_tag || options.tag;
  return {
    ...defaultLogDriverOptions,
    ...options,
    ...(address ? { "syslog-address": String(address) } : {}),
    ...(tag ? { tag: String(tag) } : {}),
  };
}

function truthyFormValue(value) {
  return value === true || value === "true" || value === "on";
}

function templateNameFromForm(data) {
  const explicit = String(data.order_template || data.template_name || "").trim();
  if (explicit) return explicit;
  const image = String(data.image || "").trim().split("@")[0];
  const slashIndex = image.lastIndexOf("/");
  const colonIndex = image.lastIndexOf(":");
  const imageName = colonIndex > slashIndex ? image.slice(0, colonIndex) : image;
  const parts = imageName.split("/").filter(Boolean);
  return (parts.at(-1) || imageName || String(data.instance || "")).trim();
}

function canonicalTemplateLabels(data, ownerVarName, port) {
  if (!truthyFormValue(data.enroll_request) && !truthyFormValue(data.order_request)) return [];

  const entries = [
    ["name", templateNameFromForm(data)],
    ["owner", data.saashup_owner || ""],
    ["enabled", data.saashup_enabled === false || data.saashup_enabled === "false" ? "false" : "true"],
    ["url", data.template_url || data.saashup_template_url || ""],
    ["max_instances", data.max_instances || "1"],
    ["image", data.image || ""],
    ["version", data.version || ""],
    ["dns_name", data.dns_name || data.instance || ""],
    ["network", data.network || ""],
    ["port", port || ""],
    ["traefik", traefikEnabled(data) ? "true" : "false"],
    ["owner_env_var", ownerVarName],
  ];

  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => ({ key: `saashup.template.${name}`, value: String(value) }));
}

function isCanonicalTemplateLabel(key) {
  const normalized = String(key || "").trim().toLowerCase();
  return normalized.startsWith("saashup.template.") || normalized.startsWith("saashup_template_");
}

function containerConfigPayloadFromForm(data, containerId) {
  data = normalizedSaashupLabelConfig(data);
  const envKeys = asArray(data.var_env_key);
  const envValues = asArray(data.var_env_value);
  const labelKeys = asArray(data.label_key);
  const labelValues = asArray(data.label_value);
  const volumeSources = asArray(data.volume_source);
  const volumeNames = asArray(data.volume_name);
  const binds = bindPayloadsFromForm(data);
  const port = asArray(data.port_value).find(Boolean);
  const privatePort = Number(port);
  const name = instanceShort(data.instance);
  const hasTraefik = traefikEnabled(data);
  const baseLabels = hasTraefik ? [
    { key: "traefik.enable", value: "true" },
    { key: `traefik.http.routers.${name}.rule`, value: traefikRuleFromData(data) },
    { key: `traefik.http.routers.${name}.entrypoints`, value: "http" },
    { key: `traefik.http.services.${name}.loadbalancer.server.port`, value: String(port || "") },
    { key: "traefik.http.middlewares.force-https-header.headers.customrequestheaders.X-Forwarded-Proto", value: "https" },
    ...(cloudflareFilterEnabled(data) ? [{ key: `traefik.http.middlewares.${name}.ipallowlist.sourcerange`, value: cloudflareSourceRanges }] : []),
    { key: `traefik.http.routers.${name}.middlewares`, value: "force-https-header" },
  ] : [];
  const extraLabels = labelKeys
    .map((key, index) => ({ key, value: labelValues[index] || "" }))
    .filter((item) => item.key && !isCanonicalTemplateLabel(item.key) && (hasTraefik || !item.key.startsWith("traefik.")));
  const ownerVarName = ownerEnvVarName(data);
  const templateLabels = canonicalTemplateLabels(data, ownerVarName, port);
  const logDriver = String(data.log_driver || "").trim();
  const env = envKeys
    .map((key, index) => ({ var_name: key, value: envValues[index] || "" }))
    .filter((item) => item.var_name && item.var_name !== ownerVarName);

  if (data.saashup_owner) {
    env.push({ var_name: ownerVarName, value: String(data.saashup_owner) });
  }

  return {
    id: containerId,
    host: data.host_id,
    network_settings: data.network ? [{ network: { host: data.host_id, name: data.network } }] : [],
    ...(logDriver ? { log_driver: logDriver, log_driver_options: logDriverOptionsFromForm(data) } : {}),
    ports: Number.isFinite(privatePort) && privatePort > 0 ? [{ public_port: -1, private_port: privatePort, type: "tcp" }] : [],
    env,
    labels: baseLabels.concat(extraLabels, templateLabels),
    binds,
    mounts: volumeSources.map((source, index) => ({
      source,
      volume: { host: data.host_id, name: volumeNames[index] || `${name}-data-${index + 1}` },
      read_only: false,
    })).filter((item) => item.source && !isBindPath(item.volume.name)),
  };
}

module.exports = {
  asArray,
  bindPayloadsFromForm,
  cloudflareFilterEnabled,
  cloudflareSourceRanges,
  containerConfigPayloadFromForm,
  containerCreatePayloadFromForm,
  containerNetworkNames,
  dnsHostNameFromData,
  dnsNameFromData,
  dnsPartsFromName,
  formData,
  hostMatchesTag,
  hostName,
  imageNameFromRef,
  instanceShort,
  instanceZone,
  isBindPath,
  normalizedSaashupLabelConfig,
  ownerEnvVarName,
  traefikRuleFromData,
  traefikEnabled,
  isContainerRunning,
  isContainerStopped,
  isOperationDone,
  isReadyContainer,
  normalizedStatus,
  valueText,
  volumePayloadsFromForm,
};
