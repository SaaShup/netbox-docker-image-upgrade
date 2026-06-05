const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const { fetch: undiciFetch } = require("undici");
const packageJson = require("./package.json");
const { registerConfigRoutes } = require("./api/config");
const { registerLimitRoutes } = require("./api/limits");
const { registerNetBoxRoutes } = require("./api/netbox");
const { registerOperationRoutes } = require("./api/operations");
const { registerRegistryWebhookRoutes } = require("./api/registry-webhooks");
const { registerSystemRoutes } = require("./api/system");
const { authUserFromRequest, createAuthHelpers, maxInstancesValue } = require("./lib/auth");
const {
  asArray,
  bindPayloadsFromForm,
  containerConfigPayloadFromForm,
  containerCreatePayloadFromForm,
  containerNetworkNames,
  dnsNameFromData,
  formData,
  hostMatchesTag,
  hostName,
  imageNameFromRef,
  instanceShort,
  instanceZone,
  normalizedSaashupLabelConfig,
  ownerEnvVarName,
  isContainerRunning,
  isContainerStopped,
  isOperationDone,
  isReadyContainer,
  traefikEnabled,
  valueText,
  volumePayloadsFromForm,
} = require("./lib/docker");
const { createMetrics, metricLabel, metricLine, operationLabel: operationLabelForMetrics, routeLabel: routeLabelForMetrics, statusClass } = require("./lib/metrics");
const { NetBoxClient, dockerHosts, hostIdQuery, setNetBoxFetchForTests } = require("./lib/netbox");
const { createOidcAuth, setOidcFetchForTests } = require("./lib/oidc");
const { createOperationHelpers, delay } = require("./lib/operations");
const { checkRegistryImageExists, setRegistryFetchForTests } = require("./lib/registry");
const { parseSmtpConfig, sendSmtpMail, smtpMessage, smtpSenderAddress, smtpTransportOptions } = require("./lib/smtp");
const { createStateStore, parseProfiles, plainObject } = require("./lib/state");

const app = express();
const dataPath = path.resolve(process.env.DATAPATH || path.join(__dirname, "data"));
const appPath = path.resolve(process.env.APPPATH || __dirname);
const publicPath = path.join(appPath, "public");
const saashupEmailLogo = (() => {
  try {
    return fs.readFileSync(path.join(publicPath, "assets/email/saashup-logo.png")).toString("base64");
  } catch {
    return "";
  }
})();
const startedAt = Date.now();
const operationTimeoutSeconds = Number(process.env.OPERATION_TIMEOUT_SECONDS || 30);
const operationPollMs = Number(process.env.OPERATION_POLL_MS || 3000);
const createConfigureDelayMs = Number(process.env.CREATE_CONFIGURE_DELAY_MS || 5000);
const createRecreateDelayMs = Number(process.env.CREATE_RECREATE_DELAY_MS || 5000);
const registryWebhookSecret = String(process.env.REGISTRY_WEBHOOK_SECRET || "");
const appOwnerEmail = String(process.env.APP_OWNER_EMAIL || "").trim();
const adminAllowedEmails = String(process.env.ADMIN_ALLOWED_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const publicApiAllowedOrigins = String(process.env.PUBLIC_API_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const publicApiSecret = String(process.env.PUBLIC_API_SECRET || "");
const turnstileSecretKey = String(process.env.TURNSTILE_SECRET_KEY || "");
const oidcAuth = createOidcAuth({
  clientId: process.env.OIDC_CLIENT_ID || process.env.SAASHUP_OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET || process.env.SAASHUP_OIDC_CLIENT_SECRET,
  enabled: process.env.OIDC_ENABLED !== "false",
  issuerUrl: process.env.OIDC_ISSUER_URL || process.env.KEYCLOAK_ISSUER_URL,
  redirectUri: process.env.OIDC_REDIRECT_URI,
  sessionSecret: process.env.SESSION_SECRET || process.env.SAASHUP_SESSION_SECRET,
});

const metrics = createMetrics();
const { readState, writeState, logLine } = createStateStore(dataPath);
const { isAdminAllowed, selectedProfileConfig, userOrderKey } = createAuthHelpers({ adminAllowedEmails, readState });
let smtpSender = sendSmtpMail;
let turnstileFetch = undiciFetch;
const {
  createDnsRecord,
  deleteDnsRecord,
  ensureImageOnHost,
  requestContainerOperation,
  waitForContainerConfigured,
  waitForContainerStopped,
  waitForHostReady,
} = createOperationHelpers({ logLine, operationPollMs, operationTimeoutSeconds });

function routeLabel(req) {
  return routeLabelForMetrics(req, metrics);
}

function operationLabel(req) {
  return operationLabelForMetrics(req, metrics);
}

function sendAccepted(res, body = { status: "requested" }) {
  res.status(202).json(body);
}

function asyncOperation(res, fn) {
  sendAccepted(res);
  fn().catch((error) => {
    logLine(`ERROR : ${error.message || "operation failed"} payload=${JSON.stringify(error.payload || {}).slice(0, 240)}`);
  });
}

function waitForRequest(data) {
  return data.wait === true || data.wait === "true" || data.wait === "on";
}

function allHostsEnabled(data) {
  return data.all_hosts === true || data.all_hosts === "true" || data.all_hosts === "on";
}

function hostIdValue(value) {
  return String(value?.id || value || "");
}

function hostLoadStats(hosts, containers) {
  return hosts.map((host) => {
    const hostId = hostIdValue(host.id);
    return {
      host,
      count: containers.filter((container) => hostIdValue(container.host) === hostId).length,
    };
  });
}

function leastLoadedHost(hosts, containers) {
  return hostLoadStats(hosts, containers)
    .sort((left, right) => left.count - right.count)[0]?.host;
}

function hostLoadSummary(stats) {
  return stats.map((item) => `${hostName(item.host)}=${item.count}`).join(",");
}

function dockerVolumeHostId(volume) {
  const host = volume?.host;
  return String(host?.id || host || "");
}

async function existingDockerVolume(client, volume) {
  const volumes = await client.list("/api/plugins/docker/volumes/", { host_id: volume.host, name: volume.name, limit: 10 });
  return volumes.find((item) => (
    String(item?.name || "") === String(volume.name || "")
    && (!volume.host || dockerVolumeHostId(item) === String(volume.host))
  ));
}

async function missingDockerVolumes(client, volumes) {
  const missing = [];
  let reused = 0;
  for (const volume of volumes) {
    if (await existingDockerVolume(client, volume)) {
      reused += 1;
    } else {
      missing.push(volume);
    }
  }
  return { missing, reused };
}

function currentUsage(req, profile) {
  const state = readState();
  const counts = plainObject(state.order_counts);
  const instances = plainObject(state.order_instances);
  const userKey = userOrderKey(req);
  const emailKey = String(authUserFromRequest(req).email || "").trim().toLowerCase();
  const body = plainObject(req.body);
  const requestedTemplate = String(req.query.template || body.order_template || "").trim();
  const template = orderTemplateEntry(requestedTemplate)?.template || {};
  const max = maxInstancesValue(template.max_instances ?? body.max_instances ?? 1);
  const userInstances = emailKey && Array.isArray(instances[emailKey]?.[profile]) ? instances[emailKey][profile] : [];
  const templateInstances = requestedTemplate
    ? userInstances.filter((item) => String(item?.template || "").trim().toLowerCase() === requestedTemplate.toLowerCase())
    : userInstances;
  const used = templateInstances.length || (userInstances.length ? 0 : Number(counts[userKey]?.[profile] || 0));
  const visibleInstances = requestedTemplate ? templateInstances : userInstances;
  return {
    profile,
    template: requestedTemplate,
    used,
    total_used: visibleInstances.length || used,
    max,
    remaining: Math.max(0, max - used),
    reached: used >= max,
    instances: visibleInstances,
  };
}

function currentEnrollmentUsage(req, profile) {
  const instances = enrollmentTemplatesForUser(req, profile);
  const used = instances.length;
  const config = selectedProfileConfig({ profile, config_profile: profile });
  const max = maxInstancesValue(config.max_templates ?? config.enrollment_limit);
  return { profile, used, max, remaining: Math.max(0, max - used), reached: used >= max, instances };
}

function enrollmentTemplatesForUser(req, profile) {
  const user = authUserFromRequest(req);
  const creator = String(user.email || user.user || "").trim().toLowerCase();
  if (!creator) return [];

  return Object.entries(plainObject(readState().templates))
    .map(([name, template]) => ({ name, template: plainObject(template) }))
    .filter(({ template }) => String(template.creator_email || "").trim().toLowerCase() === creator)
    .map(({ name, template }) => ({
      instance: name,
      dns_name: "",
      image: template.image || "",
      version: template.version || "",
      template_url: template.template_url || template.saashup_template_url || "",
      status: "ready",
      source: "template",
    }))
    .filter((item) => item.instance);
}

function recordEnrollment(req, profile, data) {
  writeState((state) => {
    const userKey = userOrderKey(req);
    const user = authUserFromRequest(req);
    const creatorEmail = String(user.email || user.user || "").trim();
    const templateName = String(data.order_template || data.template_name || data.instance || data.image || "").trim();
    if (templateName) {
      state.templates = plainObject(state.templates);
      const existing = plainObject(state.templates[templateName]);
      state.templates[templateName] = {
        ...existing,
        config_profile: profile || data.config_profile || data.profile || existing.config_profile || existing.profile || "",
        instance: data.instance || existing.instance || "",
        dns_name: data.dns_name || existing.dns_name || "",
        image: data.image || existing.image || "",
        version: data.version || existing.version || "",
        max_instances: maxInstancesValue(data.max_instances ?? existing.max_instances),
        template_url: data.template_url || data.saashup_template_url || existing.template_url || existing.saashup_template_url || "",
        network: data.network || existing.network || "",
        traefik: data.traefik ?? existing.traefik ?? true,
        all_hosts: data.all_hosts ?? existing.all_hosts ?? false,
        creator_email: existing.creator_email || creatorEmail,
        env: asArray(data.var_env_key).map((key, index) => ({ key, value: asArray(data.var_env_value)[index] || "" })).filter((item) => item.key),
        labels: asArray(data.label_key).map((key, index) => ({ key, value: asArray(data.label_value)[index] || "" })).filter((item) => item.key),
        ports: asArray(data.port_value).filter(Boolean).map((value) => ({ value })),
      };
    }

    state.enrollment_counts = plainObject(state.enrollment_counts);
    if (!state.enrollment_counts[userKey]) state.enrollment_counts[userKey] = {};
    state.enrollment_counts[userKey][profile] = Number(state.enrollment_counts[userKey][profile] || 0) + 1;

    state.enrollment_instances = plainObject(state.enrollment_instances);
    if (!state.enrollment_instances[userKey]) state.enrollment_instances[userKey] = {};
    const instances = Array.isArray(state.enrollment_instances[userKey][profile]) ? state.enrollment_instances[userKey][profile] : [];
    instances.push({
      instance: data.instance || "",
      dns_name: data.dns_name || "",
      image: data.image || "",
      version: data.version || "",
      template_url: data.template_url || data.saashup_template_url || "",
      status: "creating",
      created_at: new Date().toISOString(),
    });
    state.enrollment_instances[userKey][profile] = instances;
    return state;
  });
}

function orderTemplateEnabled(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  return !["false", "0", "off", "no", "disabled"].includes(String(value).trim().replace(/;+$/, "").toLowerCase());
}

function orderTemplateEntry(name) {
  const requestedName = String(name || "").trim();
  if (!requestedName) return null;

  const templates = plainObject(readState().templates);
  if (Object.hasOwn(templates, requestedName)) return { name: requestedName, template: plainObject(templates[requestedName]) };

  const match = Object.keys(templates).find((templateName) => templateName.toLowerCase() === requestedName.toLowerCase());
  return match ? { name: match, template: plainObject(templates[match]) } : null;
}

function validateOrderTemplate(req, res) {
  const requestedName = String(req.body.order_template || "").trim();
  if (!requestedName) return true;

  const entry = orderTemplateEntry(requestedName);
  if (!entry) {
    return true;
  }

  if (!orderTemplateEnabled(entry.template.saashup_enabled, true)) {
    res.status(403).json({ code: "template_disabled", detail: `Template "${entry.name}" is disabled for orders` });
    return false;
  }

  return true;
}

function templatesWithCreatorEmails(templates, existingTemplates, creatorEmail) {
  const email = String(creatorEmail || "").trim();
  return Object.fromEntries(
    Object.entries(plainObject(templates)).map(([name, template]) => {
      const entry = plainObject(template);
      const existing = plainObject(existingTemplates[name]);
      const creator_email = String(Object.hasOwn(entry, "creator_email") ? entry.creator_email : (existing.creator_email || email || "")).trim();
      return [
        name,
        creator_email ? { ...entry, creator_email } : entry,
      ];
    }),
  );
}

function profilesWithSingleDefault(profiles) {
  const entries = Object.entries(plainObject(profiles));
  const defaultName = entries.find(([, profile]) => plainObject(profile).saashup_default === true)?.[0] || "";
  return Object.fromEntries(entries.map(([name, profile]) => {
    const entry = plainObject(profile);
    if (name !== defaultName || entry.saashup_default !== true) delete entry.saashup_default;
    return [name, entry];
  }));
}

function recordOrderInstance(req, profile, data) {
  writeState((state) => {
    const userKey = userOrderKey(req);
    const emailKey = String(authUserFromRequest(req).email || "").trim().toLowerCase();
    state.order_counts = plainObject(state.order_counts);
    if (!state.order_counts[userKey]) state.order_counts[userKey] = {};
    state.order_counts[userKey][profile] = Number(state.order_counts[userKey][profile] || 0) + 1;

    if (emailKey) {
      state.order_instances = plainObject(state.order_instances);
      if (!state.order_instances[emailKey]) state.order_instances[emailKey] = {};
      const instances = Array.isArray(state.order_instances[emailKey][profile]) ? state.order_instances[emailKey][profile] : [];
      instances.push({
        instance: data.instance || "",
        dns_name: data.dns_name || "",
        template: data.order_template || "",
        image: data.image || "",
        version: data.version || "",
        status: "creating",
        created_at: new Date().toISOString(),
      });
      state.order_instances[emailKey][profile] = instances;
    }
    return state;
  });
}

function updateOrderInstanceStatus(req, profile, instance, status) {
  const emailKey = String(authUserFromRequest(req).email || "").trim().toLowerCase();
  if (!emailKey) return;

  writeState((state) => {
    state.order_instances = plainObject(state.order_instances);
    const instances = Array.isArray(state.order_instances[emailKey]?.[profile]) ? state.order_instances[emailKey][profile] : [];
    const target = instances.find((item) => item.instance === instance);
    if (target) {
      target.status = status;
      target.updated_at = new Date().toISOString();
    }
    return state;
  });
}

function updateEnrollmentInstanceStatus(req, profile, instance, status) {
  const userKey = userOrderKey(req);

  writeState((state) => {
    state.enrollment_instances = plainObject(state.enrollment_instances);
    const instances = Array.isArray(state.enrollment_instances[userKey]?.[profile]) ? state.enrollment_instances[userKey][profile] : [];
    const target = instances.find((item) => item.instance === instance);
    if (target) {
      target.status = status;
      target.updated_at = new Date().toISOString();
    }
    return state;
  });
}

function removeOrderInstance(req, profile, instance) {
  writeState((state) => {
    const userKey = userOrderKey(req);
    const emailKey = String(authUserFromRequest(req).email || "").trim().toLowerCase();
    state.order_counts = plainObject(state.order_counts);
    if (state.order_counts[userKey]) {
      state.order_counts[userKey][profile] = Math.max(0, Number(state.order_counts[userKey][profile] || 0) - 1);
    }
    if (emailKey) {
      state.order_instances = plainObject(state.order_instances);
      const instances = Array.isArray(state.order_instances[emailKey]?.[profile]) ? state.order_instances[emailKey][profile] : [];
      if (state.order_instances[emailKey]) {
        state.order_instances[emailKey][profile] = instances.filter((item) => item.instance !== instance);
      }
    }
    return state;
  });
}

function exactContainerNameMatches(containers, name) {
  const expected = instanceShort(name);
  const items = asArray(containers);
  const matches = items.filter((container) => {
    const names = [
      container?.name,
      container?.display,
      container?.container_name,
      container?.container,
    ].map((value) => instanceShort(valueText(value))).filter(Boolean);
    return names.includes(expected);
  });
  return matches.length || items.length !== 1 ? matches : items;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function orderReadyEmail(data, recipient, smtpConfig, { ccOwner = true } = {}) {
  const instance = dnsNameFromData(data) || data.instance || "your instance";
  const image = data.image || "";
  const cc = ccOwner && appOwnerEmail && appOwnerEmail.toLowerCase() !== String(recipient || "").toLowerCase() ? [appOwnerEmail] : [];
  const actionUrl = /^https?:\/\//i.test(instance) ? instance : `https://${instance}`;
  const text = [
    "Hello,",
    "",
    `Your instance is now running: ${instance}`,
    image ? `Image: ${image}` : "",
    "",
    "You can start using it now.",
  ].filter((line) => line !== "").join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e7ef;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#111827;color:#ffffff;">
                <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#ffffff;">
                  ${saashupEmailLogo ? `<img src="cid:saashup-logo" width="28" height="26" alt="SaaShup" style="display:inline-block;vertical-align:middle;margin-right:8px;background:#ffffff;border-radius:4px;padding:2px;">` : ""}
                  <span style="vertical-align:middle;color:#ffffff;">SaaShup</span>
                </div>
                <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;">Your instance is ready</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Hello,</p>
                <p style="margin:0 0 20px;font-size:16px;line-height:1.5;">Your instance is now running and ready to use.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border-collapse:collapse;">
                  <tr>
                    <td style="padding:10px 0;color:#667085;font-size:13px;border-bottom:1px solid #eef0f5;">Instance</td>
                    <td style="padding:10px 0;text-align:right;font-size:14px;border-bottom:1px solid #eef0f5;"><strong>${escapeHtml(instance)}</strong></td>
                  </tr>
                  ${image ? `<tr>
                    <td style="padding:10px 0;color:#667085;font-size:13px;border-bottom:1px solid #eef0f5;">Image</td>
                    <td style="padding:10px 0;text-align:right;font-size:14px;border-bottom:1px solid #eef0f5;">${escapeHtml(image)}</td>
                  </tr>` : ""}
                </table>
                <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:6px;">Open instance</a>
                <p style="margin:24px 0 0;color:#667085;font-size:13px;line-height:1.5;">If the button does not work, open this URL: ${escapeHtml(actionUrl)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return {
    from: smtpSenderAddress(smtpConfig, appOwnerEmail),
    to: recipient,
    cc,
    subject: `${instance} is ready`,
    text,
    html,
    inlineImages: saashupEmailLogo ? [{
      cid: "saashup-logo",
      filename: "saashup-logo.png",
      contentType: "image/png",
      content: saashupEmailLogo,
    }] : [],
  };
}

async function sendOrderReadyEmail(data, recipient) {
  const smtpConfig = parseSmtpConfig(data.smtp_config);
  if (!smtpConfig || !recipient) return;

  const info = await smtpSender(smtpConfig, orderReadyEmail(data, recipient, smtpConfig));
  logLine(`EMAIL : ready notification sent to ${recipient} for ${data.instance || ""} ${smtpInfoText(info)}`);
}

function smtpInfoText(info) {
  if (!info || typeof info !== "object") return "";
  const accepted = Array.isArray(info.accepted) ? info.accepted.join(",") : "";
  const rejected = Array.isArray(info.rejected) ? info.rejected.join(",") : "";
  return [
    info.messageId ? `messageId=${info.messageId}` : "",
    accepted ? `accepted=${accepted}` : "",
    rejected ? `rejected=${rejected}` : "",
    info.response ? `response=${String(info.response).slice(0, 120)}` : "",
  ].filter(Boolean).join(" ");
}

function contactProfileConfig(source) {
  const profile = source?.profile || source?.config_profile || "";
  return selectedProfileConfig(profile ? { profile, config_profile: profile } : {});
}

function cleanContactField(value, limit = 500) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, limit);
}

function contactEmailAddress(value) {
  const email = cleanContactField(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function contactTurnstileToken(data) {
  return cleanContactField(data.turnstileToken || data.turnstile_token || data["cf-turnstile-response"], 4096);
}

function requestIp(req) {
  const forwarded = String(req.get("cf-connecting-ip") || req.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "";
}

async function verifyContactTurnstile(data, req) {
  if (!turnstileSecretKey) return;
  const token = contactTurnstileToken(data);
  if (!token) {
    const error = new Error("captcha verification is required");
    error.statusCode = 400;
    throw error;
  }

  const form = new URLSearchParams();
  form.set("secret", turnstileSecretKey);
  form.set("response", token);
  const ip = requestIp(req);
  if (ip) form.set("remoteip", ip);

  let response;
  try {
    response = await turnstileFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch {
    const error = new Error("captcha verification failed");
    error.statusCode = 502;
    throw error;
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || !payload.success) {
    const error = new Error("captcha verification failed");
    error.statusCode = 403;
    throw error;
  }
}

function contactFormEmail(data, smtpConfig) {
  const name = cleanContactField(data.name, 120);
  const email = contactEmailAddress(data.email);
  const subject = cleanContactField(data.subject, 160) || "Website contact";
  const message = cleanContactField(data.message, 5000);
  const phone = cleanContactField(data.phone, 80);
  const company = cleanContactField(data.company, 120);
  const page = cleanContactField(data.page || data.url, 500);
  const lines = [
    "New website contact form message",
    "",
    name ? `Name: ${name}` : "",
    email ? `Email: ${email}` : "",
    phone ? `Phone: ${phone}` : "",
    company ? `Company: ${company}` : "",
    page ? `Page: ${page}` : "",
    "",
    message,
  ].filter((line) => line !== "").join("\n");

  return {
    from: smtpSenderAddress(smtpConfig, appOwnerEmail),
    to: appOwnerEmail,
    replyTo: email || undefined,
    subject: `Website contact: ${subject}`,
    text: lines,
    html: `<!doctype html>
<html>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#172033;line-height:1.5;">
    <h1 style="font-size:20px;margin:0 0 16px;">New website contact form message</h1>
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 20px;">
      ${name ? `<tr><td style="padding:4px 16px 4px 0;color:#667085;">Name</td><td style="padding:4px 0;">${escapeHtml(name)}</td></tr>` : ""}
      ${email ? `<tr><td style="padding:4px 16px 4px 0;color:#667085;">Email</td><td style="padding:4px 0;">${escapeHtml(email)}</td></tr>` : ""}
      ${phone ? `<tr><td style="padding:4px 16px 4px 0;color:#667085;">Phone</td><td style="padding:4px 0;">${escapeHtml(phone)}</td></tr>` : ""}
      ${company ? `<tr><td style="padding:4px 16px 4px 0;color:#667085;">Company</td><td style="padding:4px 0;">${escapeHtml(company)}</td></tr>` : ""}
      ${page ? `<tr><td style="padding:4px 16px 4px 0;color:#667085;">Page</td><td style="padding:4px 0;">${escapeHtml(page)}</td></tr>` : ""}
    </table>
    <div style="white-space:pre-wrap;border-top:1px solid #e4e7ef;padding-top:16px;">${escapeHtml(message)}</div>
  </body>
</html>`,
  };
}

async function sendContactEmail(data) {
  if (cleanContactField(data.website || data.url_honeypot, 200)) return { skipped: true };
  const config = contactProfileConfig(data);
  const smtpConfig = parseSmtpConfig(config.smtp_config);
  if (!appOwnerEmail) {
    const error = new Error("owner email is not configured");
    error.statusCode = 400;
    throw error;
  }
  if (!smtpConfig) {
    const error = new Error("smtp config is not configured");
    error.statusCode = 400;
    throw error;
  }
  if (!contactEmailAddress(data.email)) {
    const error = new Error("valid email is required");
    error.statusCode = 400;
    throw error;
  }
  if (!cleanContactField(data.message, 5000)) {
    const error = new Error("message is required");
    error.statusCode = 400;
    throw error;
  }

  const info = await smtpSender(smtpConfig, contactFormEmail(data, smtpConfig));
  logLine(`EMAIL : contact message sent from ${contactEmailAddress(data.email)} ${smtpInfoText(info)}`);
  return info;
}

async function sendTestEmail(data) {
  const smtpConfig = parseSmtpConfig(data.smtp_config);
  if (!appOwnerEmail) {
    const error = new Error("owner email is not configured");
    error.statusCode = 400;
    throw error;
  }
  if (!smtpConfig) {
    const error = new Error("smtp config is not configured");
    error.statusCode = 400;
    throw error;
  }

  const info = await smtpSender(smtpConfig, orderReadyEmail({
    ...data,
    instance: data.instance || "test-instance.example.com",
    image: data.image || "saashup/example",
    version: data.version || "test",
  }, appOwnerEmail, smtpConfig, { ccOwner: false }));
  logLine(`EMAIL : test notification sent to owner for ${data.profile || data.config_profile || "default"} ${smtpInfoText(info)}`);
  return info;
}

function requireAdmin(req, res, next) {
  const user = authUserFromRequest(req);
  if (oidcAuth.enabled && !user.email && !user.user && !user.name) return oidcAuth.loginRequired(req, res, next);
  if (isAdminAllowed(req)) return next();
  metrics.adminForbidden += 1;
  res.status(403).sendFile(path.join(publicPath, "forbidden.html"));
}

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

function publicApiSecretAllowed(req) {
  if (!publicApiSecret) return false;
  const provided = req.get("x-public-api-secret") || req.query.public_api_secret || "";
  return timingSafeStringEqual(provided, publicApiSecret);
}

function publicApiAllowed(req) {
  if (publicApiSecretAllowed(req)) return true;
  const origin = requestOrigin(req);
  return Boolean(origin && publicApiAllowedOrigins.includes(origin));
}

function publicApiGuard(req, res, next) {
  const origin = requestOrigin(req);
  if (origin && publicApiAllowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Public-Api-Secret");
  if (!publicApiAllowedOrigins.length && !publicApiSecret) {
    return res.status(401).json({ detail: "public api is not configured" });
  }
  if (!publicApiAllowed(req)) return res.status(403).json({ detail: "public api access denied" });
  if (req.method === "OPTIONS") return res.status(204).send("");
  return next();
}

function templateMatchesRegistryWebhook(template, profile, image) {
  const entry = plainObject(template);
  const templateProfile = String(entry.config_profile || entry.profile || "").trim();
  const templateImage = imageNameFromRef(entry.image || "");
  return templateImage === image && (!templateProfile || templateProfile === profile);
}

function registryWebhookTemplates(profile, image) {
  const templates = plainObject(readState().templates);
  return Object.entries(templates)
    .map(([name, template]) => ({ name, template: plainObject(template) }))
    .filter((entry) => templateMatchesRegistryWebhook(entry.template, profile, image));
}

function registryWebhookTemplateSecret(profile, templateName, events = []) {
  const entry = orderTemplateEntry(templateName);
  if (!entry) return "";
  const imageMatches = events.length
    ? events.some((event) => templateMatchesRegistryWebhook(entry.template, profile, event.image))
    : templateMatchesRegistryWebhook(entry.template, profile, "");
  if (!imageMatches) return "";
  return String(entry.template.registry_webhook_secret || entry.template.dockerhub_webhook_secret || "");
}

function registrySecretForTemplate(name, image = "") {
  const entry = orderTemplateEntry(name);
  if (!entry) return registryWebhookSecret;
  if (image && !templateMatchesRegistryWebhook(entry.template, String(entry.template.config_profile || entry.template.profile || ""), imageNameFromRef(image))) return registryWebhookSecret;
  return String(entry.template.registry_webhook_secret || entry.template.dockerhub_webhook_secret || registryWebhookSecret || "");
}

function addRegistryWebhookEvent(events, image, tag) {
  const eventImage = imageNameFromRef(image || "");
  const eventTag = String(tag || "").trim();
  if (eventImage && eventTag) events.push({ image: eventImage, tag: eventTag });
}

function imageFromDistributionTarget(target) {
  const entry = plainObject(target);
  const url = String(entry.url || "");
  if (url) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/^\/v2\/(.+)\/manifests\/[^/]+$/);
      if (match) return `${parsed.host}/${match[1]}`;
    } catch {
      // Fall back to the repository field below.
    }
  }
  return entry.repository || "";
}

function githubPackageImage(payload) {
  const root = plainObject(payload);
  const registryPackage = plainObject(root.registry_package || root.package);
  const packageName = String(registryPackage.name || root.name || "").trim();
  if (!packageName) return "";
  if (packageName.includes("/") || packageName.startsWith("ghcr.io/")) return packageName;
  const owner = plainObject(registryPackage.owner || root.organization || root.repository?.owner || root.sender);
  const login = String(owner.login || owner.name || "").trim();
  return login ? `ghcr.io/${login}/${packageName}` : packageName;
}

function githubPackageTag(payload) {
  const root = plainObject(payload);
  const version = plainObject(root.package_version || root.registry_package?.package_version);
  const metadata = plainObject(version.container_metadata);
  const tag = plainObject(metadata.tag);
  return tag.name || version.name || root.package_version_name || "";
}

function registryWebhookEvents(payload) {
  const body = plainObject(payload);
  const events = [];

  addRegistryWebhookEvent(events, body.repository?.repo_name, body.push_data?.tag);

  const quayTags = Array.isArray(body.updated_tags) ? body.updated_tags : Array.isArray(body.docker_tags) ? body.docker_tags : [];
  quayTags.forEach((tag) => addRegistryWebhookEvent(events, body.docker_url || body.repository, tag));

  const distributionEvents = Array.isArray(body.events) ? body.events : [];
  distributionEvents
    .filter((event) => !event.action || event.action === "push")
    .forEach((event) => {
      const target = plainObject(event.target);
      addRegistryWebhookEvent(events, imageFromDistributionTarget(target), target.tag);
    });

  addRegistryWebhookEvent(events, githubPackageImage(body), githubPackageTag(body));

  return events;
}

function registryWebhookAllowed(req, events = registryWebhookEvents(req.body)) {
  const profile = String(req.params.profile || "");
  const template = String(req.params.template || "");
  const matchingSecrets = template
    ? [registryWebhookTemplateSecret(profile, template, events)].filter(Boolean)
    : events.flatMap((event) => registryWebhookTemplates(profile, event.image)
      .map((entry) => String(entry.template.registry_webhook_secret || entry.template.dockerhub_webhook_secret || ""))
      .filter(Boolean));
  const secrets = matchingSecrets.length ? matchingSecrets : [registryWebhookSecret].filter(Boolean);
  if (!secrets.length) return true;
  const provided = req.params.secret || req.query.secret || req.get("x-saashup-webhook-secret") || "";
  return secrets.some((secret) => timingSafeStringEqual(provided, secret));
}

app.disable("x-powered-by");
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const label = routeLabel(req);
  metrics.httpRequests[label] = (metrics.httpRequests[label] || 0) + 1;
  const operation = operationLabel(req);
  if (operation) {
    res.once("finish", () => {
      const bucket = statusClass(res.statusCode);
      metrics.operationRequests[operation][bucket] = (metrics.operationRequests[operation][bucket] || 0) + 1;
    });
  }
  next();
});

registerRegistryWebhookRoutes(app, {
  logLine,
  recreateContainers,
  registryWebhookAllowed,
  registryWebhookEvents,
  selectedProfileConfig,
});

registerSystemRoutes(app, {
  authUserFromRequest,
  metricLine,
  metrics,
  oidcAuth,
  packageJson,
  publicPath,
  requireAdmin,
  startedAt,
});

function mergeProfileMaps(existing, imported) {
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(imported).map(([key, value]) => [
        key,
        { ...plainObject(existing[key]), ...plainObject(value) },
      ]),
    ),
  };
}

registerConfigRoutes(app, {
  appOwnerEmail,
  authUserFromRequest,
  maxInstancesValue,
  mergeProfileMaps,
  packageJson,
  parseProfiles,
  plainObject,
  profilesWithSingleDefault,
  publicApiGuard,
  readState,
  registrySecretForTemplate,
  registryWebhookSecret,
  requireAdmin,
  selectedProfileConfig,
  sendContactEmail,
  sendTestEmail,
  templatesWithCreatorEmails,
  verifyContactTurnstile,
  writeState,
});

async function testConnection(req, res) {
  try {
    const client = new NetBoxClient(selectedProfileConfig(formData(req)));
    const { payload } = await client.request("GET", "/api/status/", { expected: [200] });
    res.json(payload);
  } catch (error) {
    res.status(error.statusCode || 502).json({ detail: error.message, payload: error.payload });
  }
}

function reportProfiles(source) {
  const state = readState();
  const config = plainObject(state.config);
  const profiles = parseProfiles(config.profiles);
  const requested = source.profile || source.config_profile || "";
  const profileConfig = (name) => ({
    ...config,
    ...plainObject(profiles[name]),
    ...plainObject(source),
    profile: name,
    config_profile: name,
  });

  if (requested && requested !== "all") {
    return [{ name: requested, config: profileConfig(requested) }];
  }

  const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
  if (requested === "all" && names.length) {
    return names.map((name) => ({ name, config: profileConfig(name) }));
  }

  const selected = config.profile || config.config_profile || names[0] || "";
  if (selected) {
    return [{ name: selected, config: profileConfig(selected) }];
  }

  return [{ name: "", config: selectedProfileConfig(source) }];
}

function localOrderReportUsers(profile, profiles) {
  const state = readState();
  const counts = plainObject(state.order_counts);
  const instances = plainObject(state.order_instances);
  const profileNames = profile === "all" ? profiles.map((item) => item.name).filter(Boolean) : [profile || ""];
  const includeAllProfiles = profile === "all" && !profileNames.length;

  return Object.entries(counts).flatMap(([user, userCounts]) => {
    const normalizedCounts = plainObject(userCounts);
    const names = includeAllProfiles
      ? Object.keys(normalizedCounts).filter((name) => Number(normalizedCounts[name] || 0) > 0)
      : profileNames.filter((name) => Number(normalizedCounts[name] || 0) > 0);

    if (!names.length) return [];

    const items = names.flatMap((name) => {
      const profileInstances = Array.isArray(instances[user]?.[name]) ? instances[user][name] : [];
      return profileInstances.map((item) => ({
        profile: name || "default",
        container: valueText(item.instance || item.name),
        image: valueText(item.image || item.template),
        version: valueText(item.version),
      }));
    });

    const containers = items.length || names.reduce((total, name) => total + Number(normalizedCounts[name] || 0), 0);
    const imageKeys = new Set(items.map((item) => `${item.image}\u0000${item.version}`).filter((key) => key !== "\u0000"));

    return [{
      user,
      profiles: names.map((name) => name || "default").sort((left, right) => left.localeCompare(right)),
      containers,
      images: imageKeys.size,
      items: items.sort((left, right) => left.profile.localeCompare(right.profile) || left.container.localeCompare(right.container)),
    }];
  }).sort((left, right) => left.user.localeCompare(right.user));
}

function containerEnvValue(container, name) {
  const entries = [
    ...(Array.isArray(container?.env) ? container.env : []),
    ...(Array.isArray(container?.env_vars) ? container.env_vars : []),
    ...(Array.isArray(container?.environment) ? container.environment : []),
  ];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const key = valueText(entry.var_name || entry.name || entry.key);
    if (key === name) return valueText(entry.value);
  }

  return "";
}

async function imageReportForProfile(name, config) {
  const label = name || "default";
  if (!config.netbox || !config.token) {
    logLine(`REPORT_IMAGE : ${label} skipped missing NetBox config`);
    return { hosts: 0, rows: [] };
  }

  const client = new NetBoxClient(config);
  const hosts = await dockerHosts(client, config.tag);
  if (!hosts.length) {
    logLine(`REPORT_IMAGE : ${label} no Docker hosts found${config.tag ? ` with tag ${config.tag}` : ""}`);
    return { hosts: 0, rows: [] };
  }

  logLine(`REPORT_IMAGE : ${label} scanning ${hosts.length} host${hosts.length === 1 ? "" : "s"}${config.tag ? ` tag=${config.tag}` : ""}`);
  const images = await client.list("/api/plugins/docker/images/", { limit: 1000, host_id: hosts.map((host) => host.id) });
  logLine(`REPORT_IMAGE : ${label} found ${images.length} image record${images.length === 1 ? "" : "s"}`);
  const groups = new Map();
  const ownerEnvName = ownerEnvVarName(config);
  const owners = new Set();
  const usersByOwner = new Map();

  for (const image of images) {
    const imageName = imageNameFromRef(image.name || image.display || "");
    const version = valueText(image.version || image.tag);
    if (!imageName || !version || !image.id) continue;

    const key = `${imageName}\u0000${version}`;
    if (!groups.has(key)) {
      groups.set(key, {
        profile: name,
        image: imageName,
        version,
        image_ids: [],
        containers: 0,
      });
    }
    groups.get(key).image_ids.push(image.id);
  }

  for (const row of groups.values()) {
    const containers = await client.list("/api/plugins/docker/containers/", { limit: 1000, image_id: row.image_ids });
    row.containers = containers.length;
    containers.forEach((container) => {
      const owner = containerEnvValue(container, ownerEnvName);
      if (!owner) return;

      owners.add(owner);
      if (!usersByOwner.has(owner)) {
        usersByOwner.set(owner, {
          user: owner,
          profiles: new Set(),
          items: [],
          imageKeys: new Set(),
        });
      }

      const user = usersByOwner.get(owner);
      user.profiles.add(name || "default");
      user.imageKeys.add(`${row.image}\u0000${row.version}`);
      user.items.push({
        profile: name || "default",
        container: valueText(container.display || container.name || container.id),
        image: row.image,
        version: row.version,
      });
    });
    logLine(`REPORT_IMAGE : ${label} ${row.image}:${row.version} containers=${row.containers}`);
  }

  const rows = Array.from(groups.values())
    .map(({ image_ids, ...row }) => row)
    .sort((left, right) => left.profile.localeCompare(right.profile) || left.image.localeCompare(right.image) || left.version.localeCompare(right.version, undefined, { numeric: true, sensitivity: "base" }));

  const users = Array.from(usersByOwner.values())
    .map((user) => ({
      user: user.user,
      profiles: [...user.profiles],
      containers: user.items.length,
      images: user.imageKeys.size,
      items: user.items.sort((left, right) => left.profile.localeCompare(right.profile) || left.container.localeCompare(right.container) || left.image.localeCompare(right.image)),
    }))
    .sort((left, right) => left.user.localeCompare(right.user));

  logLine(`REPORT_IMAGE : ${label} found ${owners.size} owner${owners.size === 1 ? "" : "s"} from ${ownerEnvName}`);
  return { hosts: hosts.length, rows, owners: [...owners], users };
}

async function reportImages(req, res) {
  try {
    const profiles = reportProfiles(req.query);
    const requestedProfile = req.query.profile || req.query.config_profile || "";
    logLine(`REPORT_IMAGE : starting profile=${requestedProfile || "selected"} profiles=${profiles.map((item) => item.name || "default").join(",") || "default"}`);
    const results = [];
    const owners = new Set();
    const usersByOwner = new Map();
    let totalHosts = 0;

    for (const item of profiles) {
      const report = await imageReportForProfile(item.name, item.config);
      totalHosts += report.hosts;
      results.push(...report.rows);
      (report.owners || []).forEach((owner) => owners.add(owner));
      (report.users || []).forEach((user) => {
        if (!usersByOwner.has(user.user)) {
          usersByOwner.set(user.user, {
            user: user.user,
            profiles: new Set(),
            items: [],
            imageKeys: new Set(),
          });
        }

        const target = usersByOwner.get(user.user);
        (user.profiles || []).forEach((profile) => target.profiles.add(profile));
        for (const owned of user.items || []) {
          target.items.push(owned);
          target.imageKeys.add(`${owned.image}\u0000${owned.version}`);
        }
      });
    }

    const netboxUsers = Array.from(usersByOwner.values())
      .map((user) => ({
        user: user.user,
        profiles: [...user.profiles].sort((left, right) => left.localeCompare(right)),
        containers: user.items.length,
        images: user.imageKeys.size,
        items: user.items.sort((left, right) => left.profile.localeCompare(right.profile) || left.container.localeCompare(right.container) || left.image.localeCompare(right.image)),
      }))
      .sort((left, right) => left.user.localeCompare(right.user));
    const users = netboxUsers.length ? netboxUsers : localOrderReportUsers(requestedProfile, profiles);

    const payload = {
      profile: requestedProfile,
      rows: results,
      users,
      total_hosts: totalHosts,
      total_images: results.length,
      total_containers: results.reduce((total, row) => total + Number(row.containers || 0), 0),
      total_users: users.length,
    };
    logLine(`REPORT_IMAGE : finished profile=${requestedProfile || "selected"} hosts=${payload.total_hosts} images=${payload.total_images} containers=${payload.total_containers} users=${payload.total_users}`);
    res.json(payload);
  } catch (error) {
    logLine(`REPORT_IMAGE : failed ${error.message || "report error"}`);
    res.status(error.statusCode || 502).json({ detail: error.message, payload: error.payload });
  }
}

registerNetBoxRoutes(app, {
  checkRegistryImageExists,
  containerNetworkNames,
  hostIdQuery,
  NetBoxClient,
  publicApiGuard,
  reportImages,
  requireAdmin,
  selectedProfileConfig,
  testConnection,
});

registerLimitRoutes(app, {
  currentEnrollmentUsage,
  currentUsage,
});

async function createInstance(req, data, { isOrderRequest, isEnrollRequest, orderProfile, authUser }) {
  data = normalizedSaashupLabelConfig(data);
  const client = new NetBoxClient(data);
  const hosts = await dockerHosts(client, data.tag);
  if (!hosts.length) {
    logLine(`CREATE : no Docker hosts found${data.tag ? ` with tag ${data.tag}` : ""}`);
    if (isOrderRequest) updateOrderInstanceStatus(req, orderProfile, data.instance || "", "failed");
    if (isEnrollRequest) updateEnrollmentInstanceStatus(req, orderProfile, data.instance || "", "failed");
    return false;
  }
  let targetHosts = hosts;
  if (allHostsEnabled(data)) {
    logLine(`CREATE : host selection all_hosts=true hosts=${hosts.length} selected=${hosts.map(hostName).join(",")}`);
  } else {
    const existingContainers = await client.list("/api/plugins/docker/containers/", { limit: 1000, host_id: hosts.map((host) => host.id) });
    const loadStats = hostLoadStats(hosts, existingContainers);
    const selected = leastLoadedHost(hosts, existingContainers);
    const selectedStats = loadStats.find((item) => item.host === selected);
    logLine(`CREATE : host selection hosts=${hosts.length} containers=${existingContainers.length} loads=${hostLoadSummary(loadStats)} selected=${hostName(selected)} count=${selectedStats?.count ?? 0}`);
    targetHosts = [selected].filter(Boolean);
  }
  let readyCount = 0;

  for (const [index, selectedHost] of targetHosts.entries()) {
    data.host_id = selectedHost.id;
    const image = await ensureImageOnHost(client, selectedHost, data.image, data.version, "CREATE");
    if (traefikEnabled(data) && index === 0) await createDnsRecord(client, data, selectedHost);
    const volumes = volumePayloadsFromForm(data);
    if (volumes.length) {
      const { missing, reused } = await missingDockerVolumes(client, volumes);
      if (missing.length) {
        await client.request("POST", "/api/plugins/docker/volumes/", { body: missing.length === 1 ? missing[0] : missing, expected: [200, 201, 202] });
      }
      const details = reused ? ` (${reused} reused, ${missing.length} created)` : "";
      logLine(`CREATE : ${volumes.length} volume${volumes.length === 1 ? "" : "s"} prepared on ${hostName(selectedHost)}${details}`);
    }
    const containerPayload = containerCreatePayloadFromForm(data, image.id);
    const { payload } = await client.request("POST", "/api/plugins/docker/containers/", { body: containerPayload, expected: [200, 201, 202] });
    const container = Array.isArray(payload) ? payload[0] : payload;
    logLine(`CREATE : container ${containerPayload.name} created on ${hostName(selectedHost)}`);
    if (createConfigureDelayMs > 0) await delay(createConfigureDelayMs);
    const containerConfig = containerConfigPayloadFromForm(data, container.id);
    await client.request("PATCH", "/api/plugins/docker/containers/", { body: [containerConfig] });
    logLine(`CREATE : container ${containerPayload.name} configured on ${hostName(selectedHost)} env=${containerConfig.env.length} labels=${containerConfig.labels.length} mounts=${containerConfig.mounts.length}`);
    if (createRecreateDelayMs > 0) await delay(createRecreateDelayMs);
    await waitForContainerConfigured(client, container.id, `${hostName(container)}/${valueText(container.display || container.name)}`);
    const ready = await requestContainerOperation(client, container, "recreate", "CREATE");
    if (ready) readyCount += 1;
  }

  const allReady = readyCount === targetHosts.length;
  if (isOrderRequest && allReady) {
    try {
      await sendOrderReadyEmail(data, authUser.email || "");
    } catch (error) {
      logLine(`EMAIL : ready notification failed for ${authUser.email || ""} ${error.message || "smtp error"}`);
    }
    updateOrderInstanceStatus(req, orderProfile, data.instance || "", "ready");
  } else if (isOrderRequest) {
    updateOrderInstanceStatus(req, orderProfile, data.instance || "", "failed");
  }
  if (isEnrollRequest) {
    updateEnrollmentInstanceStatus(req, orderProfile, data.instance || "", allReady ? "ready" : "failed");
  }
  if (allHostsEnabled(data)) logLine(`CREATE : finished all hosts ready=${readyCount}/${targetHosts.length}`);
  return allReady;
}

async function recreateContainers(data) {
  const client = new NetBoxClient(data);
  const hostFilter = await hostIdQuery(client, data.tag);
  if (hostFilter.host_id === "__none__") return logLine(`RECREATE : no Docker hosts found with tag ${data.tag}`);
  const query = { name: data.image, limit: 200, ...hostFilter };
  if (data.oldversion) query.version = data.oldversion;
  const oldImages = (await client.list("/api/plugins/docker/images/", query)).filter((image) => data.oldversion ? String(image.version) === String(data.oldversion) : String(image.version) !== String(data.version));
  if (!oldImages.length) return logLine(`RECREATE : no old images found for ${data.image}:${data.oldversion || "all previous versions"}`);
  const removeOldImages = (data.remove_old_images === true || data.remove_old_images === "true" || data.remove_old_images === "on")
    && (!data.oldversion || String(data.oldversion) !== String(data.version));
  for (const oldImage of oldImages) {
    const newImage = await ensureImageOnHost(client, oldImage, data.image, data.version);
    const containers = await client.list("/api/plugins/docker/containers/", { image_id: oldImage.id, limit: 200 });
    for (const container of containers) {
      const targetName = (data.clean_name === true || data.clean_name === "true" || data.clean_name === "on") ? String(container.name || container.display || "").replace(/-17[0-9]{8,}$/, "") : (container.name || container.display);
      await client.request("PATCH", "/api/plugins/docker/containers/", { body: [{ id: container.id, image: newImage.id, ...(targetName && targetName !== container.name ? { name: targetName } : {}) }] });
      logLine(`RECREATE : ${hostName(container)}/${valueText(container.display || container.name)} image set to ${data.image}:${data.version}`);
      await requestContainerOperation(client, container, "recreate", "RECREATE");
    }
    if (removeOldImages) {
      await client.request("DELETE", `/api/plugins/docker/images/${oldImage.id}/`, { expected: [200, 202, 204] });
      logLine(`RECREATE : removed old image ${data.image}:${oldImage.version || data.oldversion || ""} from ${hostName(oldImage)}`);
    }
  }
  logLine(`RECREATE : finished ${data.image}:${data.oldversion || "all previous versions"} -> ${data.version}`);
}

function deleteVolumesEnabled(data) {
  return data.delete_volumes === true || data.delete_volumes === "true" || data.delete_volumes === "on";
}

function containerVolumeRefs(container) {
  const hostId = container?.host?.id || container?.host || "";
  const mounts = [
    ...(Array.isArray(container?.mounts) ? container.mounts : []),
    ...(Array.isArray(container?.volumes) ? container.volumes : []),
  ];
  const refs = new Map();

  mounts.forEach((mount) => {
    const volume = mount?.volume || mount?.docker_volume || mount;
    const id = valueText(volume?.id || mount?.volume_id);
    const name = valueText(volume?.name || mount?.volume_name);
    if (!id && !name) return;

    refs.set(id || name, { id, name, hostId });
  });

  return [...refs.values()];
}

async function deleteContainerVolumes(client, container) {
  for (const ref of containerVolumeRefs(container)) {
    if (ref.id) {
      await client.request("DELETE", `/api/plugins/docker/volumes/${ref.id}/`, { expected: [200, 202, 204] });
      logLine(`DELETE : volume ${ref.name || ref.id} deleted`);
      continue;
    }

    const query = { name: ref.name };
    if (ref.hostId) query.host_id = ref.hostId;
    const volumes = await client.list("/api/plugins/docker/volumes/", query);
    for (const volume of volumes) {
      await client.request("DELETE", `/api/plugins/docker/volumes/${volume.id}/`, { expected: [200, 202, 204] });
      logLine(`DELETE : volume ${valueText(volume.name || ref.name || volume.id)} deleted`);
    }
  }
}

registerOperationRoutes(app, {
  asyncOperation,
  authUserFromRequest,
  createInstance,
  currentEnrollmentUsage,
  currentUsage,
  deleteContainerVolumes,
  deleteDnsRecord,
  deleteVolumesEnabled,
  dockerHosts,
  exactContainerNameMatches,
  hostIdQuery,
  hostName,
  instanceShort,
  isContainerRunning,
  logLine,
  NetBoxClient,
  oidcAuth,
  recordEnrollment,
  recordOrderInstance,
  recreateContainers,
  removeOrderInstance,
  requestContainerOperation,
  selectedProfileConfig,
  updateEnrollmentInstanceStatus,
  updateOrderInstanceStatus,
  validateOrderTemplate,
  valueText,
  waitForContainerStopped,
  waitForHostReady,
  waitForRequest,
});

app.use(express.static(publicPath));

/* v8 ignore next 6 */
if (require.main === module) {
  const port = Number(process.env.PORT || 1880);
  app.listen(port, () => {
    console.log(`${packageJson.name} listening on ${port}`);
  });
}

module.exports = {
  app,
  asArray,
  authUserFromRequest,
  bindPayloadsFromForm,
  containerConfigPayloadFromForm,
  containerCreatePayloadFromForm,
  hostMatchesTag,
  imageNameFromRef,
  instanceShort,
  instanceZone,
  isContainerRunning,
  isContainerStopped,
  isOperationDone,
  isReadyContainer,
  maxInstancesValue,
  metricLabel,
  metricLine,
  operationLabel,
  parseProfiles,
  parseSmtpConfig,
  plainObject,
  routeLabel,
  sendSmtpMail,
  setNetBoxFetchForTests,
  setOidcFetchForTests,
  setRegistryFetchForTests,
  setSmtpSenderForTests: (sender) => {
    smtpSender = sender || sendSmtpMail;
  },
  setTurnstileFetchForTests: (fetcher) => {
    turnstileFetch = fetcher || undiciFetch;
  },
  smtpMessage,
  smtpSenderAddress,
  smtpTransportOptions,
  statusClass,
  valueText,
  volumePayloadsFromForm,
};
