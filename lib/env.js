const path = require("path");

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function booleanFlag(value) {
  return ["true", "1"].includes(String(value || "").trim().toLowerCase());
}

function publicApiOriginVariants(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host === "saashup.com") return [origin, `${url.protocol}//www.saashup.com${url.port ? `:${url.port}` : ""}`];
    if (host === "www.saashup.com") return [origin, `${url.protocol}//saashup.com${url.port ? `:${url.port}` : ""}`];
  } catch {
    return [origin];
  }
  return [origin];
}

function loadEnv(env = process.env, rootDir = path.resolve(__dirname, "..")) {
  const dataPath = path.resolve(env.DATAPATH || path.join(rootDir, "data"));
  const appPath = path.resolve(env.APPPATH || rootDir);
  const publicApiAllowedOrigins = csv(env.PUBLIC_API_ALLOWED_ORIGINS).map((origin) => origin.replace(/\/+$/, ""));

  return {
    adminAllowedEmails: csv(env.ADMIN_ALLOWED_EMAILS).map((email) => email.toLowerCase()),
    appOwnerEmail: String(env.APP_OWNER_EMAIL || "").trim(),
    appPath,
    blockedEnrollmentImages: csv(env.SAASHUP_ENROLL_BLOCKED_IMAGES).map((image) => image.toLowerCase()),
    createConfigureDelayMs: Number(env.CREATE_CONFIGURE_DELAY_MS || 5000),
    createRecreateDelayMs: Number(env.CREATE_RECREATE_DELAY_MS || 5000),
    dataPath,
    oidc: {
      clientId: env.OIDC_CLIENT_ID || env.SAASHUP_OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET || env.SAASHUP_OIDC_CLIENT_SECRET,
      enabled: env.OIDC_ENABLED !== "false",
      issuerUrl: env.OIDC_ISSUER_URL || env.KEYCLOAK_ISSUER_URL,
      redirectUri: env.OIDC_REDIRECT_URI,
      sessionSecret: env.SESSION_SECRET || env.SAASHUP_SESSION_SECRET,
    },
    operationPollMs: Number(env.OPERATION_POLL_MS || 3000),
    operationTimeoutSeconds: Number(env.OPERATION_TIMEOUT_SECONDS || 30),
    port: Number(env.PORT || 1880),
    publicApiAllowedOrigins,
    publicApiAllowedOriginSet: new Set(publicApiAllowedOrigins.flatMap(publicApiOriginVariants)),
    publicApiSecret: String(env.PUBLIC_API_SECRET || ""),
    publicImage: booleanFlag(env.PUBLIC_IMAGE),
    publicPath: path.join(appPath, "public"),
    recreateOperationSettleDelayMs: Number(env.RECREATE_OPERATION_SETTLE_DELAY_MS || 0),
    registryWebhookSecret: String(env.REGISTRY_WEBHOOK_SECRET || ""),
    turnstileSecretKey: String(env.TURNSTILE_SECRET_KEY || ""),
  };
}

module.exports = {
  booleanFlag,
  csv,
  loadEnv,
  publicApiOriginVariants,
};
