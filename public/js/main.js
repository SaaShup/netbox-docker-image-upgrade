const urlParams = new URLSearchParams(window.location.search);
const actionFromUrl = urlParams.get("action");

const form = document.getElementById("instanceForm");
const submitBtn = document.getElementById("submitBtn");
const formTitle = document.getElementById("form-title");
const formDescription = document.getElementById("form-description");
const envList = document.getElementById("envList");
const addEnvBtn = document.getElementById("addEnvBtn");

let currentAction = localStorage.getItem("current_action") || "config";
let noticeTimeout = null;
let savedConfig = {};

const configFields = ["netbox", "token"];

const actions = {
  config: {
    endpoint: "/webhook",
    method: "get",
    menu: "menu_config",
    title: "Config",
    description: "Save the NetBox URL and token used by the automation.",
    submitLabel: "Save config",
    buttonClass: "btn btn-primary",
    fields: ["netbox", "token"],
  },
  create: {
    endpoint: "/create",
    method: "post",
    menu: "menu_create",
    title: "Create instance",
    description: "Create a container, volume, DNS record and Traefik labels.",
    submitLabel: "Create instance",
    buttonClass: "btn btn-primary",
    fields: ["hostname", "network", "instance", "image", "version", "env_vars"],
  },
  recreate: {
    endpoint: "/recreate",
    method: "post",
    menu: "menu_recreate",
    title: "Upgrade containers",
    description: "Replace containers matching an image and old version with a new version.",
    submitLabel: "Upgrade containers",
    buttonClass: "btn btn-primary",
    fields: ["image", "oldversion", "version", "delay"],
  },
  restart: {
    endpoint: "/restart",
    method: "post",
    menu: "menu_restart",
    title: "Restart containers",
    description: "Restart containers matching a host, image and version.",
    submitLabel: "Restart containers",
    buttonClass: "btn btn-primary",
    fields: ["hostname", "image", "oldversion", "delay"],
  },
  delete: {
    endpoint: "/delete",
    method: "post",
    menu: "menu_delete",
    title: "Delete instance",
    description: "Delete one instance. A confirmation will be requested before submitting.",
    submitLabel: "Delete instance",
    buttonClass: "btn btn-danger",
    fields: ["instance"],
    confirm: "Delete this instance?",
  },
};

const allFieldNames = [
  "netbox",
  "token",
  "hostname",
  "network",
  "instance",
  "image",
  "oldversion",
  "version",
  "delay",
  "var_env_key",
  "var_env_value",
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
  if (el) el.value = value || "";
}

function envRows() {
  return Array.from(envList?.querySelectorAll(".env-row") || []);
}

function updateEnvRemoveButtons() {
  const rows = envRows();
  rows.forEach((row) => {
    const button = row.querySelector(".env-remove");
    if (button) button.disabled = rows.length === 1;
  });
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

function clearEnvRows() {
  const rows = envRows();

  rows.slice(1).forEach((row) => row.remove());
  setFieldValue("var_env_key", "");
  setFieldValue("var_env_value", "");
  updateEnvRemoveButtons();
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
}

function clearActionFields() {
  const preserved = new Set(configFields);

  for (const name of allFieldNames) {
    if (preserved.has(name)) continue;
    setFieldValue(name, "");
  }

  clearEnvRows();
  setFieldValue("delay", "10000");
  setNotice("Form cleared", "success");
}

function loadSavedConfig() {
  return fetch("/config", {
    method: "GET",
    headers: { Accept: "application/json" },
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data) return {};

      savedConfig = data;
      setFieldValue("netbox", data.netbox || "");
      setFieldValue("token", data.token || "");
      return data;
    })
    .catch(() => {
      /* Config is optional. */
      return {};
    });
}

async function test() {
  let netbox = fieldValue("netbox") || savedConfig.netbox || "";
  let token = fieldValue("token") || savedConfig.token || "";

  if (!netbox || !token) {
    const config = await loadSavedConfig();
    netbox = netbox || config.netbox || "";
    token = token || config.token || "";
  }

  if (!netbox || !token) {
    setNotice("Save NetBox URL and token in Config first", "error");
    return;
  }

  fetch("/test", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      netbox,
      token,
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data["status"] || data["netbox-version"] || data["netbox-full-version"]) {
        setNotice("Connection successful", "success");
      } else {
        setNotice("Connection failed", "error");
      }
    })
    .catch(() => setNotice("Connection failed", "error"));
}

async function saveConfig() {
  const netbox = fieldValue("netbox");
  const token = fieldValue("token");

  if (!netbox || !token) {
    setNotice("NetBox URL and token are required", "error");
    return;
  }

  const params = new URLSearchParams({ netbox, token });

  try {
    await fetch(`/webhook?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    savedConfig = { netbox, token };
    setNotice("Config saved", "success");
  } catch {
    setNotice("Config save failed", "error");
  }
}

async function getLogs() {
  try {
    const response = await fetch("logs?last=true");
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    document.getElementById("logs").innerHTML = await response.text();
  } catch (err) {
    console.error("Error fetching logs:", err);
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

form.addEventListener("submit", (event) => {
  const config = actions[currentAction];

  if (currentAction === "config") {
    event.preventDefault();
    saveConfig();
    return;
  }

  if (config?.confirm && !confirm(config.confirm)) {
    event.preventDefault();
  }
});

document.getElementById("testBtn").addEventListener("click", test);
document.getElementById("clearBtn").addEventListener("click", clearActionFields);

if (actionFromUrl) {
  setNotice(actionFromUrl, "success");

  const actionKey = actionFromUrl.split(" ")[0].toLowerCase();
  if (actions[actionKey]) setAction(actionKey);

  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState(window.history.state, "", cleanUrl);
}

setFieldValue("delay", "10000");
setAction(currentAction);
loadSavedConfig();

getLogs();
setInterval(getLogs, 3000);
