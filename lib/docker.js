const cloudflareSourceRanges = "173.245.48.0/20, 103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22, 141.101.64.0/18, 108.162.192.0/18, 190.93.240.0/20, 188.114.96.0/20, 197.234.240.0/22, 198.41.128.0/17, 162.158.0.0/15, 104.16.0.0/13, 104.24.0.0/14, 172.64.0.0/13, 131.0.72.0/22, 2400:cb00::/32, 2606:4700::/32, 2803:f800::/32, 2405:b500::/32, 2405:8100::/32, 2a06:98c0::/29, 2c0f:f248::/32";

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

function ownerEnvVarName(data) {
  return String(data?.owner_env_var || "SAASHUP_OWNER").trim() || "SAASHUP_OWNER";
}

function instanceZone(name) {
  const text = String(name || "");
  const dot = text.indexOf(".");
  return dot >= 0 ? text.slice(dot + 1) : "";
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
  return asArray(data.volume_name)
    .map((name) => ({ host: data.host_id, name }))
    .filter((volume) => volume.name);
}

function containerCreatePayloadFromForm(data, imageId) {
  return {
    host: data.host_id,
    name: instanceShort(data.instance),
    image: imageId,
    restart_policy: "unless-stopped",
  };
}

function containerConfigPayloadFromForm(data, containerId) {
  const envKeys = asArray(data.var_env_key);
  const envValues = asArray(data.var_env_value);
  const labelKeys = asArray(data.label_key);
  const labelValues = asArray(data.label_value);
  const volumeSources = asArray(data.volume_source);
  const volumeNames = asArray(data.volume_name);
  const port = asArray(data.port_value).find(Boolean);
  const privatePort = Number(port);
  const name = instanceShort(data.instance);
  const baseLabels = [
    { key: "traefik.enable", value: "true" },
    { key: `traefik.http.routers.${name}.rule`, value: `Host(\`${data.instance}\`)` },
    { key: `traefik.http.routers.${name}.entrypoints`, value: "http" },
    { key: `traefik.http.services.${name}.loadbalancer.server.port`, value: String(port || "") },
    { key: "traefik.http.middlewares.force-https-header.headers.customrequestheaders.X-Forwarded-Proto", value: "https" },
    ...(cloudflareFilterEnabled(data) ? [{ key: `traefik.http.middlewares.${name}.ipallowlist.sourcerange`, value: cloudflareSourceRanges }] : []),
    { key: `traefik.http.routers.${name}.middlewares`, value: "force-https-header" },
  ];
  const extraLabels = labelKeys.map((key, index) => ({ key, value: labelValues[index] || "" })).filter((item) => item.key);
  const ownerVarName = ownerEnvVarName(data);
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
    ports: Number.isFinite(privatePort) && privatePort > 0 ? [{ public_port: -1, private_port: privatePort, type: "tcp" }] : [],
    env,
    labels: baseLabels.concat(extraLabels),
    mounts: volumeSources.map((source, index) => ({
      source,
      volume: { name: volumeNames[index] || `${name}-data-${index + 1}` },
      read_only: false,
    })).filter((item) => item.source),
  };
}

module.exports = {
  asArray,
  cloudflareFilterEnabled,
  cloudflareSourceRanges,
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
  normalizedStatus,
  valueText,
  volumePayloadsFromForm,
};
