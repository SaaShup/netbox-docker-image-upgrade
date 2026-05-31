const nodemailer = require("nodemailer");

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

function smtpTransportOptions(config, timeoutMs) {
  return {
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

async function sendSmtpMail(config, message, { timeoutMs = 10000 } = {}) {
  const transporter = nodemailer.createTransport(smtpTransportOptions(config, timeoutMs));
  return transporter.sendMail(smtpMessage({
    ...message,
    from: message.from || smtpSenderAddress(config),
  }));
}

module.exports = {
  parseSmtpConfig,
  sendSmtpMail,
  smtpSenderAddress,
  smtpMessage,
  smtpTransportOptions,
};
