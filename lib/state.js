const fs = require("fs");
const path = require("path");

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
    order_instances: {},
    logs: "",
  };
}

function createStateStore(dataPath) {
  const stateFile = path.join(dataPath, "app-state.json");
  const legacyContextFile = path.join(dataPath, "context", "global", "global.json");

  function migrateLegacyState() {
    const legacy = readJson(legacyContextFile, {});
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return defaultState();
    return {
      config: plainObject(legacy.config),
      templates: plainObject(legacy.templates),
      order_counts: plainObject(legacy.order_counts),
      order_instances: plainObject(legacy.order_instances),
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

  return { readState, writeState, logLine, stateFile, legacyContextFile };
}

module.exports = {
  createStateStore,
  defaultState,
  parseProfiles,
  plainObject,
  readJson,
  writeJson,
};
