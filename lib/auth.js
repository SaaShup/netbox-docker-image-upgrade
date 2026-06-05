const { parseProfiles, plainObject } = require("./state");

function firstHeader(req, names) {
  for (const name of names) {
    const value = req.headers[name];
    if (Array.isArray(value) && value[0]) return value[0];
    if (value) return value;
  }
  return "";
}

function authUserFromRequest(req) {
  if (req.authUser) return req.authUser;
  const email = firstHeader(req, ["x-auth-request-email", "x-forwarded-email", "x-auth-request-user-email"]);
  const user = firstHeader(req, ["x-auth-request-user", "x-forwarded-user", "x-auth-request-preferred-username", "x-forwarded-preferred-username"]);
  const name = firstHeader(req, ["x-auth-request-preferred-username", "x-forwarded-preferred-username", "x-auth-request-user", "x-forwarded-user", "x-auth-request-email", "x-forwarded-email"]);
  if (name || user || email || !("ENABLE_EDITOR" in process.env)) return { user, email, name };
  if (process.env.LOCAL_DEV_EMAIL) {
    const devEmail = process.env.LOCAL_DEV_EMAIL;
    return { user: devEmail, email: devEmail, name: devEmail };
  }
  const devUser = process.env.USER || process.env.LOGNAME || "Local dev";
  return { user: devUser, email: "", name: devUser };
}

function maxInstancesValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(100, Math.max(0, Math.floor(number)));
}

function createAuthHelpers({ adminAllowedEmails, readState }) {
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
    const profile = source?.profile || source?.config_profile || config.profile || config.config_profile || "";
    const profileConfig = profile && profiles[profile] ? profiles[profile] : {};
    return {
      ...config,
      ...profileConfig,
      ...plainObject(source),
      profile,
      config_profile: profile,
    };
  }

  return { isAdminAllowed, selectedProfileConfig, userOrderKey };
}

module.exports = {
  authUserFromRequest,
  createAuthHelpers,
  firstHeader,
  maxInstancesValue,
};
