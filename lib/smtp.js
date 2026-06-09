const nodemailer = require("nodemailer");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSmtpConfig(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const at = text.lastIndexOf("@");
  const target = at === -1 ? text : text.slice(at + 1);
  const auth = at === -1 ? "" : text.slice(0, at);
  const colon = target.lastIndexOf(":");
  if (colon === -1) return null;

  const host = target.slice(0, colon);
  const port = Number(target.slice(colon + 1));
  const authColon = auth.indexOf(":");
  const user = authColon === -1 ? auth : auth.slice(0, authColon);
  const password = authColon === -1 ? "" : auth.slice(authColon + 1);

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { user, password, host, port, secure: port === 465 };
}

function smtpSenderAddress(config, fallbackEmail = "") {
  if (config.user && config.user.includes("@")) return config.user;
  if (fallbackEmail) return fallbackEmail;
  const domain = String(config.host || "localhost").replace(/^smtp\./i, "") || "localhost";
  return `no-reply@${domain}`;
}

function smtpClientName(config) {
  const userDomain = String(config.user || "").split("@")[1];
  if (userDomain && userDomain.includes(".")) return userDomain.toLowerCase();

  const host = String(config.host || "").replace(/^smtp\./i, "").toLowerCase();
  if (host && host.includes(".")) return host;

  return "localhost.localdomain";
}

function smtpTransportOptions(config, timeoutMs) {
  return {
    name: smtpClientName(config),
    host: config.host,
    port: config.port,
    secure: Boolean(config.secure),
    requireTLS: config.port === 587,
    ...(config.user || config.password ? { auth: { user: config.user || "", pass: config.password || "" } } : {}),
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
}

function smtpMessage(message) {
  return {
    from: message.from,
    to: message.to,
    cc: message.cc,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: (Array.isArray(message.inlineImages) ? message.inlineImages : []).map((image) => ({
      filename: image.filename || "image",
      content: image.content,
      contentType: image.contentType || "application/octet-stream",
      cid: image.cid,
      encoding: "base64",
    })),
  };
}

function isTransientSmtpError(error) {
  const responseCode = Number(error?.responseCode || error?.code);
  if (responseCode >= 400 && responseCode < 500) return true;

  const errorCode = String(error?.code || "").toUpperCase();
  if (["ECONNRESET", "ETIMEDOUT", "ESOCKET"].includes(errorCode)) return true;

  const text = [error?.message, error?.response].filter(Boolean).join("\n");
  return /(^|\D)4\d\d(?:\D|$)|try again later|temporar/i.test(text);
}

async function sendSmtpMail(config, message, { timeoutMs = 10000, retries = 2, retryDelayMs = 2000 } = {}) {
  const payload = smtpMessage({
    ...message,
    from: message.from || smtpSenderAddress(config),
  });
  const attempts = Math.max(1, Number(retries) + 1 || 1);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const transporter = nodemailer.createTransport(smtpTransportOptions(config, timeoutMs));
    try {
      return await transporter.sendMail(payload);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientSmtpError(error)) throw error;
      await delay(retryDelayMs * attempt);
    } finally {
      if (typeof transporter.close === "function") transporter.close();
    }
  }

  throw lastError;
}

module.exports = {
  parseSmtpConfig,
  sendSmtpMail,
  smtpClientName,
  smtpSenderAddress,
  smtpMessage,
  smtpTransportOptions,
};
