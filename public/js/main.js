const urlParams = new URLSearchParams(window.location.search);
const actionFromUrl = urlParams.get("action");
const isOrderPage = document.body?.classList.contains("order-page");
const orderTemplateName = urlParams.get("template") || "";

const form = document.getElementById("instanceForm");
const submitBtn = document.getElementById("submitBtn");
const restartInstanceBtn = document.getElementById("restartInstanceBtn");
const testBtn = document.getElementById("testBtn");
const deleteConfigBtn = document.getElementById("deleteConfigBtn");
const exportConfigBtn = document.getElementById("exportConfigBtn");
const importConfigBtn = document.getElementById("importConfigBtn");
const importConfigFile = document.getElementById("importConfigFile");
const clearBtn = document.getElementById("clearBtn");
const dockerRunBtn = document.getElementById("dockerRunBtn");
const templateSelect = document.getElementById("templateSelect");
const loadTemplateBtn = document.getElementById("loadTemplateBtn");
const orderTemplateBtn = document.getElementById("orderTemplateBtn");
const saveTemplateBtn = document.getElementById("saveTemplateBtn");
const deleteTemplateBtn = document.getElementById("deleteTemplateBtn");
const orderCancelBtn = document.getElementById("orderCancelBtn");
const dockerRunModal = document.getElementById("dockerRunModal");
const dockerRunInput = document.getElementById("dockerRunInput");
const dockerRunApplyBtn = document.getElementById("dockerRunApplyBtn");
const dockerRunCancelBtn = document.getElementById("dockerRunCancelBtn");
const dockerRunCloseBtn = document.getElementById("dockerRunCloseBtn");
const formTitle = document.getElementById("form-title");
const formDescription = document.getElementById("form-description");
const envList = document.getElementById("envList");
const addEnvBtn = document.getElementById("addEnvBtn");
const labelList = document.getElementById("labelList");
const addLabelBtn = document.getElementById("addLabelBtn");
const portList = document.getElementById("portList");
const volumeList = document.getElementById("volumeList");
const addVolumeBtn = document.getElementById("addVolumeBtn");
const instanceOptions = document.getElementById("instanceOptions");
const refreshInstancesBtn = document.getElementById("refreshInstancesBtn");
const imageOptions = document.getElementById("imageOptions");
const oldVersionOptions = document.getElementById("oldVersionOptions");
const restartVersionOptions = document.getElementById("restartVersionOptions");
const refreshImagesBtn = document.getElementById("refreshImagesBtn");
const logsCard = document.getElementById("logsCard");
const logsFullscreenBtn = document.getElementById("logsFullscreenBtn");
const clearLogsBtn = document.getElementById("clearLogsBtn");
const configProfileSelect = document.getElementById("config_profile");
const orderActions = document.getElementById("orderActions");
const orderLoading = document.getElementById("orderLoading");
const orderStatus = document.getElementById("orderStatus");
const authUser = document.getElementById("authUser");
const authAvatar = document.getElementById("authAvatar");
const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const logoutBtn = document.getElementById("logoutBtn");

let currentAction = isOrderPage ? "create" : (localStorage.getItem("current_action") || "config");
let currentConfigProfile = localStorage.getItem("current_config_profile") || "";
let noticeTimeout = null;
let savedConfig = {};
let configProfiles = {};
let imageRecords = [];
let containerCountRequestId = 0;
let createNetworkRequestId = 0;
let lastLogsHtml = "";
let logsPollFailed = false;
let createTemplates = {};
let generatedCreateInstanceName = "";
const logsPollFailureNotice = "Activity logs unavailable: network error";

const configFields = ["config_profile", "config_name", "netbox", "token", "proxy", "domain", "tag", "max_instances"];

const actions = {
  config: {
    endpoint: "/webhook",
    method: "get",
    menu: "menu_config",
    title: "Config",
    description: "Save the NetBox URL, token, optional proxy, domain and host tag used by the automation.",
    submitLabel: "Save config",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "config_name", "netbox", "token", "proxy", "domain", "tag", "max_instances"],
  },
  create: {
    endpoint: "/create",
    method: "post",
    menu: "menu_create",
    title: "Create instance",
    description: "Create a container, volume, DNS record and Traefik labels.",
    submitLabel: "Create instance",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "network", "instance", "image", "version", "env_vars", "labels", "ports", "volumes"],
  },
  recreate: {
    endpoint: "/recreate",
    method: "post",
    menu: "menu_recreate",
    title: "Upgrade containers",
    description: "Replace containers matching an image and old version with a new version.",
    submitLabel: "Upgrade containers",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "image", "oldversion", "version", "clean_name"],
  },
  restart: {
    endpoint: "/restart",
    method: "post",
    menu: "menu_restart",
    title: "Restart containers",
    description: "Restart one container or containers matching an image and version.",
    submitLabel: "Restart image",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "instance", "image", "restart_version"],
  },
  refresh_hosts: {
    endpoint: "/refresh-hosts",
    method: "post",
    menu: "menu_refresh_hosts",
    title: "Refresh Docker hosts",
    description: "Request a refresh for each Docker host in the selected NetBox config.",
    submitLabel: "Refresh hosts",
    buttonClass: "btn btn-primary",
    fields: ["config_profile"],
  },
  delete: {
    endpoint: "/delete",
    method: "post",
    menu: "menu_delete",
    title: "Delete instance",
    description: "Delete one instance. A confirmation will be requested before submitting.",
    submitLabel: "Delete instance",
    buttonClass: "btn btn-danger",
    fields: ["config_profile", "instance"],
    confirm: "Delete this instance?",
  },
};

const allFieldNames = [
  "netbox",
  "token",
  "proxy",
  "domain",
  "tag",
  "max_instances",
  "config_profile",
  "config_name",
  "network",
  "instance",
  "image",
  "oldversion",
  "restart_version",
  "version",
  "clean_name",
  "var_env_key",
  "var_env_value",
  "label_key",
  "label_value",
  "port_value",
  "volume_source",
  "volume_name",
];

function field(name) {
  return document.getElementById(name);
}

function fieldValue(name, fallback = "") {
  const el = field(name);
  return el ? el.value : fallback;
}

function userInitials(value) {
  const words = String(value || "")
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);

  if (!words.length) return "?";

  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

async function loadAuthUser() {
  if (!authUser) return;

  try {
    const response = await fetch("/session/user", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) return;

    const user = await response.json();
    const displayName = user.name || user.user || user.email || "";

    if (!displayName) return;

    if (authName) authName.textContent = displayName;
    if (authEmail) authEmail.textContent = user.email && user.email !== displayName ? user.email : "";
    if (authAvatar) authAvatar.textContent = userInitials(displayName);

    authUser.classList.remove("hidden");
  } catch (error) {
    authUser.classList.add("hidden");
  }
}

function logoutFromProxy() {
  const returnUrl = window.location.origin + "/";
  window.location.href = `/oauth2/sign_out?rd=${encodeURIComponent(returnUrl)}`;
}

function isFqdn(value) {
  const name = String(value || "").trim();
  if (name.length > 253 || !name.includes(".")) return false;

  return name
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function normalizeDomain(value) {
  return String(value || "").trim().replace(/^\.+|\.+$/g, "");
}

function instanceFqdn(value, domain) {
  const name = String(value || "").trim().replace(/\.+$/g, "");
  if (!name || isFqdn(name)) return name;

  const normalizedDomain = normalizeDomain(domain);
  return normalizedDomain ? `${name}.${normalizedDomain}` : name;
}

function randomInstanceSuffix(length = 16) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const cryptoObject = window.crypto || window.msCrypto;
  const bytes = new Uint8Array(length);

  if (cryptoObject?.getRandomValues) {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function instanceNamePrefix() {
  const credentials = selectedProfileCredentials();
  const source = credentials.profile || credentials.tag || "app";
  const prefix = String(source)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return prefix || "app";
}

function instanceShortName() {
  const name = String(fieldValue("instance") || "instance").trim();
  const shortName = (name.includes(".") ? name.split(".")[0] : name)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return shortName || "instance";
}

function generatedVolumeName(index) {
  const suffix = index === 0 ? "data" : `data-${index + 1}`;
  return `${instanceShortName()}-${suffix}`;
}

function syncVolumeNames() {
  let sourceIndex = 0;

  repeatRows(volumeList, ".repeat-row").forEach((row) => {
    const sourceInput = row.querySelector('[name="volume_source"]');
    const nameInput = row.querySelector('[name="volume_name"]');
    if (!nameInput) return;

    if (!sourceInput?.value) {
      nameInput.value = "";
      return;
    }

    nameInput.value = generatedVolumeName(sourceIndex);
    sourceIndex += 1;
  });
}

function ensureRandomCreateInstanceName() {
  if (currentAction !== "create") return;

  const currentName = fieldValue("instance");
  if (currentName && currentName !== generatedCreateInstanceName) return;

  generatedCreateInstanceName = `${instanceNamePrefix()}-${randomInstanceSuffix()}`;
  setFieldValue("instance", generatedCreateInstanceName);
  syncVolumeNames();
}

function setFieldValue(name, value = "") {
  const el = field(name);
  if (!el) return;

  if (el.type === "checkbox") {
    el.checked = Boolean(value);
    return;
  }

  el.value = value || "";
}

function networkNamesFromItem(item) {
  if (!item || typeof item !== "object") return [];
  if (Array.isArray(item.networks)) return item.networks.filter(Boolean);
  if (item.network) return [item.network].filter(Boolean);
  if (!Array.isArray(item.network_settings)) return [];

  return item.network_settings
    .map((setting) => {
      const network = setting?.network;
      if (typeof network === "string") return network;
      if (!network || typeof network !== "object") return "";

      return network.name || network.display || network.value || "";
    })
    .filter(Boolean);
}

function isTraefikNetwork(name) {
  return String(name || "").toLowerCase().startsWith("traefik");
}

async function refreshCreateNetworkFromInstances(requestId) {
  const query = credentialsQuery({ includeTag: true });

  if (!query) {
    if (requestId === createNetworkRequestId) setFieldValue("network", "");
    return;
  }

  try {
    const response = await fetch(`/instances?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    if (requestId !== createNetworkRequestId || currentAction !== "create") return;

    const networks = Array.from(new Set((Array.isArray(data) ? data : [])
      .flatMap(networkNamesFromItem)
      .filter(isTraefikNetwork)))
      .sort((a, b) => a.localeCompare(b));

    setFieldValue("network", networks[0] || "");
  } catch {
    if (requestId === createNetworkRequestId && currentAction === "create") {
      setFieldValue("network", "");
    }
  }
}

function syncCreateNetwork() {
  const network = field("network");
  if (!network) return;

  network.readOnly = currentAction === "create";
  if (currentAction !== "create") return;

  setFieldValue("network", "");
  const requestId = ++createNetworkRequestId;
  refreshCreateNetworkFromInstances(requestId);
}

function profileLabel(name) {
  return name || "No config saved";
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

function storedProfiles() {
  return parseProfiles(localStorage.getItem("config_profiles"));
}

function parseStoredObject(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadCreateTemplates() {
  createTemplates = parseStoredObject("create_templates");

  return fetch("/templates", {
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((templates) => {
      createTemplates = templates && typeof templates === "object" && !Array.isArray(templates) ? templates : {};
      localStorage.setItem("create_templates", JSON.stringify(createTemplates));
      updateTemplateOptions();
    })
    .catch(() => {
      updateTemplateOptions();
    });
}

function persistCreateTemplates() {
  localStorage.setItem("create_templates", JSON.stringify(createTemplates));

  return fetch("/templates", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createTemplates),
  }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json().catch(() => createTemplates);
  });
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportPortableConfig() {
  try {
    const response = await fetch("/portable-config", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`saashup-config-${date}.json`, data);
    setNotice("Config export ready", "success");
  } catch {
    setNotice("Config export failed", "error");
  }
}

function importPortableConfigFile() {
  importConfigFile?.click();
}

async function importPortableConfig(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!confirm("Import config, profiles and templates from this file? Current values will be replaced.")) {
      return;
    }

    const response = await fetch("/portable-config", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const importedConfig = plainObject(data.config);
    const importedProfiles = parseProfiles(data.profiles || importedConfig.profiles);
    const importedTemplates = plainObject(data.templates);

    configProfiles = importedProfiles;
    createTemplates = importedTemplates;
    savedConfig = { ...importedConfig, profiles: importedProfiles };
    currentConfigProfile = importedConfig.profile || importedConfig.config_profile || Object.keys(configProfiles).sort((a, b) => a.localeCompare(b))[0] || "";

    localStorage.removeItem("deleted_config_profiles");
    persistProfiles();
    localStorage.setItem("create_templates", JSON.stringify(createTemplates));
    updateProfileOptions();
    updateTemplateOptions();
    applyProfileToFields(currentConfigProfile);
    setNotice("Config import complete", "success");
  } catch {
    setNotice("Config import failed", "error");
  } finally {
    if (importConfigFile) importConfigFile.value = "";
  }
}

function updateTemplateOptions(selected = "") {
  if (!templateSelect) return;

  const names = Object.keys(createTemplates).sort((a, b) => a.localeCompare(b));
  templateSelect.replaceChildren(new Option(names.length ? "Select template" : "No templates saved", ""));

  names.forEach((name) => {
    templateSelect.appendChild(new Option(name, name));
  });

  templateSelect.value = names.includes(selected) ? selected : "";
  if (loadTemplateBtn) loadTemplateBtn.disabled = !templateSelect.value;
  if (orderTemplateBtn) orderTemplateBtn.disabled = !templateSelect.value;
  if (deleteTemplateBtn) deleteTemplateBtn.disabled = !templateSelect.value;
}

function deletedProfiles() {
  try {
    const deleted = JSON.parse(localStorage.getItem("deleted_config_profiles") || "[]");
    return Array.isArray(deleted) ? deleted : [];
  } catch {
    return [];
  }
}

function rememberDeletedProfile(profile) {
  const deleted = new Set(deletedProfiles());
  if (profile) deleted.add(profile);
  localStorage.setItem("deleted_config_profiles", JSON.stringify([...deleted]));
}

function forgetDeletedProfile(profile) {
  const deleted = new Set(deletedProfiles());
  if (profile) deleted.delete(profile);
  localStorage.setItem("deleted_config_profiles", JSON.stringify([...deleted]));
}

function applyDeletedProfileFilter(profiles) {
  const deleted = new Set(deletedProfiles());
  return Object.fromEntries(Object.entries(profiles || {}).filter(([name]) => !deleted.has(name)));
}

function persistProfiles() {
  localStorage.setItem("config_profiles", JSON.stringify(configProfiles));
  if (currentConfigProfile) {
    localStorage.setItem("current_config_profile", currentConfigProfile);
  } else {
    localStorage.removeItem("current_config_profile");
  }
}

function profileCredentials(name = currentConfigProfile) {
  const profile = configProfiles[name] || {};
  return {
    profile: name,
    netbox: profile.netbox || "",
    token: profile.token || "",
    proxy: profile.proxy || "",
    domain: profile.domain || "",
    tag: profile.tag || "",
    max_instances: normalizeMaxInstances(profile.max_instances),
  };
}

function normalizeMaxInstances(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;

  return Math.min(10, Math.max(0, Math.floor(number)));
}

async function orderLimitForProfile(profile) {
  const query = new URLSearchParams({ profile: profile || "" });
  const response = await fetch(`/order/limit?${query.toString()}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function selectedProfileCredentials() {
  const selected = configProfileSelect?.value || currentConfigProfile || "";
  return profileCredentials(selected);
}

function updateProfileOptions() {
  if (!configProfileSelect) return;

  const deleted = new Set(deletedProfiles());
  const profileNames = Object.keys(configProfiles)
    .filter((name) => !deleted.has(name))
    .sort((a, b) => a.localeCompare(b));

  if (!profileNames.includes(currentConfigProfile)) {
    currentConfigProfile = profileNames[0] || "";
  }

  const names = profileNames.length ? profileNames : [""];

  configProfileSelect.replaceChildren(...names.map((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = profileLabel(name);
    return option;
  }));

  configProfileSelect.value = currentConfigProfile;
}

function applyProfileToFields(name = currentConfigProfile) {
  currentConfigProfile = name || "";
  const credentials = profileCredentials(currentConfigProfile);

  setFieldValue("config_profile", currentConfigProfile);
  setFieldValue("config_name", currentConfigProfile);
  setFieldValue("netbox", credentials.netbox);
  setFieldValue("token", credentials.token);
  setFieldValue("proxy", credentials.proxy);
  setFieldValue("domain", credentials.domain);
  setFieldValue("tag", credentials.tag);
  setFieldValue("max_instances", credentials.max_instances);
  persistProfiles();
  syncCreateNetwork();
}

function credentialsQuery({ includeTag = false } = {}) {
  const credentials = selectedProfileCredentials();
  if (!credentials.netbox || !credentials.token) return null;

  const query = new URLSearchParams({
    netbox: credentials.netbox,
    token: credentials.token,
    proxy: credentials.proxy,
    profile: credentials.profile,
  });

  if (includeTag) {
    query.set("tag", credentials.tag);
  }

  return query;
}

function shouldFilterRefreshByTag() {
  return currentAction === "create" || currentAction === "recreate" || currentAction === "restart" || currentAction === "delete";
}

function setTestButtonState(state = "default") {
  if (!testBtn) return;

  testBtn.classList.toggle("btn-success", state === "success");
  testBtn.classList.toggle("btn-danger", state === "error");
  testBtn.classList.toggle("btn-primary", state === "default");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatLogLine(line) {
  const text = line.replace(/&nbsp;/g, " ").trim();
  if (!text) return "";

  const match = text.match(/^(.{24})\s+([A-Z_]+)\s*:\s*(.*)$/);
  if (!match) {
    return `<div class="log-row"><span></span><strong>LOG</strong><span>${escapeHtml(text)}</span><span></span></div>`;
  }

  const [, time, action, rest] = match;
  const statusMatch = rest.match(/\s(\d{3})$/);
  const status = statusMatch ? statusMatch[1] : "";
  const message = status ? rest.slice(0, -status.length).trim() : rest;

  return [
    '<div class="log-row">',
    `<span>${escapeHtml(time.trim())}</span>`,
    `<strong>${escapeHtml(action)}</strong>`,
    `<span>${escapeHtml(message)}</span>`,
    `<span>${escapeHtml(status)}</span>`,
    '</div>',
  ].join("");
}

function formatLogs(logs) {
  const rows = String(logs || "")
    .split(/<br\s*\/?>/i)
    .map(formatLogLine)
    .filter(Boolean);

  return rows.length ? rows.join("") : "&nbsp;<br>";
}

function envRows() {
  return Array.from(envList?.querySelectorAll(".env-row") || []);
}

function repeatRows(list, selector) {
  return Array.from(list?.querySelectorAll(selector) || []);
}

function updateRepeatRemoveButtons(rows, removeSelector) {
  rows.forEach((row) => {
    const button = row.querySelector(removeSelector);
    if (button) button.disabled = rows.length === 1;
  });
}

function updateEnvRemoveButtons() {
  envRows().forEach((row) => {
    const button = row.querySelector(".env-remove");
    if (button) button.disabled = false;
  });
}

function updateLabelRemoveButtons() {
  repeatRows(labelList, ".repeat-row").forEach((row) => {
    const button = row.querySelector(".repeat-remove");
    if (button) button.disabled = false;
  });
}

function updatePortRemoveButtons() {
  updateRepeatRemoveButtons(repeatRows(portList, ".repeat-row"), ".repeat-remove");
}

function updateVolumeRemoveButtons() {
  repeatRows(volumeList, ".repeat-row").forEach((row) => {
    const button = row.querySelector(".repeat-remove");
    if (button) button.disabled = false;
  });
}

function addEnvRow(key = "", value = "") {
  if (!envList) return;

  const isFirstRow = envRows().length === 0;
  const row = document.createElement("div");
  row.className = "env-row";
  row.innerHTML = `
    <input type="text" name="var_env_key" placeholder="APP_ENV" aria-label="Environment variable name">
    <input type="text" name="var_env_value" placeholder="production" aria-label="Environment variable value">
    <button type="button" class="icon-btn env-remove" aria-label="Remove environment variable">&times;</button>
  `;

  const keyInput = row.querySelector('[name="var_env_key"]');
  const valueInput = row.querySelector('[name="var_env_value"]');
  if (isFirstRow) {
    keyInput.id = "var_env_key";
    valueInput.id = "var_env_value";
  }
  keyInput.value = key;
  valueInput.value = value;
  envList.appendChild(row);
  updateEnvRemoveButtons();
}

function addLabelRow(key = "", value = "") {
  if (!labelList) return;

  const isFirstRow = repeatRows(labelList, ".repeat-row").length === 0;
  const row = document.createElement("div");
  row.className = "repeat-row";
  row.innerHTML = `
    <input type="text" name="label_key" placeholder="traefik.enable" aria-label="Label key">
    <input type="text" name="label_value" placeholder="true" aria-label="Label value">
    <button type="button" class="icon-btn repeat-remove" aria-label="Remove label">&times;</button>
  `;

  const keyInput = row.querySelector('[name="label_key"]');
  const valueInput = row.querySelector('[name="label_value"]');
  if (isFirstRow) {
    keyInput.id = "label_key";
    valueInput.id = "label_value";
  }
  keyInput.value = key;
  valueInput.value = value;
  labelList.appendChild(row);
  updateLabelRemoveButtons();
}

function addVolumeRow(source = "", name = "") {
  if (!volumeList) return;

  const isFirstRow = repeatRows(volumeList, ".repeat-row").length === 0;
  const row = document.createElement("div");
  row.className = "repeat-row";
  row.innerHTML = `
    <input type="text" name="volume_source" placeholder="/app/data" aria-label="Volume source path">
    <input type="text" name="volume_name" placeholder="instance-data" aria-label="Volume name" readonly>
    <button type="button" class="icon-btn repeat-remove" aria-label="Remove volume">&times;</button>
  `;

  const sourceInput = row.querySelector('[name="volume_source"]');
  const nameInput = row.querySelector('[name="volume_name"]');
  if (isFirstRow) {
    sourceInput.id = "volume_source";
    nameInput.id = "volume_name";
  }
  sourceInput.value = source;
  nameInput.value = name;
  volumeList.appendChild(row);
  syncVolumeNames();
  updateVolumeRemoveButtons();
}

function setPortValue(value = "") {
  setFieldValue("port_value", value);
  updatePortRemoveButtons();
}

function clearEnvRows() {
  envRows().forEach((row) => row.remove());
  updateEnvRemoveButtons();
}

function clearRepeatRows(list, rowSelector, fields, updateButtons) {
  const rows = repeatRows(list, rowSelector);

  rows.slice(1).forEach((row) => row.remove());
  fields.forEach((name) => setFieldValue(name, ""));
  updateButtons();
}

function clearLabelRows() {
  repeatRows(labelList, ".repeat-row").forEach((row) => row.remove());
  updateLabelRemoveButtons();
}

function clearVolumeRows() {
  repeatRows(volumeList, ".repeat-row").forEach((row) => row.remove());
  syncVolumeNames();
  updateVolumeRemoveButtons();
}

function clearPortRows() {
  setPortValue("");
}

function setNotice(message, type = "info", autoClear = true) {
  const notif = document.getElementById("notif");
  if (!notif) return;

  notif.textContent = message;
  notif.className = "notice";

  if (type === "success") {
    notif.style.backgroundColor = "#dcfce7";
    notif.style.borderColor = "#bbf7d0";
    notif.style.color = "#166534";
  } else if (type === "error") {
    notif.style.backgroundColor = "#fee2e2";
    notif.style.borderColor = "#fecaca";
    notif.style.color = "#991b1b";
  } else {
    notif.style.backgroundColor = "#e0f2fe";
    notif.style.borderColor = "#bae6fd";
    notif.style.color = "#075985";
  }

  if (noticeTimeout) clearTimeout(noticeTimeout);

  if (autoClear && message !== "Welcome !") {
    noticeTimeout = setTimeout(() => {
      setNotice("Welcome !", "info", false);
    }, 4000);
  }
}

function setOrderStatus(message, type = "success") {
  if (!orderStatus) return;

  orderStatus.textContent = message;
  orderStatus.className = `order-status ${type}`;
}

function hideOrderActions() {
  orderActions?.classList.add("hidden");
}

function showOrderActions() {
  orderActions?.classList.remove("hidden");
}

function hideOrderLoading() {
  orderLoading?.classList.add("hidden");
}

function setLogsExpanded(expanded) {
  logsCard?.classList.toggle("fullscreen", expanded);

  if (logsFullscreenBtn) {
    logsFullscreenBtn.textContent = expanded ? "×" : "⛶";
    logsFullscreenBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
  }
}

function collapseLogs() {
  setLogsExpanded(false);
}

function setAction(actionName) {
  const config = actions[actionName];
  if (!config) return;

  collapseLogs();

  currentAction = actionName;
  localStorage.setItem("current_action", currentAction);

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  document.getElementById(config.menu)?.classList.add("active");

  form.action = config.endpoint;
  form.method = config.method;

  if (formTitle) formTitle.textContent = config.title;
  if (formDescription) formDescription.textContent = config.description;
  submitBtn.textContent = config.submitLabel;
  submitBtn.className = config.buttonClass;
  submitBtn.name = actionName === "restart" ? "restart_mode" : "";
  submitBtn.value = actionName === "restart" ? "image" : "";

  deleteConfigBtn?.classList.toggle("hidden", actionName !== "config");
  exportConfigBtn?.classList.toggle("hidden", actionName !== "config");
  importConfigBtn?.classList.toggle("hidden", actionName !== "config");
  clearBtn?.classList.toggle("hidden", actionName === "config");
  dockerRunBtn?.classList.toggle("hidden", actionName !== "create");
  templateSelect?.classList.toggle("hidden", actionName !== "create");
  loadTemplateBtn?.classList.toggle("hidden", actionName !== "create");
  orderTemplateBtn?.classList.toggle("hidden", actionName !== "create");
  saveTemplateBtn?.classList.toggle("hidden", actionName !== "create");
  deleteTemplateBtn?.classList.toggle("hidden", actionName !== "create");
  restartInstanceBtn?.classList.toggle("hidden", actionName !== "restart");
  if (restartInstanceBtn) restartInstanceBtn.disabled = actionName !== "restart";
  refreshInstancesBtn?.classList.toggle("hidden", actionName === "create");
  if (refreshInstancesBtn && actionName === "create") refreshInstancesBtn.disabled = true;

  const visibleFields = new Set(config.fields);

  document.querySelectorAll("[data-field]").forEach((wrapper) => {
    const name = wrapper.dataset.field;
    const visible = visibleFields.has(name);
    wrapper.classList.toggle("hidden", !visible);

    wrapper.querySelectorAll("input, select, textarea, button").forEach((control) => {
      control.disabled = !visible;
    });
  });

  if (refreshInstancesBtn && visibleFields.has("instance") && actionName !== "create") {
    refreshInstancesBtn.disabled = false;
  }

  syncCreateNetwork();
  syncCreateVersion();
  ensureRandomCreateInstanceName();
  if (actionName === "create" && imageRecords.length === 0) {
    refreshImages({ notify: false });
  }
  updateEnvRemoveButtons();
  updateLabelRemoveButtons();
  updatePortRemoveButtons();
  updateVolumeRemoveButtons();
  updateRestartButtons();
}

function updateRestartButtons() {
  if (currentAction !== "restart") {
    submitBtn.disabled = false;
    if (restartInstanceBtn) restartInstanceBtn.disabled = true;
    return;
  }

  submitBtn.disabled = false;
  if (restartInstanceBtn) restartInstanceBtn.disabled = false;
}

function clearActionFields() {
  const preserved = new Set(configFields);

  for (const name of allFieldNames) {
    if (preserved.has(name)) continue;
    setFieldValue(name, "");
  }

  clearEnvRows();
  clearLabelRows();
  clearPortRows();
  clearVolumeRows();
  syncCreateNetwork();
  syncCreateVersion();
  ensureRandomCreateInstanceName();
  updateRestartButtons();
  setNotice("Form cleared", "success");
}

function openDockerRunModal() {
  if (!dockerRunModal || !dockerRunInput) return;

  if (currentAction !== "create") setAction("create");
  dockerRunInput.value = "";
  dockerRunModal.classList.remove("hidden");
  dockerRunInput.focus();
}

function closeDockerRunModal() {
  dockerRunModal?.classList.add("hidden");
}

function tokenizeDockerRun(command) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const char of String(command || "").replace(/\\\r?\n/g, " ")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function splitOptionValue(token) {
  const index = token.indexOf("=");
  return index === -1 ? [token, ""] : [token.slice(0, index), token.slice(index + 1)];
}

function splitImageRef(ref) {
  ref = String(ref || "").trim();
  const slashIndex = ref.lastIndexOf("/");
  const colonIndex = ref.lastIndexOf(":");

  if (colonIndex > slashIndex) {
    return {
      image: ref.slice(0, colonIndex),
      version: ref.slice(colonIndex + 1),
    };
  }

  return { image: ref, version: "" };
}

function valueText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    return value.version || value.tag || value.name || value.display || value.label || value.value || "";
  }

  return String(value);
}

function parsePublishPort(value) {
  const port = String(value || "").split(":").pop().replace(/\/.*$/, "");
  return /^\d+$/.test(port) ? port : "";
}

function parseDockerRun(command) {
  const tokens = tokenizeDockerRun(command);
  const parsed = { env: [], labels: [], ports: [], volumes: [] };
  let i = 0;

  if (tokens[i] === "docker") i += 1;
  if (tokens[i] === "run" || tokens[i] === "container") i += 1;
  if (tokens[i] === "run") i += 1;

  while (i < tokens.length) {
    const token = tokens[i];

    if (!token.startsWith("-")) {
      const imageRef = token;
      const imageParts = splitImageRef(imageRef);
      parsed.image = imageParts.image;
      parsed.version = imageParts.version;
      break;
    }

    const [option, inlineValue] = splitOptionValue(token);
    const readValue = () => {
      if (inlineValue) return inlineValue;
      i += 1;
      return tokens[i] || "";
    };

    if (option === "--name") {
      parsed.instance = readValue();
    } else if (option === "--network" || option === "--net") {
      parsed.network = readValue();
    } else if (option === "-e" || option === "--env") {
      const [key, value] = splitOptionValue(readValue());
      if (key) parsed.env.push({ key, value });
    } else if (option === "-l" || option === "--label") {
      const [key, value] = splitOptionValue(readValue());
      if (key) parsed.labels.push({ key, value });
    } else if (option === "-v" || option === "--volume") {
      const parts = readValue().split(":");
      if (parts.length >= 2) {
        parsed.volumes.push({ name: parts[0], source: parts[1] });
      }
    } else if (option === "-p" || option === "--publish") {
      const port = parsePublishPort(readValue());
      if (port && parsed.ports.length === 0) parsed.ports.push({ value: port });
    } else if (option === "--restart" || option === "--hostname" || option === "--user" || option === "-u" || option === "-w" || option === "--workdir" || option === "--entrypoint" || option === "--pull" || option === "--env-file" || option === "--add-host" || option === "--dns") {
      readValue();
    }

    i += 1;
  }

  return parsed;
}

function setRepeatRows(items, clearFn, addFn, selectors) {
  clearFn();

  if (!items.length) return;

  if (!field(selectors.key)) {
    items.forEach((item) => {
      addFn(item.key ?? item.source ?? "", item.value ?? item.name ?? "");
    });
    return;
  }

  const first = items[0];
  setFieldValue(selectors.key, first.key ?? first.source ?? "");
  setFieldValue(selectors.value, first.value ?? first.name ?? "");

  items.slice(1).forEach((item) => {
    addFn(item.key ?? item.source ?? "", item.value ?? item.name ?? "");
  });
}

function repeatValues(list, rowSelector, keyName, valueName) {
  return repeatRows(list, rowSelector)
    .map((row) => ({
      key: row.querySelector(`[name="${keyName}"]`)?.value || "",
      value: row.querySelector(`[name="${valueName}"]`)?.value || "",
    }))
    .filter((item) => item.key || item.value);
}

function portValues() {
  return repeatRows(portList, ".repeat-row")
    .map((row) => ({ value: row.querySelector('[name="port_value"]')?.value || "" }))
    .filter((item) => item.value)
    .slice(0, 1);
}

function volumeValues() {
  return repeatRows(volumeList, ".repeat-row")
    .map((row) => ({ key: row.querySelector('[name="volume_source"]')?.value || "" }))
    .filter((item) => item.key);
}

function currentCreateTemplate() {
  const credentials = selectedProfileCredentials();

  return {
    config_profile: credentials.profile,
    network: fieldValue("network"),
    image: fieldValue("image"),
    version: fieldValue("version"),
    env: repeatValues(envList, ".env-row", "var_env_key", "var_env_value"),
    labels: repeatValues(labelList, ".repeat-row", "label_key", "label_value"),
    ports: portValues(),
    volumes: volumeValues(),
  };
}

function applyCreateTemplate(template) {
  if (!template) return;

  setAction("create");

  const templateProfile = template.config_profile || template.profile || "";
  if (templateProfile && Object.hasOwn(configProfiles, templateProfile)) {
    applyProfileToFields(templateProfile);
    imageRecords = [];
    replaceOptions(imageOptions, []);
    replaceOptions(oldVersionOptions, []);
    replaceOptions(restartVersionOptions, []);
  }

  setFieldValue("network", template.network || fieldValue("network"));
  generatedCreateInstanceName = "";
  setFieldValue("instance", "");
  ensureRandomCreateInstanceName();
  setFieldValue("image", template.image || "");
  syncCreateVersion();
  setRepeatRows(template.env || [], clearEnvRows, addEnvRow, { key: "var_env_key", value: "var_env_value" });
  setRepeatRows(template.labels || [], clearLabelRows, addLabelRow, { key: "label_key", value: "label_value" });
  setPortValue((template.ports || [])[0]?.value || "");
  setRepeatRows(template.volumes || [], clearVolumeRows, addVolumeRow, { key: "volume_source", value: "volume_name" });
}

async function saveCreateTemplate() {
  if (currentAction !== "create") setAction("create");

  const suggested = templateSelect?.value || "";
  const name = (prompt("Template name", suggested) || "").trim();
  if (!name) return;

  const previousTemplates = { ...createTemplates };
  createTemplates[name] = currentCreateTemplate();

  try {
    await persistCreateTemplates();
    updateTemplateOptions(name);
    setNotice(`Template "${name}" saved`, "success");
  } catch {
    createTemplates = previousTemplates;
    localStorage.setItem("create_templates", JSON.stringify(createTemplates));
    updateTemplateOptions();
    setNotice("Template save failed", "error");
  }
}

async function deleteSelectedTemplate() {
  const name = templateSelect?.value || "";
  if (!name || !createTemplates[name]) {
    setNotice("Select a template first", "error");
    return;
  }

  if (!confirm(`Delete template "${name}"?`)) return;

  const previousTemplates = { ...createTemplates };
  delete createTemplates[name];

  try {
    await persistCreateTemplates();
    updateTemplateOptions();
    setNotice(`Template "${name}" deleted`, "success");
  } catch {
    createTemplates = previousTemplates;
    localStorage.setItem("create_templates", JSON.stringify(createTemplates));
    updateTemplateOptions(name);
    setNotice("Template delete failed", "error");
  }
}

async function loadSelectedTemplate() {
  const name = templateSelect?.value || "";
  if (!name || !createTemplates[name]) {
    setNotice("Select a template first", "error");
    return;
  }

  applyCreateTemplate(createTemplates[name]);
  if (fieldValue("image") && !fieldValue("version")) {
    await refreshImages({ notify: false });
    syncCreateVersion();
  }
  setNotice(`Template "${name}" loaded`, "success");
}

function openSelectedTemplateOrder() {
  const name = templateSelect?.value || "";
  if (!name) {
    setNotice("Select a template first", "error");
    return;
  }

  window.location.href = `/order?template=${encodeURIComponent(name)}`;
}

function createTemplateEntry(name) {
  if (!name) return null;
  if (createTemplates[name]) return { name, template: createTemplates[name] };

  const match = Object.keys(createTemplates)
    .find((templateName) => templateName.toLowerCase() === name.toLowerCase());

  return match ? { name: match, template: createTemplates[match] } : null;
}

async function applyOrderTemplate({ reveal = true } = {}) {
  setAction("create");

  const entry = createTemplateEntry(orderTemplateName);
  if (!entry) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Yes";
    hideOrderActions();
    setOrderStatus(orderTemplateName ? `Template "${orderTemplateName}" not found` : "Template is required", "error");
    return false;
  }

  if (reveal) showOrderActions();
  applyCreateTemplate(entry.template);
  setFieldValue("instance", "");
  ensureRandomCreateInstanceName();
  submitBtn.textContent = "Yes";

  if (templateSelect) {
    updateTemplateOptions(entry.name);
  }

  const imagesLoaded = await refreshImages({ notify: false });
  if (imagesLoaded) {
    syncCreateVersion();
  }

  await ensureCreateVersion();

  if (!fieldValue("network")) {
    syncCreateNetwork();
  }

  try {
    const limit = await orderLimitForProfile(selectedProfileCredentials().profile);
    if (limit.reached) {
      hideOrderActions();
      setOrderStatus(`You have reached your maximum of ${limit.max} instance${limit.max === 1 ? "" : "s"} for this config.`, "error");
      return false;
    }
  } catch {
    // The create endpoint enforces the limit; keep the order page usable if this check fails.
  }

  return true;
}

function applyDockerRunCommand() {
  const parsed = parseDockerRun(dockerRunInput?.value || "");
  const currentNetwork = fieldValue("network");

  if (!parsed.image) {
    setNotice("Docker run image is required", "error");
    return;
  }

  if (currentAction !== "create") setAction("create");
  setFieldValue("network", currentNetwork);
  if (parsed.instance) setFieldValue("instance", parsed.instance);
  setFieldValue("image", parsed.image);
  syncCreateVersion();

  setRepeatRows(parsed.env, clearEnvRows, addEnvRow, { key: "var_env_key", value: "var_env_value" });
  setRepeatRows(parsed.labels, clearLabelRows, addLabelRow, { key: "label_key", value: "label_value" });
  setPortValue(parsed.ports[0]?.value || "");
  setRepeatRows(parsed.volumes, clearVolumeRows, addVolumeRow, { key: "volume_source", value: "volume_name" });

  closeDockerRunModal();
  setNotice("Docker run imported", "success");
}

function loadSavedConfig() {
  return fetch("/config", {
    method: "GET",
    headers: { Accept: "application/json" },
  })
    .then((response) => response.json())
    .then((data) => {
      const localProfiles = applyDeletedProfileFilter(storedProfiles());
      if (!data) {
        configProfiles = localProfiles;
        updateProfileOptions();
        applyProfileToFields(currentConfigProfile);
        return {};
      }

      savedConfig = data;
      const serverProfiles = applyDeletedProfileFilter(parseProfiles(data.profiles));
      configProfiles = { ...serverProfiles, ...localProfiles };

      if (data.netbox && data.token) {
        const profile = data.profile || data.config_profile || currentConfigProfile || "";
        if (!deletedProfiles().includes(profile)) {
          configProfiles[profile] = {
            netbox: data.netbox,
            token: data.token,
            proxy: data.proxy || "",
            domain: data.domain || "",
            tag: data.tag || "",
            max_instances: normalizeMaxInstances(data.max_instances),
          };
          currentConfigProfile = localStorage.getItem("current_config_profile") || profile;
        }
      }

      updateProfileOptions();
      applyProfileToFields(currentConfigProfile);
      ensureRandomCreateInstanceName();
      return data;
    })
    .catch(() => {
      configProfiles = applyDeletedProfileFilter(storedProfiles());
      updateProfileOptions();
      applyProfileToFields(currentConfigProfile);
      ensureRandomCreateInstanceName();
      return {};
    });
}

async function test() {
  let { netbox, token, proxy } = selectedProfileCredentials();

  if (!netbox || !token) {
    const config = await loadSavedConfig();
    const credentials = selectedProfileCredentials();
    netbox = netbox || credentials.netbox || config.netbox || "";
    token = token || credentials.token || config.token || "";
    proxy = proxy || credentials.proxy || config.proxy || "";
  }

  if (!netbox || !token) {
    setTestButtonState("error");
    setNotice("Save NetBox URL and token for this profile first", "error");
    return;
  }

  setTestButtonState("default");
  try {
    const response = await fetch("/test", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        netbox,
        token,
        proxy,
      }),
    });

    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text };
    }

    if (response.ok && (data["status"] || data["netbox-version"] || data["netbox-full-version"])) {
      setTestButtonState("success");
      setNotice("Connection successful", "success");
      return;
    }

    const detail = data.detail || data.error || data.message || data.payload || text || `HTTP ${response.status}`;
    setTestButtonState("error");
    setNotice(`Connection failed: ${String(detail).slice(0, 160)}`, "error", false);
  } catch (error) {
    setTestButtonState("error");
    setNotice(`Connection failed: ${error.message || "request error"}`, "error", false);
  }
}

async function saveConfig() {
  const profile = (fieldValue("config_name") || fieldValue("config_profile") || "").trim();
  const netbox = fieldValue("netbox");
  const token = fieldValue("token");
  const proxy = fieldValue("proxy");
  const domain = normalizeDomain(fieldValue("domain"));
  const tag = fieldValue("tag");
  const max_instances = normalizeMaxInstances(fieldValue("max_instances"));

  if (!profile) {
    setNotice("Profile name is required", "error");
    return;
  }

  if (!netbox || !token) {
    setNotice("NetBox URL and token are required", "error");
    return;
  }

  forgetDeletedProfile(profile);
  setFieldValue("max_instances", max_instances);
  configProfiles[profile] = { netbox, token, proxy, domain, tag, max_instances };
  currentConfigProfile = profile;
  updateProfileOptions();
  persistProfiles();

  const params = new URLSearchParams({
    netbox,
    token,
    proxy,
    domain,
    tag,
    max_instances: String(max_instances),
    profile,
    config_profile: profile,
    profiles: JSON.stringify(configProfiles),
  });

  try {
    const response = await fetch(`/webhook?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    savedConfig = { netbox, token, proxy, domain, tag, max_instances, profile, profiles: configProfiles };
    applyProfileToFields(profile);
    setNotice(`Config "${profileLabel(profile)}" saved (${response.status})`, "success");
  } catch {
    setNotice("Config save failed", "error");
  }
}

async function deleteConfig() {
  const profile = (fieldValue("config_profile") || currentConfigProfile || "").trim();

  if (!configProfiles[profile] && !fieldValue("netbox") && !fieldValue("token")) {
    setNotice("No config to delete", "error");
    return;
  }

  if (!confirm(`Delete config "${profileLabel(profile)}"?`)) {
    return;
  }

  delete configProfiles[profile];
  rememberDeletedProfile(profile);
  const remainingProfiles = Object.keys(configProfiles).sort((a, b) => a.localeCompare(b));

  try {
    if (remainingProfiles.length === 0) {
      currentConfigProfile = "";
      savedConfig = {};
      persistProfiles();
      updateProfileOptions();
      setFieldValue("config_name", "");
      setFieldValue("netbox", "");
      setFieldValue("token", "");
      setFieldValue("proxy", "");
      setFieldValue("domain", "");
      setFieldValue("tag", "");
      setFieldValue("max_instances", "1");

      const params = new URLSearchParams({
        netbox: "",
        token: "",
        proxy: "",
        domain: "",
        tag: "",
        max_instances: "1",
        profile: "",
        config_profile: "",
        profiles: "{}",
      });

      const response = await fetch(`/webhook?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      setNotice(`Config "${profileLabel(profile)}" deleted (${response.status})`, "success");
      return;
    }

    currentConfigProfile = remainingProfiles[0];
    persistProfiles();
    updateProfileOptions();
    applyProfileToFields(currentConfigProfile);

    const credentials = profileCredentials(currentConfigProfile);
    const params = new URLSearchParams({
      netbox: credentials.netbox,
      token: credentials.token,
      proxy: credentials.proxy,
      domain: credentials.domain,
      tag: credentials.tag,
      max_instances: String(credentials.max_instances),
      profile: currentConfigProfile,
      config_profile: currentConfigProfile,
      profiles: JSON.stringify(configProfiles),
    });

    const response = await fetch(`/webhook?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    savedConfig = { ...credentials, profiles: configProfiles };
    updateProfileOptions();
    applyProfileToFields(currentConfigProfile);
    setNotice(`Config "${profileLabel(profile)}" deleted (${response.status})`, "success");
  } catch {
    setNotice("Config delete failed", "error");
  }
}

async function submitAction(config, submitter) {
  syncVolumeNames();

  const body = new URLSearchParams(new FormData(form));
  const credentials = selectedProfileCredentials();
  let createdInstanceFqdn = "";

  if (!credentials.netbox || !credentials.token) {
    setNotice("Save NetBox URL and token for this profile first", "error");
    return;
  }

  body.set("netbox", credentials.netbox);
  body.set("token", credentials.token);
  body.set("proxy", credentials.proxy);
  body.set("domain", credentials.domain);
  body.set("tag", credentials.tag);
  body.set("max_instances", String(credentials.max_instances));
  body.set("profile", credentials.profile);
  if (isOrderPage) body.set("order_request", "true");

  if (currentAction === "create") {
    const fqdn = instanceFqdn(body.get("instance"), credentials.domain);
    body.set("instance", fqdn);
    setFieldValue("instance", fqdn);
    createdInstanceFqdn = fqdn;
  }

  if (submitter?.name) {
    body.set(submitter.name, submitter.value);
  }

  const request = {
    method: config.method.toUpperCase(),
    headers: { Accept: "application/json" },
  };

  if (request.method !== "GET") {
    request.headers["Content-Type"] = "application/x-www-form-urlencoded";
    request.body = body.toString();
  }

  if (!isOrderPage) {
    await clearLogs({ notify: false });
  }

  const endpoint = request.method === "GET" ? `${config.endpoint}?${body.toString()}` : config.endpoint;
  if (isOrderPage) submitBtn.disabled = true;

  const response = await fetch(endpoint, request);
  if (isOrderPage) {
    if (response.status === 202) {
      hideOrderActions();
      setOrderStatus(`Thank you, your instance installation has been requested for ${createdInstanceFqdn}.`, "success");
    } else {
      const text = await response.text();
      let detail = "";

      try {
        const data = text ? JSON.parse(text) : {};
        detail = data.detail || data.error || data.message || "";
      } catch {
        detail = text;
      }

      submitBtn.disabled = false;
      setOrderStatus(detail || `Installation request failed (${response.status})`, "error");
    }
    return;
  }

  const type = response.ok ? "success" : "error";
  const result = response.ok ? "requested" : "failed";

  setNotice(`${config.title} ${result} (${response.status})`, type);
}

function instanceNameFromItem(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";

  return item.instance || item.display || item.name || "";
}

async function refreshInstances() {
  if (!instanceOptions || !refreshInstancesBtn) return;
  const query = credentialsQuery({ includeTag: shouldFilterRefreshByTag() });

  if (!query) {
    setNotice("Save NetBox URL and token for this profile first", "error");
    return;
  }

  if (currentAction === "delete" || currentAction === "restart") {
    setFieldValue("instance", "");
    updateRestartButtons();
  }

  refreshInstancesBtn.disabled = true;

  try {
    const response = await fetch(`/instances?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    const instances = Array.from(new Set((Array.isArray(data) ? data : [])
      .map(instanceNameFromItem)
      .filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));

    instanceOptions.replaceChildren(...instances.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      return option;
    }));

    setNotice(`Loaded ${instances.length} instances`, "success");
  } catch {
    setNotice("Instance refresh failed", "error");
  } finally {
    refreshInstancesBtn.disabled = false;
  }
}

function imageNameFromItem(item) {
  if (typeof item === "string") return splitImageRef(item).image;
  if (!item || typeof item !== "object") return "";

  const name = valueText(item.name);
  if (name) return splitImageRef(name).image;

  return splitImageRef(valueText(item.display)).image || "";
}

function imageVersionFromItem(item) {
  if (typeof item === "string") return splitImageRef(item).version;
  if (!item || typeof item !== "object") return "";

  return valueText(item.version)
    || valueText(item.tag)
    || splitImageRef(valueText(item.display)).version
    || splitImageRef(valueText(item.name)).version
    || "";
}

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^[^\d]*/, "");
}

function compareVersionsDesc(left, right) {
  const leftParts = normalizeVersion(left).split(/[^\d]+/).filter(Boolean).map(Number);
  const rightParts = normalizeVersion(right).split(/[^\d]+/).filter(Boolean).map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (rightParts[index] || 0) - (leftParts[index] || 0);
    if (diff) return diff;
  }

  return right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" });
}

function replaceOptions(datalist, values) {
  if (!datalist) return;

  datalist.replaceChildren(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    return option;
  }));
}

function updateOldVersionOptions() {
  const image = fieldValue("image");
  const versions = versionsForImage(image);

  const restartVersion = field("restart_version");
  if (restartVersion?.value && !versions.includes(restartVersion.value)) {
    restartVersion.value = "";
  }

  replaceOptions(oldVersionOptions, versions);
  replaceOptions(restartVersionOptions, versions);
  syncCreateVersion();
  updateRestartButtons();
  updateSelectedVersionContainerNotice();
}

function versionsForImage(image) {
  const imageRef = splitImageRef(image);
  const requestedImage = imageRef.image;
  if (imageRef.version) return [imageRef.version];

  return Array.from(new Set(imageRecords
    .filter((item) => imageNameFromItem(item) === requestedImage)
    .map(imageVersionFromItem)
    .filter(Boolean)))
    .sort(compareVersionsDesc);
}

function highestVersionForImage(image = fieldValue("image")) {
  return versionsForImage(image)[0] || "";
}

function syncCreateVersion() {
  const version = field("version");
  if (!version) return;

  version.readOnly = currentAction === "create";
  if (currentAction !== "create") return;

  setFieldValue("version", highestVersionForImage());
}

async function ensureCreateVersion() {
  if (currentAction !== "create" || !fieldValue("image") || fieldValue("version")) return;

  syncCreateVersion();
  if (fieldValue("version")) return;

  if (imageRecords.length === 0 || !fieldValue("version")) {
    await refreshImages({ notify: false });
    syncCreateVersion();
  }
}

function selectedVersionForCount() {
  if (currentAction === "recreate") return fieldValue("oldversion");
  if (currentAction === "restart") return fieldValue("restart_version");
  return "";
}

async function updateSelectedVersionContainerNotice() {
  if (currentAction !== "recreate" && currentAction !== "restart") return;

  const image = fieldValue("image");
  const version = selectedVersionForCount();
  const requestId = ++containerCountRequestId;

  if (!image || !version) return;

  const query = credentialsQuery({ includeTag: shouldFilterRefreshByTag() });
  if (!query) return;

  query.set("image", image);
  query.set("version", version);

  try {
    const response = await fetch(`/containers-count?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    if (requestId !== containerCountRequestId) return;

    const count = Number(data.count || 0);
    const label = count === 1 ? "container uses" : "containers use";
    setNotice(`${count} ${label} ${image}:${version}`, "info", false);
  } catch {
    if (requestId === containerCountRequestId) {
      setNotice("Container count failed", "error");
    }
  }
}

async function refreshImages({ notify = true } = {}) {
  if (!imageOptions || !refreshImagesBtn) return;
  const query = credentialsQuery({ includeTag: shouldFilterRefreshByTag() });

  if (!query) {
    if (notify) setNotice("Save NetBox URL and token for this profile first", "error");
    return false;
  }

  if (currentAction === "recreate" || currentAction === "restart") {
    setFieldValue("image", "");
    setFieldValue("oldversion", "");
    setFieldValue("restart_version", "");
    updateRestartButtons();
  }

  refreshImagesBtn.disabled = true;

  try {
    const response = await fetch(`/images?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    imageRecords = Array.isArray(data) ? data : [];

    const images = Array.from(new Set(imageRecords
      .map(imageNameFromItem)
      .filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));

    replaceOptions(imageOptions, images);
    updateOldVersionOptions();
    if (notify) setNotice(`Loaded ${images.length} images`, "success");
    return true;
  } catch {
    if (notify) setNotice("Image refresh failed", "error");
    return false;
  } finally {
    refreshImagesBtn.disabled = false;
  }
}

async function getLogs() {
  try {
    const response = await fetch("logs");
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const logs = await response.text();
    if (logsPollFailed) {
      logsPollFailed = false;
      const notif = document.getElementById("notif");
      if (notif?.textContent === logsPollFailureNotice) setNotice("Welcome !", "info", false);
    }
    if (logs !== lastLogsHtml) {
      lastLogsHtml = logs;
      document.getElementById("logs").innerHTML = formatLogs(logs);
    }
  } catch (err) {
    console.error("Error fetching logs:", err);
    if (!logsPollFailed) {
      logsPollFailed = true;
      setNotice(logsPollFailureNotice, "error", false);
    }
  }
}

async function clearLogs({ notify = true } = {}) {
  try {
    const response = await fetch("/logs", {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    lastLogsHtml = "";
    document.getElementById("logs").innerHTML = "&nbsp;<br>";
    if (notify) setNotice(`Logs cleared (${response.status})`, "success");
    return true;
  } catch {
    if (notify) setNotice("Clear logs failed", "error");
    return false;
  }
}

document.querySelectorAll("[data-action]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setAction(link.dataset.action);
  });
});

envList?.addEventListener("click", (event) => {
  const button = event.target.closest(".env-remove");
  if (!button || button.disabled) return;

  button.closest(".env-row")?.remove();
  updateEnvRemoveButtons();
});

addEnvBtn?.addEventListener("click", () => {
  addEnvRow();
  envRows().at(-1)?.querySelector("input")?.focus();
});

labelList?.addEventListener("click", (event) => {
  const button = event.target.closest(".repeat-remove");
  if (!button || button.disabled) return;

  button.closest(".repeat-row")?.remove();
  updateLabelRemoveButtons();
});

addLabelBtn?.addEventListener("click", () => {
  addLabelRow();
  repeatRows(labelList, ".repeat-row").at(-1)?.querySelector("input")?.focus();
});

volumeList?.addEventListener("click", (event) => {
  const button = event.target.closest(".repeat-remove");
  if (!button || button.disabled) return;

  button.closest(".repeat-row")?.remove();
  syncVolumeNames();
  updateVolumeRemoveButtons();
});

volumeList?.addEventListener("input", (event) => {
  if (event.target.matches('[name="volume_source"]')) syncVolumeNames();
});

addVolumeBtn?.addEventListener("click", () => {
  addVolumeRow();
  repeatRows(volumeList, ".repeat-row").at(-1)?.querySelector("input")?.focus();
});

form.addEventListener("submit", async (event) => {
  const config = actions[currentAction];
  event.preventDefault();

  if (currentAction === "config") {
    saveConfig();
    return;
  }

  if (currentAction === "restart" && event.submitter?.value === "instance" && !fieldValue("instance")) {
    setNotice("Instance name is required", "error");
    return;
  }

  if (currentAction === "restart" && event.submitter?.value === "image") {
    if (!fieldValue("image")) {
      setNotice("Image name is required", "error");
      return;
    }

    if (!fieldValue("restart_version")) {
      setNotice("Version is required", "error");
      return;
    }
  }

  if (currentAction === "create" && !fieldValue("network")) {
    setNotice("Network is required", "error");
    return;
  }

  if (currentAction === "create" && !fieldValue("image")) {
    setNotice("Image name is required", "error");
    return;
  }

  if (currentAction === "create" && !fieldValue("port_value")) {
    setNotice("Service port is required", "error");
    return;
  }

  if (currentAction === "create" && !isFqdn(instanceFqdn(fieldValue("instance"), selectedProfileCredentials().domain))) {
    setNotice("Instance name must be a fully qualified domain name", "error");
    return;
  }

  if (currentAction === "create" && !fieldValue("version")) {
    await ensureCreateVersion();

    if (!fieldValue("version")) {
      setNotice("Version not found for this image", "error");
      return;
    }
  }

  if (config?.confirm && !confirm(config.confirm)) {
    return;
  }

  submitAction(config, event.submitter).catch(() => {
    if (isOrderPage) {
      submitBtn.disabled = false;
      setOrderStatus("Installation request failed", "error");
      return;
    }

    setNotice(`${config.title} failed`, "error");
  });
});

testBtn?.addEventListener("click", test);
deleteConfigBtn?.addEventListener("click", deleteConfig);
exportConfigBtn?.addEventListener("click", exportPortableConfig);
importConfigBtn?.addEventListener("click", importPortableConfigFile);
importConfigFile?.addEventListener("change", importPortableConfig);
clearBtn?.addEventListener("click", clearActionFields);
dockerRunBtn?.addEventListener("click", openDockerRunModal);
saveTemplateBtn?.addEventListener("click", saveCreateTemplate);
deleteTemplateBtn?.addEventListener("click", deleteSelectedTemplate);
loadTemplateBtn?.addEventListener("click", loadSelectedTemplate);
orderTemplateBtn?.addEventListener("click", openSelectedTemplateOrder);
logoutBtn?.addEventListener("click", logoutFromProxy);
templateSelect?.addEventListener("change", () => {
  if (loadTemplateBtn) loadTemplateBtn.disabled = !templateSelect.value;
  if (orderTemplateBtn) orderTemplateBtn.disabled = !templateSelect.value;
  if (deleteTemplateBtn) deleteTemplateBtn.disabled = !templateSelect.value;
  if (templateSelect.value) loadSelectedTemplate();
});
dockerRunApplyBtn?.addEventListener("click", applyDockerRunCommand);
dockerRunCancelBtn?.addEventListener("click", closeDockerRunModal);
dockerRunCloseBtn?.addEventListener("click", closeDockerRunModal);
dockerRunModal?.addEventListener("click", (event) => {
  if (event.target === dockerRunModal) closeDockerRunModal();
});
refreshInstancesBtn?.addEventListener("click", refreshInstances);
refreshImagesBtn?.addEventListener("click", refreshImages);
configProfileSelect?.addEventListener("change", () => {
  applyProfileToFields(configProfileSelect.value);
  ensureRandomCreateInstanceName();
  imageRecords = [];
  setFieldValue("image", "");
  setFieldValue("version", "");
  replaceOptions(imageOptions, []);
  replaceOptions(oldVersionOptions, []);
  replaceOptions(restartVersionOptions, []);
  syncCreateVersion();

  if (currentAction === "create") {
    refreshImages({ notify: false });
  }
});
field("image")?.addEventListener("input", updateOldVersionOptions);
field("image")?.addEventListener("change", updateOldVersionOptions);
field("image")?.addEventListener("change", () => {
  ensureCreateVersion();
});
field("oldversion")?.addEventListener("input", updateSelectedVersionContainerNotice);
field("restart_version")?.addEventListener("input", updateRestartButtons);
field("restart_version")?.addEventListener("input", updateSelectedVersionContainerNotice);
field("instance")?.addEventListener("input", () => {
  updateRestartButtons();
  syncVolumeNames();
});
logsFullscreenBtn?.addEventListener("click", () => {
  setLogsExpanded(!logsCard?.classList.contains("fullscreen"));
});
clearLogsBtn?.addEventListener("click", clearLogs);
orderCancelBtn?.addEventListener("click", () => {
  window.location.href = "/";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dockerRunModal?.classList.contains("hidden")) {
    closeDockerRunModal();
  }
});

window.parseDockerRun = parseDockerRun;
window.isFqdn = isFqdn;
window.instanceFqdn = instanceFqdn;

async function initializePage() {
  await loadCreateTemplates();
  updateTemplateOptions();
  setAction(currentAction);
  await loadSavedConfig();

  if (isOrderPage) {
    hideOrderActions();
    const orderReady = await applyOrderTemplate({ reveal: false });
    await loadAuthUser();
    hideOrderLoading();
    if (orderReady) showOrderActions();
  } else if (actionFromUrl) {
    setNotice(actionFromUrl, "success");

    const actionKey = actionFromUrl.split(" ")[0].toLowerCase();
    if (actions[actionKey]) setAction(actionKey);

    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState(window.history.state, "", cleanUrl);
  }

  if (!isOrderPage) loadAuthUser();

  if (!isOrderPage) {
    getLogs();
    setInterval(getLogs, 3000);
  }
}

initializePage();
