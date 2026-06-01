const urlParams = new URLSearchParams(window.location.search);
const actionFromUrl = urlParams.get("action");
const isOrderPage = document.body?.classList.contains("order-page");
const orderTemplateName = urlParams.get("template") || "";

const form = document.getElementById("instanceForm");
const appShell = document.querySelector(".app-shell");
const sidebarToggle = document.getElementById("sidebarToggle");
const formCard = document.querySelector(".form-card");
const submitBtn = document.getElementById("submitBtn");
const restartInstanceBtn = document.getElementById("restartInstanceBtn");
const testBtn = document.getElementById("testBtn");
const testEmailBtn = document.getElementById("testEmailBtn");
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
const dockerComposeInput = document.getElementById("dockerComposeInput");
const importProfileSelect = document.getElementById("importProfileSelect");
const createWorkflowInput = document.getElementById("createWorkflowInput");
const dockerRunApplyBtn = document.getElementById("dockerRunApplyBtn");
const dockerRunCancelBtn = document.getElementById("dockerRunCancelBtn");
const dockerRunCloseBtn = document.getElementById("dockerRunCloseBtn");
const importTabButtons = [...document.querySelectorAll("[data-import-tab]")];
const importPanels = [...document.querySelectorAll("[data-import-panel]")];
const profileHelpModal = document.getElementById("profileHelpModal");
const profileHelpTitle = document.getElementById("profileHelpTitle");
const profileHelpBody = document.getElementById("profileHelpBody");
const profileHelpCloseBtn = document.getElementById("profileHelpCloseBtn");
const profileHelpOkBtn = document.getElementById("profileHelpOkBtn");
const formTitle = document.getElementById("form-title");
const formDescription = document.getElementById("form-description");
const tokenToggle = document.getElementById("tokenToggle");
const profileDockerhubSecret = document.getElementById("dockerhub_webhook_secret");
const profileDockerhubSecretToggle = document.getElementById("profileDockerhubSecretToggle");
const smtpConfigToggle = document.getElementById("smtpConfigToggle");
const envList = document.getElementById("envList");
const addEnvBtn = document.getElementById("addEnvBtn");
const labelList = document.getElementById("labelList");
const addLabelBtn = document.getElementById("addLabelBtn");
const portList = document.getElementById("portList");
const volumeList = document.getElementById("volumeList");
const addVolumeBtn = document.getElementById("addVolumeBtn");
const bindList = document.getElementById("bindList");
const addBindBtn = document.getElementById("addBindBtn");
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
const profileSyncWarning = document.getElementById("profileSyncWarning");
const orderActions = document.getElementById("orderActions");
const orderLoading = document.getElementById("orderLoading");
const orderStatus = document.getElementById("orderStatus");
const orderInstances = document.getElementById("orderInstances");
const authUser = document.getElementById("authUser");
const authAvatar = document.getElementById("authAvatar");
const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const logoutBtn = document.getElementById("logoutBtn");
const reportCard = document.getElementById("reportCard");
const reportProfileSelect = document.getElementById("reportProfileSelect");
const refreshReportBtn = document.getElementById("refreshReportBtn");
const reportSummary = document.getElementById("reportSummary");
const reportTableHead = document.getElementById("reportTableHead");
const reportTableBody = document.getElementById("reportTableBody");
const reportViewButtons = Array.from(document.querySelectorAll("[data-report-view]"));
const workflowCard = document.getElementById("workflowCard");
const workflowSelect = document.getElementById("workflowSelect");
const workflowSummary = document.getElementById("workflowSummary");
const workflowTableBody = document.getElementById("workflowTableBody");
const runWorkflowBtn = document.getElementById("runWorkflowBtn");
const deleteWorkflowBtn = document.getElementById("deleteWorkflowBtn");

let currentAction = isOrderPage ? "create" : (localStorage.getItem("current_action") || "config");
let currentConfigProfile = localStorage.getItem("current_config_profile") || "";
let noticeTimeout = null;
let savedConfig = {};
let configProfiles = {};
let serverConfigProfiles = {};
let imageRecords = [];
let containerCountRequestId = 0;
let createNetworkRequestId = 0;
let lastLogsHtml = "";
let logsPollFailed = false;
let createTemplates = {};
let createWorkflows = {};
let workflowStepStatuses = {};
let generatedCreateInstanceName = "";
let generatedCreateDnsName = "";
let orderInstanceCards = [];
let orderInstanceLimit = { max: 0, used: 0 };
const orderDeletingInstances = new Set();
let currentReportView = "images";
let lastReportData = null;
let orderStatusPollTimer = null;
let mailSettings = { owner_email_configured: false };
let dockerhubWebhookDefaultSecret = "";
let dockerhubWebhookDefaultLoaded = false;
let currentImportTab = "run";
let templateVersionOverride = "";
let templateNetworkOverride = "";
const logsPollFailureNotice = "Activity logs unavailable: network error";
const sidebarCollapsedStorageKey = "sidebar_collapsed";

const profileFieldHelp = {
  config_profile: {
    title: "Config profile",
    body: "Selects which saved NetBox connection and deployment defaults are used by create, upgrade, refresh, operate and delete actions.",
  },
  config_name: {
    title: "Profile name",
    body: "Names the profile you are saving. Use a stable name such as production, staging or a customer identifier.",
  },
  customer_name: {
    title: "Customer name",
    body: "Stores the customer or organization name shown in exported configuration and shared profile data.",
  },
  netbox: {
    title: "NetBox URL",
    body: "The base URL of the NetBox instance that stores Docker hosts, images, containers, volumes and Cloudflare DNS records.",
  },
  token: {
    title: "NetBox Token",
    body: "The API token used to read and update NetBox data for this profile. v1 tokens and v2 nbt_ tokens are both supported.",
  },
  proxy: {
    title: "Proxy URL",
    body: "Optional HTTP proxy used by the server when it connects to NetBox. Leave it empty when direct access is available.",
  },
  domain: {
    title: "Domain",
    body: "The default domain appended to short instance names during creation. For example, tiles becomes tiles.example.com.",
  },
  tag: {
    title: "Tag",
    body: "Filters Docker hosts and image lookups to the matching NetBox tag, so each profile can target a specific environment or host group.",
  },
  max_instances: {
    title: "Max instances",
    body: "Limits how many order-page instances a user can request for this profile. Set it to 0 to block new orders for the profile.",
  },
  owner_env_var: {
    title: "Owner env var",
    body: "The environment variable name used to store the requester email on newly created containers. The default is SAASHUP_OWNER.",
  },
  cloudflare_filter: {
    title: "Cloudflare IP restriction",
    body: "When enabled, created containers receive the Traefik IP allow-list label for Cloudflare source ranges. Disable it to create routes without that allow-list label.",
  },
  dockerhub_webhook_secret: {
    title: "Docker Hub webhook password",
    body: "Optional profile-specific password for Docker Hub webhooks. Leave it empty to use the DOCKERHUB_WEBHOOK_SECRET environment default.",
  },
  smtp_config: {
    title: "SMTP config",
    body: "Optional SMTP connection string for this profile in the format user:pwd@host:port.",
  },
  operate_action: {
    title: "Action",
    body: "Choose the container operation to request. Start, stop, restart and kill can be applied to one instance or to all containers using the selected image version.",
  },
  instance: {
    title: "Instance name",
    body: "The Docker container name to create, operate on or delete. DNS is configured separately when Traefik is enabled.",
  },
  dns_name: {
    title: "DNS name",
    body: "The public DNS name used for Traefik labels and Cloudflare DNS when Traefik is enabled.",
  },
  delete_volumes: {
    title: "Delete volumes",
    body: "When enabled, deleting the instance also deletes the Docker volumes mounted on that container. Leave it off to keep data volumes.",
  },
  image: {
    title: "Image name",
    body: "The Docker image name used to find containers or available versions in NetBox, for example saashup/app.",
  },
  oldversion: {
    title: "Old version",
    body: "The currently deployed image version to replace during upgrade. Leave it empty to upgrade all previous versions except the target version.",
  },
  restart_version: {
    title: "Version",
    body: "The image version used to find containers for bulk operate actions.",
  },
  version: {
    title: "Version",
    body: "The target image version for creation or upgrade.",
  },
  clean_name: {
    title: "Clean name before recreate",
    body: "Removes generated timestamp suffixes from container names during upgrade before requesting the recreate operation.",
  },
  remove_old_images: {
    title: "Remove old images",
    body: "When enabled, each old image is deleted from its host only after all containers using that old image have recreated successfully.",
  },
};

const configFields = ["config_profile", "config_name", "customer_name", "netbox", "token", "proxy", "domain", "tag", "max_instances", "owner_env_var", "cloudflare_filter", "dockerhub_webhook_secret", "smtp_config"];

const actions = {
  config: {
    endpoint: "/webhook",
    method: "get",
    menu: "menu_config",
    title: "Config",
    description: "Save the NetBox URL, token, optional proxy, domain and host tag used by the automation.",
    submitLabel: "Save config",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "config_name", "customer_name", "netbox", "token", "proxy", "domain", "tag", "max_instances", "owner_env_var", "cloudflare_filter", "dockerhub_webhook_secret", "smtp_config"],
  },
  create: {
    endpoint: "/create",
    method: "post",
    menu: "menu_create",
    title: "Create instance",
    description: "Create a container, volume, optional DNS record and optional Traefik labels.",
    submitLabel: "Create instance",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "network", "traefik", "all_hosts", "instance", "dns_name", "image", "version", "env_vars", "labels", "ports", "volumes", "binds"],
  },
  workflow: {
    endpoint: "",
    method: "post",
    menu: "menu_workflow",
    title: "Workflow",
    description: "Run compose-imported templates in the order they were defined.",
    submitLabel: "Run workflow",
    buttonClass: "btn btn-primary",
    fields: [],
  },
  recreate: {
    endpoint: "/recreate",
    method: "post",
    menu: "menu_recreate",
    title: "Upgrade containers",
    description: "Replace containers matching an image and old version with a new version.",
    submitLabel: "Upgrade containers",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "image", "oldversion", "version", "clean_name", "remove_old_images"],
  },
  restart: {
    endpoint: "/restart",
    method: "post",
    menu: "menu_restart",
    title: "Operate containers",
    description: "Start, stop, restart or kill one container or containers matching an image and version.",
    submitLabel: "Operate image",
    buttonClass: "btn btn-primary",
    fields: ["config_profile", "operate_action", "instance", "operate_instance_action", "image", "restart_version"],
  },
  report: {
    endpoint: "/report/images",
    method: "get",
    menu: "menu_report",
    title: "Image report",
    description: "Review image usage by container count for one config.",
    submitLabel: "Refresh report",
    buttonClass: "btn btn-primary",
    fields: [],
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
    fields: ["config_profile", "instance", "delete_volumes"],
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
  "owner_env_var",
  "config_profile",
  "operate_action",
  "delete_volumes",
  "config_name",
  "network",
  "traefik",
  "all_hosts",
  "instance",
  "dns_name",
  "image",
  "oldversion",
  "restart_version",
  "version",
  "clean_name",
  "remove_old_images",
  "cloudflare_filter",
  "dockerhub_webhook_secret",
  "smtp_config",
  "var_env_key",
  "var_env_value",
  "label_key",
  "label_value",
  "port_value",
  "volume_source",
  "volume_name",
  "bind_host_path",
  "bind_container_path",
  "bind_read_only",
];

const operateActionLabels = {
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  kill: "Kill",
};

function field(name) {
  return document.getElementById(name);
}

function fieldValue(name, fallback = "") {
  const el = field(name);
  return el ? el.value : fallback;
}

function fieldChecked(name, fallback = false) {
  const el = field(name);
  return el ? Boolean(el.checked) : fallback;
}

function checkboxValue(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  return !["false", "0", "off", "no"].includes(String(value).toLowerCase());
}

function ownerEnvVarValue(value) {
  return String(value || "SAASHUP_OWNER").trim() || "SAASHUP_OWNER";
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

function logout() {
  const returnUrl = window.location.origin + "/";
  window.location.href = `/logout?rd=${encodeURIComponent(returnUrl)}`;
}

function setSidebarCollapsed(collapsed) {
  appShell?.classList.toggle("sidebar-collapsed", collapsed);
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    sidebarToggle.setAttribute("aria-label", collapsed ? "Expand menu" : "Collapse menu");
    sidebarToggle.title = collapsed ? "Expand menu" : "Collapse menu";
  }
  localStorage.setItem(sidebarCollapsedStorageKey, collapsed ? "true" : "false");
}

function initializeSidebar() {
  if (isOrderPage || !appShell) return;
  setSidebarCollapsed(localStorage.getItem(sidebarCollapsedStorageKey) === "true");
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

function dnsParts(value) {
  const text = String(value || "").trim();
  if (!text) return { host: "", path: "" };

  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const path = `${url.pathname || ""}${url.search || ""}${url.hash || ""}`;
    return { host: url.hostname, path: path === "/" ? "" : path };
  } catch {
    const slash = text.indexOf("/");
    if (slash === -1) return { host: text, path: "" };
    return { host: text.slice(0, slash), path: text.slice(slash) || "" };
  }
}

function dnsNameFqdn(value, domain) {
  const { host, path } = dnsParts(value);
  const fqdnHost = instanceFqdn(host, domain);
  return fqdnHost ? `${fqdnHost}${path}` : "";
}

function createDnsName() {
  return dnsNameFqdn(fieldValue("instance"), selectedProfileCredentials().domain);
}

function syncCreateDnsName({ force = false } = {}) {
  const dnsInput = field("dns_name");
  if (!dnsInput || currentAction !== "create") return;

  const hasTraefik = fieldChecked("traefik", true);
  dnsInput.disabled = !hasTraefik;
  if (!hasTraefik) return;

  const nextName = createDnsName();
  const currentName = fieldValue("dns_name");
  if (force || !currentName || currentName === generatedCreateDnsName) {
    setFieldValue("dns_name", nextName);
  }
  generatedCreateDnsName = nextName;
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
  syncCreateDnsName({ force: true });
  syncVolumeNames();
}

function setFieldValue(name, value = "") {
  const el = field(name);
  if (!el) return;

  if (el.type === "checkbox") {
    el.checked = checkboxValue(value);
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

    if (templateNetworkOverride) {
      setFieldValue("network", templateNetworkOverride);
      return;
    }
    setFieldValue("network", networks[0] || "");
  } catch {
    if (requestId === createNetworkRequestId && currentAction === "create") {
      if (templateNetworkOverride) {
        setFieldValue("network", templateNetworkOverride);
        return;
      }
      setFieldValue("network", "");
    }
  }
}

function syncCreateNetwork() {
  const network = field("network");
  if (!network) return;

  network.readOnly = currentAction === "create";
  if (currentAction !== "create") return;

  if (templateNetworkOverride) {
    setFieldValue("network", templateNetworkOverride);
    return;
  }
  setFieldValue("network", "");
  const requestId = ++createNetworkRequestId;
  refreshCreateNetworkFromInstances(requestId);
}

function profileLabel(name) {
  return name || "No config saved";
}

function knownProfileEntries() {
  const entries = {
    ...parseProfiles(savedConfig.profiles),
    ...serverConfigProfiles,
    ...configProfiles,
  };
  const profile = savedConfig.profile || savedConfig.config_profile || "";
  if (profile && !entries[profile] && savedConfig.netbox && savedConfig.token) {
    entries[profile] = {
      netbox: savedConfig.netbox,
      token: savedConfig.token,
      proxy: savedConfig.proxy || "",
      domain: savedConfig.domain || "",
      tag: savedConfig.tag || "",
      max_instances: normalizeMaxInstances(savedConfig.max_instances),
      owner_env_var: ownerEnvVarValue(savedConfig.owner_env_var),
      cloudflare_filter: checkboxValue(savedConfig.cloudflare_filter, true),
      dockerhub_webhook_secret: savedConfig.dockerhub_webhook_secret || "",
      smtp_config: smtpConfigValue(savedConfig),
    };
  }
  return entries;
}

function knownProfileNames() {
  const deleted = new Set(deletedProfiles());
  return Object.keys(knownProfileEntries())
    .filter((name) => !deleted.has(name))
    .sort((a, b) => a.localeCompare(b));
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

function smtpConfigValue(profile = {}) {
  if (profile.smtp_config) return profile.smtp_config;
  if (!profile.smtp_host) return "";

  const auth = profile.smtp_user || profile.smtp_password
    ? `${profile.smtp_user || ""}:${profile.smtp_password || ""}@`
    : "";
  const port = profile.smtp_port ? `:${profile.smtp_port}` : "";
  return `${auth}${profile.smtp_host}${port}`;
}

function normalizedProfileForSync(profile = {}) {
  return {
    netbox: profile.netbox || "",
    token: profile.token || "",
    proxy: profile.proxy || "",
    domain: normalizeDomain(profile.domain || ""),
    tag: profile.tag || "",
    max_instances: normalizeMaxInstances(profile.max_instances),
    owner_env_var: ownerEnvVarValue(profile.owner_env_var),
    cloudflare_filter: checkboxValue(profile.cloudflare_filter, true),
    dockerhub_webhook_secret: profile.dockerhub_webhook_secret || "",
    smtp_config: smtpConfigValue(profile),
  };
}

function currentProfileFieldValues() {
  return {
    netbox: fieldValue("netbox"),
    token: fieldValue("token"),
    proxy: fieldValue("proxy"),
    domain: fieldValue("domain"),
    tag: fieldValue("tag"),
    max_instances: fieldValue("max_instances"),
    owner_env_var: fieldValue("owner_env_var"),
    cloudflare_filter: fieldChecked("cloudflare_filter", true),
    dockerhub_webhook_secret: profileDockerhubSecretValue(),
    smtp_config: fieldValue("smtp_config"),
  };
}

function profileSyncState(name = currentConfigProfile) {
  if (!name || !configProfiles[name]) return { status: "none", message: "" };
  const localSource = currentAction === "config" && name === currentConfigProfile
    ? currentProfileFieldValues()
    : configProfiles[name];

  if (!serverConfigProfiles[name]) {
    return {
      status: "warning",
      message: "This profile exists only in this browser. Save config to sync it to the server.",
    };
  }

  const localProfile = JSON.stringify(normalizedProfileForSync(localSource));
  const serverProfile = JSON.stringify(normalizedProfileForSync(serverConfigProfiles[name]));
  if (localProfile === serverProfile) {
    return {
      status: "ok",
      message: "Profile synced with server.",
    };
  }

  return {
    status: "warning",
    message: "This profile differs from the server copy. Save config to align it.",
  };
}

function updateProfileSyncWarning() {
  if (!profileSyncWarning) return;

  const { status, message } = profileSyncState();
  profileSyncWarning.textContent = "";
  profileSyncWarning.title = message;
  profileSyncWarning.setAttribute("aria-label", message);
  profileSyncWarning.classList.toggle("hidden", status === "none");
  profileSyncWarning.classList.toggle("is-ok", status === "ok");
  profileSyncWarning.classList.toggle("is-warning", status === "warning");
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
  createTemplates = normalizeCreateTemplates(parseStoredObject("create_templates"));
  createWorkflows = normalizeCreateWorkflows(parseStoredObject("create_workflows"));

  return fetch("/templates", {
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((templates) => {
      createTemplates = normalizeCreateTemplates(templates && typeof templates === "object" && !Array.isArray(templates) ? templates : {});
      localStorage.setItem("create_templates", JSON.stringify(createTemplates));
      updateTemplateOptions();
      updateWorkflowOptions();
    })
    .catch(() => {
      updateTemplateOptions();
      updateWorkflowOptions();
    });
}

function persistCreateTemplates() {
  localStorage.setItem("create_templates", JSON.stringify(createTemplates));
  localStorage.setItem("create_workflows", JSON.stringify(createWorkflows));

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

async function loadMailSettings() {
  try {
    const response = await fetch("/mail-settings", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mailSettings = await response.json();
  } catch {
    mailSettings = { owner_email_configured: false };
  }
  updateTestEmailVisibility();
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

    if (!confirm("Import config, profiles and templates from this file? Matching names will be replaced and new names will be added.")) {
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
    const importedTemplates = normalizeCreateTemplates(plainObject(data.templates));
    const importedWorkflows = normalizeCreateWorkflows(plainObject(data.workflows));
    const mergedProfiles = { ...configProfiles, ...importedProfiles };
    const selectedProfile = importedConfig.profile || importedConfig.config_profile || currentConfigProfile || Object.keys(mergedProfiles).sort((a, b) => a.localeCompare(b))[0] || "";

    configProfiles = mergedProfiles;
    serverConfigProfiles = { ...serverConfigProfiles, ...importedProfiles };
    createTemplates = { ...createTemplates, ...importedTemplates };
    createWorkflows = { ...createWorkflows, ...importedWorkflows };
    savedConfig = { ...savedConfig, ...importedConfig, profiles: mergedProfiles };
    currentConfigProfile = selectedProfile;

    Object.keys(importedProfiles).forEach(forgetDeletedProfile);
    persistProfiles();
    localStorage.setItem("create_templates", JSON.stringify(createTemplates));
    localStorage.setItem("create_workflows", JSON.stringify(createWorkflows));
    updateProfileOptions();
    updateTemplateOptions();
    updateWorkflowOptions();
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
  syncTemplateActions();
}

function updateWorkflowOptions(selected = workflowSelect?.value || "") {
  if (!workflowSelect) return;

  const names = Object.keys(createWorkflows).sort((a, b) => workflowOptionLabel(a).localeCompare(workflowOptionLabel(b)));
  workflowSelect.replaceChildren(new Option(names.length ? "Select workflow" : "No workflows saved", ""));
  names.forEach((name) => workflowSelect.appendChild(new Option(workflowOptionLabel(name), name)));
  workflowSelect.value = names.includes(selected) ? selected : "";
  renderWorkflow();
}

function selectedWorkflow() {
  return createWorkflows[workflowSelect?.value || ""] || null;
}

function workflowProfile(workflow) {
  return workflow?.config_profile || workflow?.profile || "";
}

function workflowNameFromKey(key) {
  return String(key || "").split("::").pop() || "";
}

function workflowStorageKey(profileName, workflowName) {
  return profileName ? `${profileName}::${workflowName || "compose"}` : (workflowName || "compose");
}

function workflowOptionLabel(key) {
  const workflow = createWorkflows[key] || {};
  const name = workflow.name || workflowNameFromKey(key);
  const profile = workflowProfile(workflow);
  return profile ? `${profileLabel(profile)} / ${name}` : name;
}

function workflowStepName(step) {
  return typeof step === "string" ? step : step?.template;
}

function workflowStepTemplate(step) {
  const templateName = workflowStepName(step);
  const embeddedTemplate = plainObject(step?.template_data || step?.data);
  return Object.keys(embeddedTemplate).length ? embeddedTemplate : (createTemplates[templateName] || {});
}

function workflowStepStatusIcon(status = "pending") {
  const normalized = ["pending", "running", "done", "failed"].includes(status) ? status : "pending";
  const labels = {
    pending: "Step pending",
    running: "Step running",
    done: "Step done",
    failed: "Step failed",
  };
  const icons = {
    pending: "↻",
    running: "↻",
    done: "✓",
    failed: "!",
  };
  return `<span class="workflow-step-status workflow-step-status-${normalized}" title="${labels[normalized]}" aria-label="${labels[normalized]}">${icons[normalized]}</span>`;
}

function renderWorkflow() {
  const workflow = selectedWorkflow();
  if (!workflowSummary || !workflowTableBody) return;

  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  const profile = workflowProfile(workflow);
  workflowSummary.textContent = workflow
    ? `${steps.length} step${steps.length === 1 ? "" : "s"}${profile ? ` - ${profileLabel(profile)}` : ""}`
    : "No workflow selected";
  if (runWorkflowBtn) runWorkflowBtn.disabled = !steps.length;
  if (deleteWorkflowBtn) deleteWorkflowBtn.disabled = !workflow;

  if (!steps.length) {
    workflowTableBody.innerHTML = '<tr><td colspan="4">Import a compose file with workflow enabled.</td></tr>';
    return;
  }

  workflowTableBody.replaceChildren(...steps.map((step, index) => {
    const templateName = workflowStepName(step);
    const template = workflowStepTemplate(step);
    const status = workflowStepStatuses[index] || "pending";
    const row = document.createElement("tr");
    row.dataset.workflowStepStatus = status;
    row.innerHTML = `
      <td>${workflowStepStatusIcon(status)}</td>
      <td>${escapeHtml(templateName || "")}</td>
      <td>${escapeHtml(template.instance || "")}</td>
      <td>${escapeHtml(template.image || "")}:${escapeHtml(template.version || "")}</td>
    `;
    return row;
  }));
}

function updateImportProfileOptions() {
  if (!importProfileSelect) return;

  const profileNames = knownProfileNames();
  const names = profileNames.length ? profileNames : [""];
  importProfileSelect.replaceChildren(...names.map((name) => new Option(profileLabel(name), name)));
  importProfileSelect.value = names.includes(currentConfigProfile) ? currentConfigProfile : names[0] || "";
}

function syncTemplateActions() {
  const hasTemplate = Boolean(templateSelect?.value);

  if (loadTemplateBtn) loadTemplateBtn.disabled = !hasTemplate;
  if (deleteTemplateBtn) deleteTemplateBtn.disabled = !hasTemplate;
  if (!orderTemplateBtn) return;

  orderTemplateBtn.disabled = false;
  orderTemplateBtn.textContent = hasTemplate ? "Order template" : "Select template to order";
  orderTemplateBtn.title = hasTemplate ? "Open the order page for this template" : "Select a template before ordering";
  orderTemplateBtn.classList.toggle("btn-primary", hasTemplate);
  orderTemplateBtn.classList.toggle("btn-danger-outline", !hasTemplate);
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
  const profile = knownProfileEntries()[name] || {};
  return {
    profile: name,
    netbox: profile.netbox || "",
    token: profile.token || "",
    proxy: profile.proxy || "",
    domain: profile.domain || "",
    tag: profile.tag || "",
    max_instances: normalizeMaxInstances(profile.max_instances),
    owner_env_var: ownerEnvVarValue(profile.owner_env_var),
    cloudflare_filter: checkboxValue(profile.cloudflare_filter, true),
    dockerhub_webhook_secret: profile.dockerhub_webhook_secret || "",
    smtp_config: smtpConfigValue(profile),
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

  const profileNames = knownProfileNames();

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
  updateReportProfileOptions();
}

function updateReportProfileOptions() {
  if (!reportProfileSelect) return;

  const profileNames = knownProfileNames();
  const fallbackProfile = currentConfigProfile || profileNames[0] || "";
  const currentValue = reportProfileSelect.value || fallbackProfile;
  const names = profileNames.length ? profileNames : [""];

  reportProfileSelect.replaceChildren();
  names.forEach((name) => {
    reportProfileSelect.appendChild(new Option(profileLabel(name), name));
  });

  reportProfileSelect.value = names.includes(currentValue)
    ? currentValue
    : names[0];
}

function applyProfileToFields(name = currentConfigProfile) {
  currentConfigProfile = name || "";
  const credentials = profileCredentials(currentConfigProfile);

  setFieldValue("config_profile", currentConfigProfile);
  setFieldValue("config_name", currentConfigProfile);
  setFieldValue("customer_name", savedConfig.customer_name || "");
  setFieldValue("netbox", credentials.netbox);
  setFieldValue("token", credentials.token);
  setFieldValue("proxy", credentials.proxy);
  setFieldValue("domain", credentials.domain);
  setFieldValue("tag", credentials.tag);
  setFieldValue("max_instances", credentials.max_instances);
  setFieldValue("owner_env_var", credentials.owner_env_var);
  setFieldValue("cloudflare_filter", credentials.cloudflare_filter);
  setFieldValue("dockerhub_webhook_secret", credentials.dockerhub_webhook_secret);
  setFieldValue("smtp_config", credentials.smtp_config);
  applyDockerhubDefaultSecret();
  persistProfiles();
  syncCreateNetwork();
  updateProfileSyncWarning();
  updateTestEmailVisibility();
}

function currentSmtpConfigValue() {
  if (currentAction === "config") return fieldValue("smtp_config");
  return selectedProfileCredentials().smtp_config || "";
}

function updateTestEmailVisibility() {
  if (!testEmailBtn) return;
  const visible = currentAction === "config" && Boolean(currentSmtpConfigValue()) && Boolean(mailSettings.owner_email_configured);
  testEmailBtn.classList.toggle("hidden", !visible);
}

async function loadDockerhubDefaultSecret() {
  if (dockerhubWebhookDefaultLoaded) return;
  dockerhubWebhookDefaultLoaded = true;

  try {
    const response = await fetch("/dockerhub-webhook-secret", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    dockerhubWebhookDefaultSecret = data.default_secret || data.secret || "";
  } catch {
    dockerhubWebhookDefaultSecret = "";
  }

  applyDockerhubDefaultSecret();
}

function applyDockerhubDefaultSecret() {
  if (!profileDockerhubSecret || profileDockerhubSecret.value || !dockerhubWebhookDefaultSecret) return;
  profileDockerhubSecret.value = dockerhubWebhookDefaultSecret;
}

function profileDockerhubSecretValue() {
  const value = fieldValue("dockerhub_webhook_secret");
  const stored = configProfiles[currentConfigProfile]?.dockerhub_webhook_secret || "";
  if (!stored && value === dockerhubWebhookDefaultSecret) return "";
  return value;
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

function reportStatIcon(kind) {
  const icons = {
    hosts: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v6H5z"></path><path d="M5 14h14v6H5z"></path><path d="M8 7h.01M8 17h.01M12 10v4"></path></svg>',
    images: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7l8 4 8-4z"></path><path d="m4 12 8 4 8-4"></path><path d="m4 17 8 4 8-4"></path></svg>',
    containers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v10H3z"></path><path d="M7 7v10M12 7v10M17 7v10"></path></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
  };

  return icons[kind] || "";
}

function reportStat(kind, value, label) {
  return `
    <span class="report-stat" data-report-stat="${kind}">
      <span class="report-stat-icon">${reportStatIcon(kind)}</span>
      <span class="report-stat-copy">
        <strong>${Number(value || 0)}</strong>
        <small>${escapeHtml(label)}</small>
      </span>
    </span>
  `;
}

function renderReportStats(totalHosts = 0, totalImages = 0, totalContainers = 0, totalUsers = 0) {
  if (!reportSummary) return;

  reportSummary.innerHTML = [
    reportStat("hosts", totalHosts, totalHosts === 1 ? "Host" : "Hosts"),
    reportStat("images", totalImages, totalImages === 1 ? "Image" : "Images"),
    reportStat("containers", totalContainers, totalContainers === 1 ? "Container" : "Containers"),
    reportStat("users", totalUsers, totalUsers === 1 ? "User" : "Users"),
  ].join("");
}

function reportSummaryHasStats() {
  return Boolean(reportSummary?.querySelector("[data-report-stat]"));
}

function renderReportLoadingRow() {
  if (!reportTableBody) return;

  reportTableBody.innerHTML = `
    <tr>
      <td colspan="4" class="report-loading-cell">
        <span class="report-loader" aria-hidden="true"></span>
        <span>Loading image report...</span>
      </td>
    </tr>
  `;
}

function renderReportHeader(columns) {
  if (!reportTableHead) return;

  reportTableHead.innerHTML = `
    <tr>
      ${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
    </tr>
  `;
}

function renderImageReportRows(rows) {
  renderReportHeader(["Config", "Image", "Version", "Containers"]);
  reportTableBody?.closest("table")?.classList.remove("report-users");
  if (!reportTableBody) return;

  if (!rows.length) {
    reportTableBody.innerHTML = '<tr><td colspan="4">No images found for this selection.</td></tr>';
    return;
  }

  reportTableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.profile || "Default")}</td>
      <td>${escapeHtml(row.image)}</td>
      <td>${escapeHtml(row.version)}</td>
      <td>${Number(row.containers || 0)}</td>
    </tr>
  `).join("");
}

function renderUserReportRows(users) {
  renderReportHeader(["User", "Config", "Containers", "What they have"]);
  reportTableBody?.closest("table")?.classList.add("report-users");
  if (!reportTableBody) return;

  if (!users.length) {
    reportTableBody.innerHTML = '<tr><td colspan="4">No user ownership found for this selection.</td></tr>';
    return;
  }

  reportTableBody.innerHTML = users.map((user) => `
    <tr>
      <td>${escapeHtml(user.user)}</td>
      <td>${escapeHtml((user.profiles || []).join(", ") || "Default")}</td>
      <td>${Number(user.containers || 0)}</td>
      <td>
        <div class="report-user-assets">
          ${(user.items || []).length
            ? user.items.map((item) => {
              const image = [item.image, item.version].filter(Boolean).join(":");
              return `<span>${escapeHtml(item.container || "container")}${image ? ` - ${escapeHtml(image)}` : ""}</span>`;
            }).join("")
            : '<span>No instance details available</span>'}
        </div>
      </td>
    </tr>
  `).join("");
}

function renderReportTable(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const users = Array.isArray(data?.users) ? data.users : [];
  if (currentReportView === "users") {
    renderUserReportRows(users);
    return;
  }

  renderImageReportRows(rows);
}

function renderReport(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const totalHosts = Number(data?.total_hosts || 0);
  const totalImages = Number(data?.total_images ?? rows.length);
  const totalContainers = Number(data?.total_containers ?? rows.reduce((total, row) => total + Number(row.containers || 0), 0));
  const totalUsers = Number(data?.total_users || 0);

  lastReportData = data;
  renderReportStats(totalHosts, totalImages, totalContainers, totalUsers);
  renderReportTable(data);
}

function setReportView(view) {
  currentReportView = view === "users" ? "users" : "images";
  reportViewButtons.forEach((button) => {
    const active = button.dataset.reportView === currentReportView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (lastReportData) renderReportTable(lastReportData);
}

async function refreshImageReport() {
  if (!reportProfileSelect || !refreshReportBtn) return;

  updateReportProfileOptions();
  const profile = reportProfileSelect.value || "";
  const query = new URLSearchParams({ profile });
  query.set("profiles", JSON.stringify(configProfiles));

  const credentials = profileCredentials(profile);
  query.set("netbox", credentials.netbox);
  query.set("token", credentials.token);
  query.set("proxy", credentials.proxy);
  query.set("tag", credentials.tag);
  query.set("config_profile", credentials.profile);

  refreshReportBtn.disabled = true;
  if (!reportSummaryHasStats()) renderReportStats();
  reportSummary?.classList.remove("is-error");
  renderReportLoadingRow();

  try {
    const response = await fetch(`/report/images?${query.toString()}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    renderReport(await response.json());
    setNotice("Image report loaded", "success");
  } catch {
    reportSummary?.classList.add("is-error");
    if (reportTableBody) reportTableBody.innerHTML = '<tr><td colspan="4">Report failed. Check the selected config and NetBox connection.</td></tr>';
    setNotice("Image report failed", "error");
  } finally {
    refreshReportBtn.disabled = false;
  }
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

function updateBindRemoveButtons() {
  repeatRows(bindList, ".repeat-row").forEach((row) => {
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

function addBindRow(hostPath = "", containerPath = "", readOnly = false) {
  if (!bindList) return;

  const isFirstRow = repeatRows(bindList, ".repeat-row").length === 0;
  const row = document.createElement("div");
  row.className = "repeat-row bind-row";
  row.innerHTML = `
    <input type="text" name="bind_host_path" placeholder="/var/run/docker.sock" aria-label="Bind host path">
    <input type="text" name="bind_container_path" placeholder="/var/run/docker.sock" aria-label="Bind container path">
    <label class="mini-check mini-toggle" aria-label="Bind read only">
      <input type="checkbox" name="bind_read_only" value="true">
      <span>RO</span>
    </label>
    <button type="button" class="icon-btn repeat-remove" aria-label="Remove bind">&times;</button>
  `;

  const hostInput = row.querySelector('[name="bind_host_path"]');
  const containerInput = row.querySelector('[name="bind_container_path"]');
  const readOnlyInput = row.querySelector('[name="bind_read_only"]');
  if (isFirstRow) {
    hostInput.id = "bind_host_path";
    containerInput.id = "bind_container_path";
    readOnlyInput.id = "bind_read_only";
  }
  hostInput.value = hostPath;
  containerInput.value = containerPath;
  readOnlyInput.checked = readOnly === true || readOnly === "true" || readOnly === "ro";
  bindList.appendChild(row);
  updateBindRemoveButtons();
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

function clearBindRows() {
  repeatRows(bindList, ".repeat-row").forEach((row) => row.remove());
  updateBindRemoveButtons();
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

function setOrderStatus(message, type = "success", reason = "") {
  if (!orderStatus) return;

  orderStatus.className = `order-status ${type}`;
  orderStatus.dataset.reason = reason;
  orderStatus.replaceChildren(document.createTextNode(message));
}

function clearOrderStatus(reason = "") {
  if (!orderStatus) return;
  if (reason && orderStatus.dataset.reason !== reason) return;

  orderStatus.className = "order-status hidden";
  orderStatus.dataset.reason = "";
  orderStatus.replaceChildren();
}

function orderHomeLink() {
  const homeLink = document.createElement("a");
  homeLink.href = "/";
  homeLink.className = "btn btn-secondary order-status-home";
  homeLink.textContent = "Back to home";
  return homeLink;
}

function setOrderActionStatus(messageText, type, reason) {
  if (!orderStatus) return;

  const message = document.createElement("span");
  message.textContent = messageText;
  orderStatus.className = `order-status ${type} has-action`;
  orderStatus.dataset.reason = reason;
  orderStatus.replaceChildren(message, orderHomeLink());
}

function setOrderDeleteStatus(instance) {
  setOrderActionStatus(`Delete requested for ${instance}.`, "success", "delete-requested");
}

function orderLimitMessage(limit) {
  const max = Number(limit?.max || 0);
  return `You have reached your maximum of ${max} instance${max === 1 ? "" : "s"} for this config.`;
}

function setOrderLimitStatus(limit) {
  setOrderActionStatus(orderLimitMessage(limit), "error", "limit-reached");
}

function orderCanRequestMessage(limit) {
  const remaining = Number(limit?.remaining || 0);
  if (remaining > 1) return `You can request ${remaining} more instances for this config.`;
  return "You can request another instance for this config.";
}

function prepareNextOrderRequest() {
  if (!isOrderPage) return;

  const entry = createTemplateEntry(orderTemplateName);
  const templateDnsPath = dnsParts(entry?.template?.dns_name).path;
  setFieldValue("instance", "");
  setFieldValue("dns_name", "");
  generatedCreateInstanceName = "";
  generatedCreateDnsName = "";
  ensureRandomCreateInstanceName();
  if (templateDnsPath) {
    const dnsName = `${createDnsName()}${templateDnsPath}`;
    setFieldValue("dns_name", dnsName);
    generatedCreateDnsName = dnsName;
  }
  if (submitBtn) submitBtn.disabled = false;
}

function normalizedOrderInstanceStatus(item) {
  const status = String(item?.status || "ready").toLowerCase();
  return ["creating", "deleting", "failed", "ready"].includes(status) ? status : "ready";
}

function isPendingOrderInstance(item) {
  return ["creating", "deleting"].includes(normalizedOrderInstanceStatus(item));
}

function orderInstanceStatusControl(item, index) {
  const status = normalizedOrderInstanceStatus(item);
  const instance = escapeHtml(item.instance || "instance");

  if (status === "creating" || status === "deleting") {
    const label = status === "deleting" ? "Instance is being deleted" : "Instance is being created";
    return `<span class="order-instance-status order-instance-status-${status}" title="${label}" aria-label="${label}">↻</span>`;
  }

  if (status === "failed") {
    return '<span class="order-instance-status order-instance-status-failed" title="Instance creation failed" aria-label="Instance creation failed">!</span>';
  }

  return `<button type="button" class="icon-btn icon-btn-danger order-instance-delete" data-order-instance-delete="${index}" title="Delete ${instance}" aria-label="Delete ${instance}">×</button>`;
}

function orderInstanceStatusText(item) {
  const status = normalizedOrderInstanceStatus(item);
  if (status === "creating") return "Creating";
  if (status === "deleting") return "Deleting";
  if (status === "failed") return "Failed";
  return "Ready";
}

function orderInstanceStatusTextClass(item) {
  return `order-instance-state order-instance-state-${normalizedOrderInstanceStatus(item)}`;
}

async function refreshOrderInstanceStatuses() {
  if (!isOrderPage || !orderInstances) return;

  try {
    const limit = await orderLimitForProfile(selectedProfileCredentials().profile);
    const instances = Array.isArray(limit.instances) ? limit.instances : [];
    const visibleInstances = new Set(instances.map((item) => item?.instance).filter(Boolean));
    Array.from(orderDeletingInstances).forEach((instance) => {
      if (!visibleInstances.has(instance)) orderDeletingInstances.delete(instance);
    });
    renderOrderInstances(instances.map((item) => (
      orderDeletingInstances.has(item?.instance) ? { ...item, status: "deleting" } : item
    )), limit);
    const hasCreating = orderInstanceCards.some((item) => normalizedOrderInstanceStatus(item) === "creating");
    const hasOrderUsage = Number(limit.used || 0) > 0 || instances.length > 0;
    if (hasOrderUsage && !hasCreating && orderStatus?.dataset.reason === "order-requested") {
      if (limit.reached) setOrderLimitStatus(limit);
      else {
        prepareNextOrderRequest();
        showOrderActions();
        setOrderStatus(orderCanRequestMessage(limit), "success", "request-available");
      }
    }
  } catch {
    // Keep the current cards visible if a background refresh fails.
  }
}

function syncOrderStatusPolling() {
  if (!isOrderPage) return;
  const hasPending = orderInstanceCards.some(isPendingOrderInstance);

  if (!hasPending && orderStatusPollTimer) {
    clearInterval(orderStatusPollTimer);
    orderStatusPollTimer = null;
    return;
  }

  if (hasPending && !orderStatusPollTimer) {
    orderStatusPollTimer = setInterval(refreshOrderInstanceStatuses, 3000);
  }
}

function renderOrderInstances(instances = orderInstanceCards, limit = orderInstanceLimit) {
  if (!orderInstances) return;

  orderInstanceCards = Array.isArray(instances) ? instances : [];
  orderInstanceLimit = {
    max: Number(limit?.max || 0),
    used: Number(limit?.used ?? orderInstanceCards.length),
  };

  if (!orderInstanceCards.length) {
    orderInstances.classList.add("hidden");
    orderInstances.replaceChildren();
    syncOrderStatusPolling();
    return;
  }

  const maxText = orderInstanceLimit.max > 0 ? ` / ${orderInstanceLimit.max}` : "";
  orderInstances.classList.remove("hidden");
  orderInstances.innerHTML = `
    <div class="order-instances-header">
      <div>
        <p class="eyebrow">Your instances</p>
        <h2>${orderInstanceLimit.used || orderInstanceCards.length}${maxText}</h2>
      </div>
    </div>
    <div class="order-instance-grid">
      ${orderInstanceCards.map((item, index) => `
        <article class="order-instance-card" data-order-instance-card="${index}">
          <span class="order-instance-icon" aria-hidden="true">${reportStatIcon("containers")}</span>
          <span class="order-instance-copy">
            ${orderInstanceNameLink(item.instance, item.dns_name)}
            <small>${escapeHtml(item.template || item.image || "SaaShup instance")}</small>
            <small class="${orderInstanceStatusTextClass(item)}">${orderInstanceStatusText(item)}</small>
          </span>
          ${orderInstanceStatusControl(item, index)}
        </article>
      `).join("")}
    </div>
  `;
  syncOrderStatusPolling();
}

function orderInstanceNameLink(instance, hrefTarget = "") {
  const name = String(instance || "").trim();

  if (!name) {
    return "<strong>Instance requested</strong>";
  }

  const target = String(hrefTarget || name).trim();
  const host = target.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const href = `https://${host}`;

  return `<a class="order-instance-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`;
}

function addOrderInstanceCard(instance) {
  const next = [
    ...orderInstanceCards,
    {
      instance,
      template: orderTemplateName,
      image: fieldValue("image"),
      version: fieldValue("version"),
      status: "creating",
    },
  ];
  renderOrderInstances(next, {
    ...orderInstanceLimit,
    used: Math.max(Number(orderInstanceLimit.used || 0) + 1, next.length),
  });
  window.setTimeout(refreshOrderInstanceStatuses, 250);
}

async function deleteOrderInstance(index) {
  const item = orderInstanceCards[index];
  if (!item?.instance) return;
  if (!confirm(`Delete instance "${item.instance}"?`)) return;
  hideOrderActions();

  const credentials = selectedProfileCredentials();
  if (!credentials.netbox || !credentials.token) {
    setOrderStatus("Delete failed: missing NetBox config", "error");
    return;
  }

  const body = new URLSearchParams({
    instance: item.instance,
    netbox: credentials.netbox,
    token: credentials.token,
    proxy: credentials.proxy,
    domain: credentials.domain,
    tag: credentials.tag,
    profile: credentials.profile,
    config_profile: credentials.profile,
    order_request: "true",
  });

  const response = await fetch("/delete", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok && response.status !== 202) {
    setOrderStatus(`Delete request failed (${response.status})`, "error");
    return;
  }

  orderDeletingInstances.add(item.instance);
  const next = orderInstanceCards.map((card, itemIndex) => (
    itemIndex === index ? { ...card, status: "deleting" } : card
  ));
  renderOrderInstances(next, orderInstanceLimit);
  setOrderDeleteStatus(item.instance);
  window.setTimeout(refreshOrderInstanceStatuses, 250);
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
  form.classList.toggle("operate-form", actionName === "restart");

  if (formTitle) formTitle.textContent = config.title;
  if (formDescription) formDescription.textContent = config.description;
  submitBtn.textContent = config.submitLabel;
  submitBtn.className = config.buttonClass;
  submitBtn.name = actionName === "restart" ? "restart_mode" : "";
  submitBtn.value = actionName === "restart" ? "image" : "";

  deleteConfigBtn?.classList.toggle("hidden", actionName !== "config");
  updateTestEmailVisibility();
  exportConfigBtn?.classList.toggle("hidden", actionName !== "config");
  importConfigBtn?.classList.toggle("hidden", actionName !== "config");
  clearBtn?.classList.toggle("hidden", actionName === "config" || actionName === "report" || actionName === "workflow");
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
  formCard?.classList.toggle("hidden", actionName === "report" || actionName === "workflow");
  reportCard?.classList.toggle("hidden", actionName !== "report");
  workflowCard?.classList.toggle("hidden", actionName !== "workflow");

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
  updateRemoveOldImagesState();
  ensureRandomCreateInstanceName();
  syncCreateDnsName();
  if (actionName === "create" && imageRecords.length === 0) {
    refreshImages({ notify: false });
  }
  if (actionName === "config") {
    loadDockerhubDefaultSecret();
  }
  if (actionName === "report") {
    updateReportProfileOptions();
    refreshImageReport();
  }
  if (actionName === "workflow") {
    updateWorkflowOptions();
  }
  updateEnvRemoveButtons();
  updateLabelRemoveButtons();
  updatePortRemoveButtons();
  updateVolumeRemoveButtons();
  updateRestartButtons();
  updateRemoveOldImagesState();
  updateOperateControls();
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

function selectedOperateAction() {
  const value = fieldValue("operate_action");
  return operateActionLabels[value] ? value : "restart";
}

function updateOperateControls() {
  if (currentAction !== "restart") return;
  if (!fieldValue("operate_action")) setFieldValue("operate_action", "restart");

  if (restartInstanceBtn) restartInstanceBtn.textContent = "Operate instance";
  submitBtn.textContent = "Operate image";
}

function clearActionFields() {
  const preserved = new Set(configFields);
  templateVersionOverride = "";
  templateNetworkOverride = "";
  generatedCreateDnsName = "";

  for (const name of allFieldNames) {
    if (preserved.has(name)) continue;
    setFieldValue(name, "");
  }
  setFieldValue("traefik", true);
  setFieldValue("all_hosts", false);

  clearEnvRows();
  clearLabelRows();
  clearPortRows();
  clearVolumeRows();
  clearBindRows();
  syncCreateNetwork();
  syncCreateVersion();
  ensureRandomCreateInstanceName();
  syncCreateDnsName({ force: true });
  if (currentAction === "restart") setFieldValue("operate_action", "restart");
  updateRestartButtons();
  updateOperateControls();
  setNotice("Form cleared", "success");
}

function openDockerRunModal() {
  if (!dockerRunModal || !dockerRunInput) return;

  if (currentAction !== "create") setAction("create");
  updateImportProfileOptions();
  setImportTab("run");
  dockerRunInput.value = "";
  dockerRunModal.classList.remove("hidden");
  dockerRunInput.focus();
}

function closeDockerRunModal() {
  dockerRunModal?.classList.add("hidden");
}

function setImportTab(tabName) {
  currentImportTab = tabName === "compose" ? "compose" : "run";
  importTabButtons.forEach((button) => {
    const active = button.dataset.importTab === currentImportTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  importPanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.importPanel !== currentImportTab));
  if (currentImportTab === "run") dockerRunInput?.focus();
  else dockerComposeInput?.focus();
}

function openProfileHelp(key) {
  const help = profileFieldHelp[key];
  if (!help || !profileHelpModal || !profileHelpTitle || !profileHelpBody) return;

  profileHelpTitle.textContent = help.title;
  profileHelpBody.textContent = help.body;
  profileHelpModal.classList.remove("hidden");
  profileHelpOkBtn?.focus();
}

function closeProfileHelp() {
  profileHelpModal?.classList.add("hidden");
}

function togglePasswordVisibility(input, button, label) {
  if (!input || !button) return;

  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  button.setAttribute("aria-pressed", visible ? "false" : "true");
  button.setAttribute("aria-label", `${visible ? "Show" : "Hide"} ${label}`);
  button.title = `${visible ? "Show" : "Hide"} ${label}`;
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
  const composeDefault = ref.match(/^\$\{[^}:]+:?-([^}]+)\}$/);
  if (composeDefault) ref = composeDefault[1].trim();
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

function parseDockerMount(value) {
  const entries = {};
  String(value || "").split(",").forEach((part) => {
    const [key, entryValue = ""] = splitOptionValue(part);
    if (key) entries[key] = entryValue || "true";
  });

  const type = entries.type || "";
  const source = entries.source || entries.src || "";
  const target = entries.target || entries.dst || entries.destination || "";
  if (!source || !target) return null;

  if (type === "bind" || isBindSource(source)) {
    return { kind: "bind", host_path: source, container_path: target, read_only: entries.readonly === "true" || entries.ro === "true" };
  }
  return { kind: "volume", name: source, source: target };
}

function parseDockerRun(command) {
  const tokens = tokenizeDockerRun(command);
  const parsed = { env: [], labels: [], ports: [], volumes: [], binds: [] };
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
        const readOnly = parts.includes("ro");
        if (isBindSource(parts[0])) parsed.binds.push({ host_path: parts[0], container_path: parts[1], read_only: readOnly });
        else parsed.volumes.push({ name: parts[0], source: parts[1] });
      }
    } else if (option === "--mount") {
      const mount = parseDockerMount(readValue());
      if (mount?.kind === "bind") parsed.binds.push({ host_path: mount.host_path, container_path: mount.container_path, read_only: mount.read_only });
      else if (mount?.kind === "volume") parsed.volumes.push({ name: mount.name, source: mount.source });
    } else if (option === "-p" || option === "--publish") {
      const port = parsePublishPort(readValue());
      if (port && parsed.ports.length === 0) parsed.ports.push({ value: port });
    } else if (option === "--restart" || option === "--hostname" || option === "--user" || option === "-u" || option === "-w" || option === "--workdir" || option === "--entrypoint" || option === "--pull" || option === "--env-file" || option === "--add-host" || option === "--dns") {
      readValue();
    }

    i += 1;
  }

  applySaashupTemplateLabels(parsed);
  return parsed;
}

function isBindSource(value) {
  const text = String(value || "");
  return text.startsWith("/") || text.startsWith("./") || text.startsWith("../") || text.startsWith("~");
}

function stripYamlComment(value) {
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && value[i - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "#") return value.slice(0, i);
  }
  return value;
}

function yamlIndent(line) {
  return (line.match(/^\s*/) || [""])[0].replace(/\t/g, "  ").length;
}

function yamlScalar(value) {
  value = stripYamlComment(String(value || "")).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return value;
}

function splitYamlInlineList(value) {
  value = yamlScalar(value);
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  const items = [];
  let current = "";
  let quote = "";
  for (const char of value.slice(1, -1)) {
    if (quote) {
      if (char === quote) quote = "";
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      if (current.trim()) items.push(yamlScalar(current));
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(yamlScalar(current));
  return items;
}

function parseComposePair(value) {
  value = yamlScalar(value);
  const equal = value.indexOf("=");
  if (equal >= 0) return { key: value.slice(0, equal), value: value.slice(equal + 1) };
  const colon = value.indexOf(":");
  if (colon >= 0) return { key: yamlScalar(value.slice(0, colon)), value: yamlScalar(value.slice(colon + 1)) };
  return value ? { key: value, value: "" } : null;
}

function parseComposePairs(inlineValue, blockLines) {
  const inlineItems = splitYamlInlineList(inlineValue);
  if (inlineItems.length) return inlineItems.map(parseComposePair).filter(Boolean);

  const pairs = [];
  blockLines.forEach(({ text }) => {
    const line = stripYamlComment(text).trim();
    if (!line) return;
    if (line.startsWith("- ")) {
      const pair = parseComposePair(line.slice(2));
      if (pair) pairs.push(pair);
      return;
    }
    const pair = parseComposePair(line);
    if (pair) pairs.push(pair);
  });
  return pairs;
}

function labelBoolean(value, defaultValue = false) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return defaultValue;
  if (["1", "true", "yes", "on", "enabled"].includes(text)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(text)) return false;
  return defaultValue;
}

function applySaashupTemplateLabels(template) {
  const runtimeLabels = [];

  (template.labels || []).forEach((label) => {
    const key = String(label.key || "").trim();
    const value = String(label.value ?? "").trim();
    const normalized = key.toLowerCase();

    if (normalized === "saashup_traefik") {
      template.traefik = labelBoolean(value, true);
      return;
    }

    if (normalized === "saashup_dns") {
      template.dns_name = value;
      return;
    }

    runtimeLabels.push(label);
  });

  template.labels = runtimeLabels;
  return template;
}

function normalizeCreateTemplate(template) {
  const normalized = { ...plainObject(template) };
  normalized.labels = Array.isArray(normalized.labels) ? normalized.labels.map((label) => ({ ...plainObject(label) })) : [];
  return applySaashupTemplateLabels(normalized);
}

function normalizeCreateTemplates(templates) {
  return Object.fromEntries(
    Object.entries(plainObject(templates))
      .map(([name, template]) => [name, normalizeCreateTemplate(template)]),
  );
}

function normalizeCreateWorkflows(workflows) {
  return Object.fromEntries(
    Object.entries(plainObject(workflows)).map(([key, workflow]) => {
      const normalized = { ...plainObject(workflow) };
      normalized.steps = Array.isArray(normalized.steps)
        ? normalized.steps.map((step) => {
          const normalizedStep = { ...plainObject(step) };
          if (normalizedStep.template_data) normalizedStep.template_data = normalizeCreateTemplate(normalizedStep.template_data);
          return normalizedStep;
        })
        : [];
      return [key, normalized];
    }),
  );
}

function parseComposeList(inlineValue, blockLines) {
  const inlineItems = splitYamlInlineList(inlineValue);
  if (inlineItems.length) return inlineItems;
  if (inlineValue && yamlScalar(inlineValue)) return [yamlScalar(inlineValue)];

  const items = [];
  blockLines.forEach(({ text }) => {
    const line = stripYamlComment(text).trim();
    if (!line) return;
    if (line.startsWith("- ")) items.push(yamlScalar(line.slice(2)));
    else if (line.endsWith(":")) items.push(yamlScalar(line.slice(0, -1)));
  });
  return items;
}

function parseComposePorts(inlineValue, blockLines) {
  return parseComposeList(inlineValue, blockLines)
    .map(parsePublishPort)
    .filter(Boolean)
    .slice(0, 1)
    .map((value) => ({ value }));
}

function parseComposeVolumes(inlineValue, blockLines) {
  return parseComposeList(inlineValue, blockLines)
    .map((value) => {
      const parts = String(value).split(":");
      return parts.length >= 2 ? { name: yamlScalar(parts[0]), source: yamlScalar(parts[1]) } : null;
    })
    .filter(Boolean);
}

function splitComposeMounts(inlineValue, blockLines) {
  const mounts = parseComposeList(inlineValue, blockLines)
    .map((value) => {
      const parts = String(value).split(":");
      if (parts.length < 2) return null;
      const source = yamlScalar(parts[0]);
      const target = yamlScalar(parts[1]);
      const readOnly = parts.slice(2).includes("ro");
      return isBindSource(source)
        ? { type: "bind", host_path: source, container_path: target, read_only: readOnly }
        : { type: "volume", name: source, source: target };
    })
    .filter(Boolean);

  return {
    volumes: mounts.filter((item) => item.type === "volume").map(({ type, ...item }) => item),
    binds: mounts.filter((item) => item.type === "bind").map(({ type, ...item }) => item),
  };
}

function parseComposeService(lines, serviceIndent, profileName = selectedProfileCredentials().profile) {
  const template = {
    config_profile: profileName,
    traefik: true,
    network: fieldValue("network"),
    image: "",
    version: "",
    env: [],
    labels: [],
    ports: [],
    volumes: [],
    binds: [],
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!stripYamlComment(raw).trim()) continue;
    const indent = yamlIndent(raw);
    const match = raw.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match || indent <= serviceIndent) continue;

    const [, key, inlineValue] = match;
    const blockLines = [];
    let next = i + 1;
    while (next < lines.length && (!stripYamlComment(lines[next]).trim() || yamlIndent(lines[next]) > indent)) {
      blockLines.push({ indent: yamlIndent(lines[next]), text: lines[next] });
      next += 1;
    }
    i = next - 1;

    if (key === "image") {
      const imageParts = splitImageRef(yamlScalar(inlineValue));
      template.image = imageParts.image;
      template.version = imageParts.version;
    } else if (key === "container_name") {
      template.instance = yamlScalar(inlineValue);
    } else if (key === "networks") {
      template.network = parseComposeList(inlineValue, blockLines)[0] || template.network;
    } else if (key === "environment" || key === "env") {
      template.env = parseComposePairs(inlineValue, blockLines);
    } else if (key === "labels") {
      template.labels = parseComposePairs(inlineValue, blockLines);
    } else if (key === "ports") {
      template.ports = parseComposePorts(inlineValue, blockLines);
    } else if (key === "volumes") {
      const mounts = splitComposeMounts(inlineValue, blockLines);
      template.volumes = mounts.volumes;
      template.binds = mounts.binds;
    }
  }

  applySaashupTemplateLabels(template);
  return template.image ? template : null;
}

function composeWorkflowName(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const match = lines
    .map((line) => stripYamlComment(line).trim().match(/^name:\s*(.+)$/))
    .find(Boolean);
  return match ? yamlScalar(match[1]) : "compose";
}

function parseDockerCompose(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const servicesIndex = lines.findIndex((line) => stripYamlComment(line).trim() === "services:");
  if (servicesIndex === -1) return [];

  const servicesIndent = yamlIndent(lines[servicesIndex]);
  const templates = [];
  for (let i = servicesIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!stripYamlComment(line).trim()) continue;
    const indent = yamlIndent(line);
    if (indent <= servicesIndent) break;

    const match = line.trim().match(/^([A-Za-z0-9_.-]+):\s*$/);
    if (!match) continue;

    const serviceName = match[1];
    const block = [];
    let next = i + 1;
    while (next < lines.length && (!stripYamlComment(lines[next]).trim() || yamlIndent(lines[next]) > indent)) {
      block.push(lines[next]);
      next += 1;
    }
    const template = parseComposeService(block, indent, importProfileSelect?.value || selectedProfileCredentials().profile);
    if (template) templates.push({ name: serviceName, template });
    i = next - 1;
  }

  return templates;
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

function setBindRows(items = []) {
  clearBindRows();
  if (!items.length) return;

  items.forEach((item) => {
    addBindRow(
      item.host_path ?? item.host ?? item.key ?? "",
      item.container_path ?? item.container ?? item.value ?? "",
      item.read_only ?? item.readonly ?? false,
    );
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

function bindValues() {
  return repeatRows(bindList, ".repeat-row")
    .map((row) => ({
      host_path: row.querySelector('[name="bind_host_path"]')?.value || "",
      container_path: row.querySelector('[name="bind_container_path"]')?.value || "",
      read_only: row.querySelector('[name="bind_read_only"]')?.checked || false,
    }))
    .filter((item) => item.host_path && item.container_path);
}

function prepareBindReadOnlyForFormData() {
  const inputs = repeatRows(bindList, ".repeat-row")
    .map((row) => row.querySelector('[name="bind_read_only"]'))
    .filter(Boolean);
  const states = inputs.map((input) => ({ input, checked: input.checked, value: input.value }));
  inputs.forEach((input) => {
    input.value = input.checked ? "true" : "false";
    input.checked = true;
  });
  return () => {
    states.forEach(({ input, checked, value }) => {
      input.checked = checked;
      input.value = value;
    });
  };
}

function currentCreateTemplate() {
  const credentials = selectedProfileCredentials();

  return {
    config_profile: credentials.profile,
    instance: fieldValue("instance"),
    dns_name: fieldValue("dns_name"),
    traefik: fieldChecked("traefik", true),
    all_hosts: fieldChecked("all_hosts", false),
    network: fieldValue("network"),
    image: fieldValue("image"),
    version: fieldValue("version"),
    env: repeatValues(envList, ".env-row", "var_env_key", "var_env_value"),
    labels: repeatValues(labelList, ".repeat-row", "label_key", "label_value"),
    ports: portValues(),
    volumes: volumeValues(),
    binds: bindValues(),
  };
}

function applyCreateTemplate(template) {
  if (!template) return;
  template = normalizeCreateTemplate(template);

  setAction("create");

  const templateProfile = template.config_profile || template.profile || "";
  const switchesProfile = Boolean(templateProfile && templateProfile !== currentConfigProfile && Object.hasOwn(configProfiles, templateProfile));
  if (templateProfile && Object.hasOwn(configProfiles, templateProfile)) {
    applyProfileToFields(templateProfile);
    imageRecords = [];
    replaceOptions(imageOptions, []);
    replaceOptions(oldVersionOptions, []);
    replaceOptions(restartVersionOptions, []);
  }

  setFieldValue("network", template.network || fieldValue("network"));
  setFieldValue("traefik", template.traefik ?? true);
  setFieldValue("all_hosts", template.all_hosts ?? false);
  templateNetworkOverride = template.network || "";
  templateVersionOverride = template.version || "";
  generatedCreateInstanceName = "";
  generatedCreateDnsName = "";
  setFieldValue("instance", switchesProfile ? "" : (template.instance || ""));
  if (switchesProfile || !template.instance) ensureRandomCreateInstanceName();
  setFieldValue("dns_name", template.dns_name || "");
  syncCreateDnsName({ force: !template.dns_name });
  setFieldValue("image", template.image || "");
  syncCreateVersion();
  if (template.version) setFieldValue("version", template.version);
  setRepeatRows(template.env || [], clearEnvRows, addEnvRow, { key: "var_env_key", value: "var_env_value" });
  setRepeatRows(template.labels || [], clearLabelRows, addLabelRow, { key: "label_key", value: "label_value" });
  setPortValue((template.ports || [])[0]?.value || "");
  setRepeatRows(template.volumes || [], clearVolumeRows, addVolumeRow, { key: "volume_source", value: "volume_name" });
  setBindRows(template.binds || []);
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
  const templateDnsPath = dnsParts(entry.template.dns_name).path;
  applyCreateTemplate(entry.template);
  setFieldValue("instance", "");
  setFieldValue("dns_name", "");
  generatedCreateDnsName = "";
  ensureRandomCreateInstanceName();
  syncCreateDnsName({ force: true });
  if (templateDnsPath) {
    const dnsName = `${createDnsName()}${templateDnsPath}`;
    setFieldValue("dns_name", dnsName);
    generatedCreateDnsName = dnsName;
  }
  submitBtn.textContent = "Yes";

  if (templateSelect) {
    updateTemplateOptions(entry.name);
  }

  const imagesLoaded = await refreshImages({ notify: false });
  if (imagesLoaded && !entry.template.version) {
    syncCreateVersion();
  } else if (entry.template.version) {
    setFieldValue("version", entry.template.version);
  }

  await ensureCreateVersion();

  if (!fieldValue("network")) {
    syncCreateNetwork();
  }

  try {
    const limit = await orderLimitForProfile(selectedProfileCredentials().profile);
    renderOrderInstances(limit.instances, limit);
    if (limit.reached) {
      hideOrderActions();
      setOrderLimitStatus(limit);
      return false;
    }
  } catch {
    // The create endpoint enforces the limit; keep the order page usable if this check fails.
  }

  return true;
}

async function applyDockerComposeFile(text) {
  const composeText = text ?? dockerComposeInput?.value ?? "";
  const templates = parseDockerCompose(composeText);
  if (!templates.length) {
    setNotice("Compose services with images are required", "error");
    return;
  }

  const previousTemplates = { ...createTemplates };
  const previousWorkflows = { ...createWorkflows };
  templates.forEach(({ name, template }) => {
    createTemplates[name] = template;
  });
  if (createWorkflowInput?.checked) {
    const workflowName = composeWorkflowName(composeText);
    const workflowProfileName = importProfileSelect?.value || selectedProfileCredentials().profile || "";
    const workflowKey = workflowStorageKey(workflowProfileName, workflowName);
    createWorkflows[workflowKey] = {
      name: workflowName,
      config_profile: workflowProfileName,
      steps: templates.map(({ name, template }) => ({
        template: name,
        template_data: template,
      })),
      created_at: new Date().toISOString(),
    };
  }

  try {
    await persistCreateTemplates();
    updateTemplateOptions(templates[0].name);
    if (createWorkflowInput?.checked) {
      const workflowName = composeWorkflowName(composeText);
      const workflowProfileName = importProfileSelect?.value || selectedProfileCredentials().profile || "";
      updateWorkflowOptions(workflowStorageKey(workflowProfileName, workflowName));
    } else {
      updateWorkflowOptions("");
    }
    closeDockerRunModal();
    setNotice(`${templates.length} compose template${templates.length === 1 ? "" : "s"} imported`, "success");
  } catch {
    createTemplates = previousTemplates;
    createWorkflows = previousWorkflows;
    localStorage.setItem("create_templates", JSON.stringify(createTemplates));
    localStorage.setItem("create_workflows", JSON.stringify(createWorkflows));
    updateTemplateOptions();
    updateWorkflowOptions();
    setNotice("Compose import failed", "error");
  }
}

async function applyDockerRunCommand() {
  if (currentImportTab === "compose") {
    await applyDockerComposeFile();
    return;
  }

  const runText = dockerRunInput?.value || "";
  if (parseDockerCompose(runText).length) {
    await applyDockerComposeFile(runText);
    return;
  }

  const parsed = parseDockerRun(runText);
  const currentNetwork = fieldValue("network");

  if (!parsed.image) {
    setNotice("Docker run image is required", "error");
    return;
  }

  if (currentAction !== "create") setAction("create");
  templateNetworkOverride = "";
  templateVersionOverride = parsed.version || "";
  generatedCreateDnsName = "";
  setFieldValue("network", currentNetwork);
  if (parsed.traefik !== undefined) setFieldValue("traefik", parsed.traefik);
  if (parsed.instance) setFieldValue("instance", parsed.instance);
  syncCreateDnsName({ force: true });
  if (parsed.dns_name) {
    setFieldValue("dns_name", parsed.dns_name);
    generatedCreateDnsName = parsed.dns_name;
  }
  setFieldValue("image", parsed.image);
  syncCreateVersion();
  if (parsed.version) setFieldValue("version", parsed.version);

  setRepeatRows(parsed.env, clearEnvRows, addEnvRow, { key: "var_env_key", value: "var_env_value" });
  setRepeatRows(parsed.labels, clearLabelRows, addLabelRow, { key: "label_key", value: "label_value" });
  setPortValue(parsed.ports[0]?.value || "");
  setRepeatRows(parsed.volumes, clearVolumeRows, addVolumeRow, { key: "volume_source", value: "volume_name" });
  setBindRows(parsed.binds);

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
        serverConfigProfiles = {};
        configProfiles = localProfiles;
        updateProfileOptions();
        applyProfileToFields(currentConfigProfile);
        return {};
      }

      savedConfig = data;
      const serverProfiles = applyDeletedProfileFilter(parseProfiles(data.profiles));
      serverConfigProfiles = { ...serverProfiles };
      configProfiles = { ...serverProfiles, ...localProfiles };

      if (data.netbox && data.token) {
        const profile = data.profile || data.config_profile || currentConfigProfile || "";
        if (!deletedProfiles().includes(profile)) {
          const serverProfile = {
            netbox: data.netbox,
            token: data.token,
            proxy: data.proxy || "",
            domain: data.domain || "",
            tag: data.tag || "",
            max_instances: normalizeMaxInstances(data.max_instances),
            owner_env_var: ownerEnvVarValue(data.owner_env_var),
            cloudflare_filter: checkboxValue(data.cloudflare_filter, true),
            dockerhub_webhook_secret: data.dockerhub_webhook_secret || "",
            smtp_config: smtpConfigValue(data),
          };
          serverConfigProfiles[profile] = serverProfile;
          configProfiles[profile] = localProfiles[profile] || serverProfile;
          currentConfigProfile = localStorage.getItem("current_config_profile") || profile;
        }
      }

      updateProfileOptions();
      applyProfileToFields(currentConfigProfile);
      ensureRandomCreateInstanceName();
      return data;
    })
    .catch(() => {
      serverConfigProfiles = {};
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

async function testEmail() {
  const credentials = selectedProfileCredentials();
  const smtp_config = fieldValue("smtp_config") || credentials.smtp_config || "";

  if (!smtp_config) {
    setNotice("SMTP config is required", "error");
    return;
  }

  testEmailBtn.disabled = true;
  try {
    const response = await fetch("/test-email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile: credentials.profile,
        config_profile: credentials.profile,
        smtp_config,
      }),
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text };
    }

    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    setNotice("Test email sent", "success");
  } catch (error) {
    setNotice(`Test email failed: ${String(error.message || "request error").slice(0, 160)}`, "error", false);
  } finally {
    testEmailBtn.disabled = false;
  }
}

async function saveConfig() {
  const profile = (fieldValue("config_name") || fieldValue("config_profile") || "").trim();
  const customer_name = fieldValue("customer_name").trim();
  const netbox = fieldValue("netbox");
  const token = fieldValue("token");
  const proxy = fieldValue("proxy");
  const domain = normalizeDomain(fieldValue("domain"));
  const tag = fieldValue("tag");
  const max_instances = normalizeMaxInstances(fieldValue("max_instances"));
  const owner_env_var = ownerEnvVarValue(fieldValue("owner_env_var"));
  const cloudflare_filter = fieldChecked("cloudflare_filter", true);
  const dockerhub_webhook_secret = profileDockerhubSecretValue();
  const smtp_config = fieldValue("smtp_config");

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
  setFieldValue("owner_env_var", owner_env_var);
  configProfiles[profile] = { netbox, token, proxy, domain, tag, max_instances, owner_env_var, cloudflare_filter, dockerhub_webhook_secret, smtp_config };
  currentConfigProfile = profile;
  updateProfileOptions();
  persistProfiles();

  const params = new URLSearchParams({
    netbox,
    token,
    proxy,
    customer_name,
    domain,
    tag,
    max_instances: String(max_instances),
    owner_env_var,
    cloudflare_filter: cloudflare_filter ? "true" : "false",
    dockerhub_webhook_secret,
    smtp_config,
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

    savedConfig = { customer_name, netbox, token, proxy, domain, tag, max_instances, owner_env_var, cloudflare_filter, dockerhub_webhook_secret, smtp_config, profile, profiles: configProfiles };
    serverConfigProfiles = { ...configProfiles };
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

  const customer_name = fieldValue("customer_name").trim() || savedConfig.customer_name || "";
  delete configProfiles[profile];
  rememberDeletedProfile(profile);
  const remainingProfiles = Object.keys(configProfiles).sort((a, b) => a.localeCompare(b));

  try {
    if (remainingProfiles.length === 0) {
      currentConfigProfile = "";
      savedConfig = { customer_name };
      persistProfiles();
      updateProfileOptions();
      setFieldValue("config_name", "");
      setFieldValue("customer_name", customer_name);
      setFieldValue("netbox", "");
      setFieldValue("token", "");
      setFieldValue("proxy", "");
      setFieldValue("domain", "");
      setFieldValue("tag", "");
      setFieldValue("max_instances", "1");
      setFieldValue("owner_env_var", "SAASHUP_OWNER");
      setFieldValue("cloudflare_filter", true);
      setFieldValue("dockerhub_webhook_secret", "");
      setFieldValue("smtp_config", "");

      const params = new URLSearchParams({
        netbox: "",
        token: "",
        proxy: "",
        customer_name,
        domain: "",
        tag: "",
        max_instances: "1",
        owner_env_var: "SAASHUP_OWNER",
        cloudflare_filter: "true",
        dockerhub_webhook_secret: "",
        smtp_config: "",
        profile: "",
        config_profile: "",
        profiles: "{}",
      });

      const response = await fetch(`/webhook?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      serverConfigProfiles = {};
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
      customer_name,
      domain: credentials.domain,
      tag: credentials.tag,
      max_instances: String(credentials.max_instances),
      owner_env_var: credentials.owner_env_var,
      cloudflare_filter: credentials.cloudflare_filter ? "true" : "false",
      dockerhub_webhook_secret: credentials.dockerhub_webhook_secret,
      smtp_config: credentials.smtp_config,
      profile: currentConfigProfile,
      config_profile: currentConfigProfile,
      profiles: JSON.stringify(configProfiles),
    });

    const response = await fetch(`/webhook?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    savedConfig = { ...credentials, customer_name, profiles: configProfiles };
    serverConfigProfiles = { ...configProfiles };
    updateProfileOptions();
    applyProfileToFields(currentConfigProfile);
    setNotice(`Config "${profileLabel(profile)}" deleted (${response.status})`, "success");
  } catch {
    setNotice("Config delete failed", "error");
  }
}

function workflowVolumeName(instance, index) {
  const suffix = index === 0 ? "data" : `data-${index + 1}`;
  return `${String(instance || "instance").split(".")[0]}-${suffix}`;
}

function appendWorkflowPairs(body, items, keyField, valueField, keyNames = ["key"], valueNames = ["value"]) {
  items.forEach((item) => {
    const key = keyNames.map((name) => item?.[name]).find((value) => value !== undefined) || "";
    const value = valueNames.map((name) => item?.[name]).find((entry) => entry !== undefined) || "";
    body.append(keyField, key);
    body.append(valueField, value);
  });
}

function workflowCreateBody(template, templateName) {
  template = normalizeCreateTemplate(template);
  const profileName = template.config_profile || template.profile || currentConfigProfile || "";
  const credentials = profileCredentials(profileName);
  if (!credentials.netbox || !credentials.token) throw new Error(`Config "${profileLabel(profileName)}" is missing NetBox URL or token`);

  const instanceName = String(template.instance || templateName || "").trim();
  const hasTraefik = checkboxValue(template.traefik, true);
  const body = new URLSearchParams({
    config_profile: profileName,
    netbox: credentials.netbox,
    token: credentials.token,
    proxy: credentials.proxy,
    domain: credentials.domain,
    tag: credentials.tag,
    max_instances: String(credentials.max_instances),
    owner_env_var: credentials.owner_env_var,
    profile: credentials.profile,
    network: template.network || "",
    traefik: hasTraefik ? "true" : "false",
    all_hosts: template.all_hosts ? "true" : "false",
    instance: instanceName,
    dns_name: hasTraefik ? dnsNameFqdn(template.dns_name || instanceName, credentials.domain) : "",
    image: template.image || "",
    version: template.version || "",
    cloudflare_filter: credentials.cloudflare_filter ? "true" : "false",
  });

  appendWorkflowPairs(body, template.env || [], "var_env_key", "var_env_value", ["key", "var_name", "name"], ["value"]);
  appendWorkflowPairs(body, template.labels || [], "label_key", "label_value", ["key"], ["value"]);
  (template.ports || []).slice(0, 1).forEach((port) => body.append("port_value", port.value || port.key || ""));
  (template.volumes || []).forEach((volume, index) => {
    const source = volume.source ?? volume.key ?? "";
    if (!source) return;
    body.append("volume_source", source);
    body.append("volume_name", volume.name ?? volume.value ?? workflowVolumeName(instanceName, index));
  });
  (template.binds || []).forEach((bind) => {
    const hostPath = bind.host_path ?? bind.host ?? bind.key ?? "";
    const containerPath = bind.container_path ?? bind.container ?? bind.value ?? "";
    if (!hostPath || !containerPath) return;
    body.append("bind_host_path", hostPath);
    body.append("bind_container_path", containerPath);
    body.append("bind_read_only", bind.read_only || bind.readonly ? "true" : "false");
  });
  return body;
}

async function runWorkflow() {
  const workflowName = workflowSelect?.value || "";
  const workflow = selectedWorkflow();
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  if (!steps.length) {
    setNotice("Select a workflow first", "error");
    return;
  }

  runWorkflowBtn.disabled = true;
  deleteWorkflowBtn.disabled = true;
  await clearLogs({ notify: false });
  workflowStepStatuses = Object.fromEntries(steps.map((_, index) => [index, "pending"]));
  renderWorkflow();

  try {
    for (let index = 0; index < steps.length; index += 1) {
      const templateName = workflowStepName(steps[index]);
      const template = workflowStepTemplate(steps[index]);
      if (!template.image) throw new Error(`Template "${templateName}" is missing`);

      workflowStepStatuses[index] = "running";
      renderWorkflow();
      workflowSummary.textContent = `Running ${index + 1}/${steps.length}: ${templateName}`;
      const body = workflowCreateBody(template, templateName);
      body.set("wait", "true");
      const response = await fetch("/create", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) throw new Error(`Template "${templateName}" failed (${response.status})`);
      workflowStepStatuses[index] = "done";
      renderWorkflow();
    }
    setNotice(`Workflow "${workflowOptionLabel(workflowName)}" requested`, "success");
    workflowSummary.textContent = `${steps.length} step${steps.length === 1 ? "" : "s"} requested`;
  } catch (error) {
    const failedIndex = steps.findIndex((_, index) => workflowStepStatuses[index] === "running");
    if (failedIndex !== -1) workflowStepStatuses[failedIndex] = "failed";
    setNotice(error.message || "Workflow failed", "error", false);
    renderWorkflow();
  } finally {
    runWorkflowBtn.disabled = false;
    deleteWorkflowBtn.disabled = false;
  }
}

function deleteWorkflow() {
  const name = workflowSelect?.value || "";
  if (!name || !createWorkflows[name]) {
    setNotice("Select a workflow first", "error");
    return;
  }
  const label = workflowOptionLabel(name);
  if (!confirm(`Delete workflow "${label}"?`)) return;

  delete createWorkflows[name];
  localStorage.setItem("create_workflows", JSON.stringify(createWorkflows));
  updateWorkflowOptions();
  setNotice(`Workflow "${label}" deleted`, "success");
}

async function submitAction(config, submitter) {
  syncVolumeNames();

  const restoreBindReadOnly = prepareBindReadOnlyForFormData();
  const body = new URLSearchParams(new FormData(form));
  restoreBindReadOnly();
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
  body.set("owner_env_var", credentials.owner_env_var);
  body.set("profile", credentials.profile);
  if (isOrderPage) {
    body.set("order_request", "true");
    body.set("order_template", orderTemplateName);
  }

  if (currentAction === "create") {
    const hasTraefik = fieldChecked("traefik", true);
    const instanceName = String(body.get("instance") || "").trim();
    let rawDnsName = body.get("dns_name") || instanceName;
    const orderTemplateDnsPath = isOrderPage ? dnsParts(createTemplateEntry(orderTemplateName)?.template?.dns_name).path : "";
    if (orderTemplateDnsPath && !dnsParts(rawDnsName).path) rawDnsName = `${rawDnsName}${orderTemplateDnsPath}`;
    const dnsName = hasTraefik ? dnsNameFqdn(rawDnsName, credentials.domain) : "";
    body.set("instance", instanceName);
    body.set("dns_name", dnsName);
    body.set("cloudflare_filter", credentials.cloudflare_filter ? "true" : "false");
    body.set("traefik", hasTraefik ? "true" : "false");
    setFieldValue("instance", instanceName);
    setFieldValue("dns_name", dnsName);
    createdInstanceFqdn = hasTraefik ? dnsName : instanceName;
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
      addOrderInstanceCard(createdInstanceFqdn);
      setOrderStatus(`Thank you, your instance installation has been requested for ${createdInstanceFqdn}.`, "success", "order-requested");
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

  if (templateVersionOverride) {
    setFieldValue("version", templateVersionOverride);
    return;
  }

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

function updateRemoveOldImagesState() {
  const checkbox = field("remove_old_images");
  if (!checkbox) return;

  const oldVersion = fieldValue("oldversion").trim();
  const newVersion = fieldValue("version").trim();
  const blocked = currentAction !== "recreate" || (oldVersion && newVersion && oldVersion === newVersion);

  checkbox.disabled = blocked;
  checkbox.title = blocked && currentAction === "recreate"
    ? "Old images cannot be removed when old version is the same as the new version."
    : "";
  if (blocked) checkbox.checked = false;
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
    updateRemoveOldImagesState();
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

bindList?.addEventListener("click", (event) => {
  const button = event.target.closest(".repeat-remove");
  if (!button || button.disabled) return;

  button.closest(".repeat-row")?.remove();
  updateBindRemoveButtons();
});

addBindBtn?.addEventListener("click", () => {
  addBindRow();
  repeatRows(bindList, ".repeat-row").at(-1)?.querySelector("input")?.focus();
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

  if (currentAction === "create" && fieldChecked("traefik", true) && !isFqdn(dnsParts(dnsNameFqdn(fieldValue("dns_name") || fieldValue("instance"), selectedProfileCredentials().domain)).host)) {
    setNotice("DNS name must be a fully qualified domain name", "error");
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
testEmailBtn?.addEventListener("click", testEmail);
deleteConfigBtn?.addEventListener("click", deleteConfig);
exportConfigBtn?.addEventListener("click", exportPortableConfig);
importConfigBtn?.addEventListener("click", importPortableConfigFile);
importConfigFile?.addEventListener("change", importPortableConfig);
clearBtn?.addEventListener("click", clearActionFields);
dockerRunBtn?.addEventListener("click", openDockerRunModal);
tokenToggle?.addEventListener("click", () => togglePasswordVisibility(field("token"), tokenToggle, "NetBox token"));
profileDockerhubSecretToggle?.addEventListener("click", () => togglePasswordVisibility(profileDockerhubSecret, profileDockerhubSecretToggle, "Docker Hub webhook password"));
smtpConfigToggle?.addEventListener("click", () => togglePasswordVisibility(field("smtp_config"), smtpConfigToggle, "SMTP config"));
form?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-profile-help]");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  openProfileHelp(button.dataset.profileHelp);
});
form?.addEventListener("keydown", (event) => {
  const button = event.target.closest("[data-profile-help]");
  if (!button || (event.key !== "Enter" && event.key !== " ")) return;

  event.preventDefault();
  event.stopPropagation();
  openProfileHelp(button.dataset.profileHelp);
});
profileHelpCloseBtn?.addEventListener("click", closeProfileHelp);
profileHelpOkBtn?.addEventListener("click", closeProfileHelp);
saveTemplateBtn?.addEventListener("click", saveCreateTemplate);
deleteTemplateBtn?.addEventListener("click", deleteSelectedTemplate);
loadTemplateBtn?.addEventListener("click", loadSelectedTemplate);
orderTemplateBtn?.addEventListener("click", openSelectedTemplateOrder);
logoutBtn?.addEventListener("click", logout);
sidebarToggle?.addEventListener("click", () => {
  setSidebarCollapsed(!appShell?.classList.contains("sidebar-collapsed"));
});
refreshReportBtn?.addEventListener("click", refreshImageReport);
reportProfileSelect?.addEventListener("change", refreshImageReport);
workflowSelect?.addEventListener("change", () => {
  workflowStepStatuses = {};
  renderWorkflow();
});
runWorkflowBtn?.addEventListener("click", runWorkflow);
deleteWorkflowBtn?.addEventListener("click", deleteWorkflow);
reportViewButtons.forEach((button) => {
  button.addEventListener("click", () => setReportView(button.dataset.reportView));
});
templateSelect?.addEventListener("change", () => {
  syncTemplateActions();
  if (templateSelect.value) loadSelectedTemplate();
});
dockerRunApplyBtn?.addEventListener("click", applyDockerRunCommand);
dockerRunCancelBtn?.addEventListener("click", closeDockerRunModal);
dockerRunCloseBtn?.addEventListener("click", closeDockerRunModal);
importTabButtons.forEach((button) => {
  button.addEventListener("click", () => setImportTab(button.dataset.importTab));
});
dockerRunModal?.addEventListener("click", (event) => {
  if (event.target === dockerRunModal) closeDockerRunModal();
});
profileHelpModal?.addEventListener("click", (event) => {
  if (event.target === profileHelpModal) closeProfileHelp();
});
refreshInstancesBtn?.addEventListener("click", refreshInstances);
refreshImagesBtn?.addEventListener("click", refreshImages);
configFields.forEach((name) => {
  const control = field(name);
  control?.addEventListener("input", () => {
    updateProfileSyncWarning();
    if (name === "smtp_config") updateTestEmailVisibility();
  });
  control?.addEventListener("change", () => {
    updateProfileSyncWarning();
    if (name === "smtp_config") updateTestEmailVisibility();
  });
});
configProfileSelect?.addEventListener("change", () => {
  applyProfileToFields(configProfileSelect.value);
  ensureRandomCreateInstanceName();
  imageRecords = [];
  templateVersionOverride = "";
  templateNetworkOverride = "";
  generatedCreateDnsName = "";
  setFieldValue("image", "");
  setFieldValue("version", "");
  replaceOptions(imageOptions, []);
  replaceOptions(oldVersionOptions, []);
  replaceOptions(restartVersionOptions, []);
  syncCreateVersion();
  syncCreateDnsName({ force: true });

  if (currentAction === "create") {
    refreshImages({ notify: false });
  }
});
field("network")?.addEventListener("input", () => {
  templateNetworkOverride = "";
});
field("network")?.addEventListener("change", () => {
  templateNetworkOverride = "";
});
field("image")?.addEventListener("input", () => {
  templateVersionOverride = "";
  updateOldVersionOptions();
});
field("image")?.addEventListener("change", () => {
  templateVersionOverride = "";
  updateOldVersionOptions();
});
field("image")?.addEventListener("change", () => {
  ensureCreateVersion();
});
field("oldversion")?.addEventListener("input", () => {
  updateSelectedVersionContainerNotice();
  updateRemoveOldImagesState();
});
field("version")?.addEventListener("input", updateRemoveOldImagesState);
field("restart_version")?.addEventListener("input", updateRestartButtons);
field("restart_version")?.addEventListener("input", updateSelectedVersionContainerNotice);
field("operate_action")?.addEventListener("change", updateOperateControls);
field("instance")?.addEventListener("input", () => {
  updateRestartButtons();
  syncCreateDnsName();
  syncVolumeNames();
});
field("dns_name")?.addEventListener("input", () => {
  generatedCreateDnsName = fieldValue("dns_name");
});
field("traefik")?.addEventListener("change", () => syncCreateDnsName({ force: !fieldValue("dns_name") }));
logsFullscreenBtn?.addEventListener("click", () => {
  setLogsExpanded(!logsCard?.classList.contains("fullscreen"));
});
clearLogsBtn?.addEventListener("click", clearLogs);
orderCancelBtn?.addEventListener("click", () => {
  window.location.href = "/";
});
orderInstances?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-instance-delete]");
  if (!button) return;
  deleteOrderInstance(Number(button.dataset.orderInstanceDelete)).catch(() => {
    setOrderStatus("Delete request failed", "error");
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dockerRunModal?.classList.contains("hidden")) {
    closeDockerRunModal();
  }
  if (event.key === "Escape" && !profileHelpModal?.classList.contains("hidden")) {
    closeProfileHelp();
  }
});

window.parseDockerRun = parseDockerRun;
window.isFqdn = isFqdn;
window.instanceFqdn = instanceFqdn;

async function initializePage() {
  initializeSidebar();
  await loadMailSettings();
  await loadCreateTemplates();
  updateTemplateOptions();
  setAction(currentAction);
  await loadSavedConfig();
  if (!isOrderPage && currentAction === "report") refreshImageReport();

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
