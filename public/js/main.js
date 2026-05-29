const urlParams = new URLSearchParams(window.location.search);
const actionFromUrl = urlParams.get("action");

const form = document.getElementById("instanceForm");
const submitBtn = document.getElementById("submitBtn");
const restartInstanceBtn = document.getElementById("restartInstanceBtn");
const testBtn = document.getElementById("testBtn");
const deleteConfigBtn = document.getElementById("deleteConfigBtn");
const clearBtn = document.getElementById("clearBtn");
const formTitle = document.getElementById("form-title");
const formDescription = document.getElementById("form-description");
const envList = document.getElementById("envList");
const addEnvBtn = document.getElementById("addEnvBtn");
const labelList = document.getElementById("labelList");
const addLabelBtn = document.getElementById("addLabelBtn");
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

let currentAction = localStorage.getItem("current_action") || "config";
let currentConfigProfile = localStorage.getItem("current_config_profile") || "";
let noticeTimeout = null;
let savedConfig = {};
let configProfiles = {};
let imageRecords = [];
let containerCountRequestId = 0;
let lastLogsHtml = "";

const configFields = ["config_profile", "config_name", "netbox", "token", "proxy", "tag"];

const actions = {
  config: {
    endpoint: "/webhook",
    method: "get",
    menu: "menu_config",
    title: "Config",
    description: "Save the NetBox URL, token, optional proxy and optional host tag used by the automation.",
    submitLabel: "Save config",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "config_name", "netbox", "token", "proxy", "tag"],
  },
  create: {
    endpoint: "/create",
    method: "post",
    menu: "menu_create",
    title: "Create instance",
    description: "Create a container, volume, DNS record and Traefik labels.",
    submitLabel: "Create instance",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "hostname", "network", "instance", "image", "version", "env_vars", "labels", "volumes"],
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
    confirm: "Refresh all Docker hosts for this config?",
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
  "tag",
  "config_profile",
  "config_name",
  "hostname",
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

function setFieldValue(name, value = "") {
  const el = field(name);
  if (!el) return;

  if (el.type === "checkbox") {
    el.checked = Boolean(value);
    return;
  }

  el.value = value || "";
}

function profileLabel(name) {
  return name || "No config saved";
}

function parseProfiles(value) {
  if (!value) return {};

  if (typeof value === "object") return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function storedProfiles() {
  return parseProfiles(localStorage.getItem("config_profiles"));
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
    tag: profile.tag || "",
  };
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
  setFieldValue("tag", credentials.tag);
  persistProfiles();
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
  return currentAction === "recreate" || currentAction === "restart";
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
  updateRepeatRemoveButtons(envRows(), ".env-remove");
}

function updateLabelRemoveButtons() {
  updateRepeatRemoveButtons(repeatRows(labelList, ".repeat-row"), ".repeat-remove");
}

function updateVolumeRemoveButtons() {
  updateRepeatRemoveButtons(repeatRows(volumeList, ".repeat-row"), ".repeat-remove");
}

function addEnvRow(key = "", value = "") {
  if (!envList) return;

  const row = document.createElement("div");
  row.className = "env-row";
  row.innerHTML = `
    <input type="text" name="var_env_key" placeholder="APP_ENV" aria-label="Environment variable name">
    <input type="text" name="var_env_value" placeholder="production" aria-label="Environment variable value">
    <button type="button" class="icon-btn env-remove" aria-label="Remove environment variable">&times;</button>
  `;

  row.querySelector('[name="var_env_key"]').value = key;
  row.querySelector('[name="var_env_value"]').value = value;
  envList.appendChild(row);
  updateEnvRemoveButtons();
}

function addLabelRow(key = "", value = "") {
  if (!labelList) return;

  const row = document.createElement("div");
  row.className = "repeat-row";
  row.innerHTML = `
    <input type="text" name="label_key" placeholder="traefik.enable" aria-label="Label key">
    <input type="text" name="label_value" placeholder="true" aria-label="Label value">
    <button type="button" class="icon-btn repeat-remove" aria-label="Remove label">&times;</button>
  `;

  row.querySelector('[name="label_key"]').value = key;
  row.querySelector('[name="label_value"]').value = value;
  labelList.appendChild(row);
  updateLabelRemoveButtons();
}

function addVolumeRow(source = "", name = "") {
  if (!volumeList) return;

  const row = document.createElement("div");
  row.className = "repeat-row";
  row.innerHTML = `
    <input type="text" name="volume_source" placeholder="/app/data" aria-label="Volume source path">
    <input type="text" name="volume_name" placeholder="instance-data" aria-label="Volume name">
    <button type="button" class="icon-btn repeat-remove" aria-label="Remove volume">&times;</button>
  `;

  row.querySelector('[name="volume_source"]').value = source;
  row.querySelector('[name="volume_name"]').value = name;
  volumeList.appendChild(row);
  updateVolumeRemoveButtons();
}

function clearEnvRows() {
  const rows = envRows();

  rows.slice(1).forEach((row) => row.remove());
  setFieldValue("var_env_key", "");
  setFieldValue("var_env_value", "");
  updateEnvRemoveButtons();
}

function clearRepeatRows(list, rowSelector, fields, updateButtons) {
  const rows = repeatRows(list, rowSelector);

  rows.slice(1).forEach((row) => row.remove());
  fields.forEach((name) => setFieldValue(name, ""));
  updateButtons();
}

function clearLabelRows() {
  clearRepeatRows(labelList, ".repeat-row", ["label_key", "label_value"], updateLabelRemoveButtons);
}

function clearVolumeRows() {
  clearRepeatRows(volumeList, ".repeat-row", ["volume_source", "volume_name"], updateVolumeRemoveButtons);
}

function setNotice(message, type = "info", autoClear = true) {
  const notif = document.getElementById("notif");
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

function setAction(actionName) {
  const config = actions[actionName];
  if (!config) return;

  currentAction = actionName;
  localStorage.setItem("current_action", currentAction);

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  document.getElementById(config.menu)?.classList.add("active");

  form.action = config.endpoint;
  form.method = config.method;

  formTitle.textContent = config.title;
  formDescription.textContent = config.description;
  submitBtn.textContent = config.submitLabel;
  submitBtn.className = config.buttonClass;
  submitBtn.name = actionName === "restart" ? "restart_mode" : "";
  submitBtn.value = actionName === "restart" ? "image" : "";

  deleteConfigBtn?.classList.toggle("hidden", actionName !== "config");
  clearBtn?.classList.toggle("hidden", actionName === "config");
  restartInstanceBtn?.classList.toggle("hidden", actionName !== "restart");
  if (restartInstanceBtn) restartInstanceBtn.disabled = actionName !== "restart";

  const visibleFields = new Set(config.fields);

  document.querySelectorAll("[data-field]").forEach((wrapper) => {
    const name = wrapper.dataset.field;
    const visible = visibleFields.has(name);
    wrapper.classList.toggle("hidden", !visible);

    wrapper.querySelectorAll("input, select, textarea, button").forEach((control) => {
      control.disabled = !visible;
    });
  });

  updateEnvRemoveButtons();
  updateLabelRemoveButtons();
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
  clearVolumeRows();
  updateRestartButtons();
  setNotice("Form cleared", "success");
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
            tag: data.tag || "",
          };
          currentConfigProfile = localStorage.getItem("current_config_profile") || profile;
        }
      }

      updateProfileOptions();
      applyProfileToFields(currentConfigProfile);
      return data;
    })
    .catch(() => {
      configProfiles = applyDeletedProfileFilter(storedProfiles());
      updateProfileOptions();
      applyProfileToFields(currentConfigProfile);
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
  const tag = fieldValue("tag");

  if (!profile) {
    setNotice("Profile name is required", "error");
    return;
  }

  if (!netbox || !token) {
    setNotice("NetBox URL and token are required", "error");
    return;
  }

  forgetDeletedProfile(profile);
  configProfiles[profile] = { netbox, token, proxy, tag };
  currentConfigProfile = profile;
  updateProfileOptions();
  persistProfiles();

  const params = new URLSearchParams({
    netbox,
    token,
    proxy,
    tag,
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

    savedConfig = { netbox, token, proxy, tag, profile, profiles: configProfiles };
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
      setFieldValue("tag", "");

      const params = new URLSearchParams({
        netbox: "",
        token: "",
        proxy: "",
        tag: "",
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
      tag: credentials.tag,
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
  const body = new URLSearchParams(new FormData(form));
  const credentials = selectedProfileCredentials();

  if (!credentials.netbox || !credentials.token) {
    setNotice("Save NetBox URL and token for this profile first", "error");
    return;
  }

  body.set("netbox", credentials.netbox);
  body.set("token", credentials.token);
  body.set("proxy", credentials.proxy);
  body.set("tag", credentials.tag);
  body.set("profile", credentials.profile);

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

  const endpoint = request.method === "GET" ? `${config.endpoint}?${body.toString()}` : config.endpoint;
  const response = await fetch(endpoint, request);
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
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";

  return item.name || item.display || "";
}

function imageVersionFromItem(item) {
  if (!item || typeof item !== "object") return "";
  return item.version || "";
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
  const versions = Array.from(new Set(imageRecords
    .filter((item) => imageNameFromItem(item) === image)
    .map(imageVersionFromItem)
    .filter(Boolean)))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  const restartVersion = field("restart_version");
  if (restartVersion?.value && !versions.includes(restartVersion.value)) {
    restartVersion.value = "";
  }

  replaceOptions(oldVersionOptions, versions);
  replaceOptions(restartVersionOptions, versions);
  updateRestartButtons();
  updateSelectedVersionContainerNotice();
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

async function refreshImages() {
  if (!imageOptions || !refreshImagesBtn) return;
  const query = credentialsQuery({ includeTag: shouldFilterRefreshByTag() });

  if (!query) {
    setNotice("Save NetBox URL and token for this profile first", "error");
    return;
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
    setNotice(`Loaded ${images.length} images`, "success");
  } catch {
    setNotice("Image refresh failed", "error");
  } finally {
    refreshImagesBtn.disabled = false;
  }
}

async function getLogs() {
  try {
    const response = await fetch("logs");
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const logs = await response.text();
    if (logs !== lastLogsHtml) {
      lastLogsHtml = logs;
      document.getElementById("logs").innerHTML = formatLogs(logs);
    }
  } catch (err) {
    console.error("Error fetching logs:", err);
  }
}

async function clearLogs() {
  try {
    const response = await fetch("/logs", {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    lastLogsHtml = "";
    document.getElementById("logs").innerHTML = "&nbsp;<br>";
    setNotice(`Logs cleared (${response.status})`, "success");
  } catch {
    setNotice("Clear logs failed", "error");
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
  updateVolumeRemoveButtons();
});

addVolumeBtn?.addEventListener("click", () => {
  addVolumeRow();
  repeatRows(volumeList, ".repeat-row").at(-1)?.querySelector("input")?.focus();
});

form.addEventListener("submit", (event) => {
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

  if (config?.confirm && !confirm(config.confirm)) {
    return;
  }

  submitAction(config, event.submitter).catch(() => {
    setNotice(`${config.title} failed`, "error");
  });
});

testBtn?.addEventListener("click", test);
deleteConfigBtn?.addEventListener("click", deleteConfig);
clearBtn?.addEventListener("click", clearActionFields);
refreshInstancesBtn?.addEventListener("click", refreshInstances);
refreshImagesBtn?.addEventListener("click", refreshImages);
configProfileSelect?.addEventListener("change", () => {
  applyProfileToFields(configProfileSelect.value);
  imageRecords = [];
  replaceOptions(imageOptions, []);
  replaceOptions(oldVersionOptions, []);
  replaceOptions(restartVersionOptions, []);
});
field("image")?.addEventListener("input", updateOldVersionOptions);
field("oldversion")?.addEventListener("input", updateSelectedVersionContainerNotice);
field("restart_version")?.addEventListener("input", updateRestartButtons);
field("restart_version")?.addEventListener("input", updateSelectedVersionContainerNotice);
field("instance")?.addEventListener("input", updateRestartButtons);
logsFullscreenBtn?.addEventListener("click", () => {
  const expanded = logsCard?.classList.toggle("fullscreen");
  if (logsFullscreenBtn) {
    logsFullscreenBtn.textContent = expanded ? "×" : "⛶";
    logsFullscreenBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
  }
});
clearLogsBtn?.addEventListener("click", clearLogs);

if (actionFromUrl) {
  setNotice(actionFromUrl, "success");

  const actionKey = actionFromUrl.split(" ")[0].toLowerCase();
  if (actions[actionKey]) setAction(actionKey);

  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState(window.history.state, "", cleanUrl);
}

setAction(currentAction);
loadSavedConfig();

getLogs();
setInterval(getLogs, 3000);
