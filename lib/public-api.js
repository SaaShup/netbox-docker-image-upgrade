const crypto = require("crypto");

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requestOrigin(req) {
  const origin = String(req.get("origin") || "").replace(/\/+$/, "");
  if (origin) return origin;
  const referer = String(req.get("referer") || "");
  if (!referer) return "";
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function createPublicApiGuard({ allowedOrigins = [], allowedOriginSet = new Set(), secret = "" }) {
  function publicApiSecretAllowed(req) {
    if (!secret) return false;
    const provided = req.get("x-public-api-secret") || req.query.public_api_secret || "";
    return timingSafeStringEqual(provided, secret);
  }

  function publicApiSecretProvided(req) {
    return Boolean(req.get("x-public-api-secret") || req.query.public_api_secret);
  }

  function publicApiAllowed(req) {
    if (publicApiSecretAllowed(req)) return true;
    if (publicApiSecretProvided(req)) return false;
    const origin = requestOrigin(req);
    if (!origin && req.method === "GET" && req.path === "/registry/check") return true;
    return Boolean(origin && allowedOriginSet.has(origin));
  }

  return function publicApiGuard(req, res, next) {
    const origin = requestOrigin(req);
    if (origin && allowedOriginSet.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Public-Api-Secret");
    if (!allowedOrigins.length && !secret) {
      return res.status(401).json({ detail: "public api is not configured" });
    }
    if (!publicApiAllowed(req)) return res.status(403).json({ detail: "public api access denied" });
    if (req.method === "OPTIONS") return res.status(204).send("");
    return next();
  };
}

module.exports = {
  createPublicApiGuard,
  requestOrigin,
  timingSafeStringEqual,
};
