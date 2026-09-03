const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {};
}

function normalizeImportedProfiles(profiles, maxInstancesValue, plainObject) {
  return Object.fromEntries(Object.entries(plainObject(profiles)).map(([name, profile]) => {
    const normalized = plainObject(profile);
    if (normalized.enrollment_limit === undefined) {
      const legacyLimit = normalized.max_templates ?? normalized.max_instances;
      if (legacyLimit !== undefined) normalized.enrollment_limit = maxInstancesValue(legacyLimit);
    }
    delete normalized.max_templates;
    return [name, normalized];
  }));
}

function cleanStoredConfig(config, parseProfiles, profilesWithSingleDefault, plainObject) {
  const data = plainObject(config);
  const profiles = profilesWithSingleDefault(parseProfiles(data.profiles));
  const profile = data.profile || data.config_profile || Object.keys(profiles).sort((a, b) => a.localeCompare(b))[0] || "";
  return {
    customer_name: data.customer_name || "",
    profile,
    config_profile: profile,
    profiles,
  };
}

function expandedConfigForResponse(config, selectedProfileConfig, parseProfiles, profilesWithSingleDefault, plainObject) {
  const stored = cleanStoredConfig(config, parseProfiles, profilesWithSingleDefault, plainObject);
  const selected = stored.profile ? selectedProfileConfig({ profile: stored.profile, config_profile: stored.profile }) : {};
  const profiles = { ...stored.profiles };
  if (stored.profile) {
    const selectedProfile = { ...plainObject(selected) };
    delete selectedProfile.customer_name;
    delete selectedProfile.profile;
    delete selectedProfile.config_profile;
    delete selectedProfile.profiles;
    profiles[stored.profile] = { ...plainObject(profiles[stored.profile]), ...selectedProfile };
  }
  return {
    customer_name: stored.customer_name,
    profile: stored.profile,
    config_profile: stored.config_profile,
    profiles,
  };
}

const brandingFields = ["brand_logo", "brand_primary", "brand_secondary", "brand_background", "brand_welcome", "brand_url", "brand_footer"];

function hexColorValue(value) {
  const hex = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : "";
}

function httpUrlValue(value) {
  const url = String(value || "").trim().slice(0, 300);
  return /^https?:\/\/\S+$/i.test(url) ? url : "";
}

function brandingForStore(input, plainObject) {
  const data = plainObject(input);
  const text = (value, max) => String(value || "").trim().slice(0, max);
  const branding = {
    brand_primary: hexColorValue(data.brand_primary),
    brand_secondary: hexColorValue(data.brand_secondary),
    brand_welcome: text(data.brand_welcome, 500),
    brand_url: httpUrlValue(data.brand_url),
    brand_footer: text(data.brand_footer, 120),
  };
  return Object.fromEntries(Object.entries(branding).filter(([, value]) => value));
}

const BRANDING_IMAGE_MAX_BYTES = 1024 * 1024;

function decodedBrandingImage(value) {
  const base64 = String(value || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (!base64) return { buffer: null };
  if (base64.length > Math.ceil((BRANDING_IMAGE_MAX_BYTES * 4) / 3) + 16) {
    return { error: "image exceeds the 1MB limit" };
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) return { error: "invalid image encoding" };
  if (buffer.length > BRANDING_IMAGE_MAX_BYTES) return { error: "image exceeds the 1MB limit" };
  const isWebp = buffer.length > 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
  if (!isWebp) return { error: "image must be WebP encoded" };
  return { buffer };
}

function publicConfigForResponse(config, selectedProfileConfig, parseProfiles, profilesWithSingleDefault, plainObject, { includeHidden = false, brandings = {} } = {}) {
  const expanded = expandedConfigForResponse(config, selectedProfileConfig, parseProfiles, profilesWithSingleDefault, plainObject);
  const publicProfileFields = [
    "domain",
    "tag",
    "enrollment_limit",
    "max_instances",
    "owner_env_var",
    "cloudflare_filter",
    "saashup_visible",
  ];
  const credentialFields = {
    netbox: "netbox_configured",
    token: "token_configured",
    proxy: "proxy_configured",
    smtp_config: "smtp_configured",
  };
  const publicProfile = (profile) => {
    const data = plainObject(profile);
    const branding = plainObject(plainObject(brandings)[String(data.branding || "").trim()]);
    const brandingSource = Object.keys(branding).length ? branding : data;
    return {
      ...Object.fromEntries(publicProfileFields
        .filter((key) => data[key] !== undefined)
        .map((key) => [key, data[key]])),
      ...Object.fromEntries(brandingFields
        .filter((key) => brandingSource[key] !== undefined && brandingSource[key] !== "")
        .map((key) => [key, brandingSource[key]])),
      ...Object.fromEntries(Object.entries(credentialFields)
        .map(([key, flag]) => [flag, Boolean(data[key] || data[flag])])),
    };
  };
  const profiles = Object.fromEntries(Object.entries(plainObject(expanded.profiles))
    .filter(([, profile]) => includeHidden || plainObject(profile).saashup_visible === true || plainObject(profile).saashup_default === true)
    .map(([name, profile]) => [name, publicProfile(profile)]));

  const selectedProfile = plainObject(expanded.profiles[expanded.profile]);
  const expandedVisible = selectedProfile.saashup_visible === true || selectedProfile.saashup_default === true;
  const showSelectedProfile = includeHidden || expandedVisible;
  let selectedProfileName = "";
  let selectedConfigProfileName = "";
  if (showSelectedProfile) {
    selectedProfileName = expanded.profile;
    selectedConfigProfileName = expanded.config_profile;
  }

  return {
    customer_name: expanded.customer_name || "",
    profile: selectedProfileName,
    config_profile: selectedConfigProfileName,
    profiles,
  };
}


function workflowsForVisibleTemplates(workflows, templates) {
  const visible = new Set(Object.keys(plainObject(templates)).map((name) => name.toLowerCase()));
  return Object.fromEntries(Object.entries(plainObject(workflows))
    .map(([name, workflow]) => {
      const entry = plainObject(workflow);
      if (!Array.isArray(entry.steps)) return [name, entry];
      return [name, {
        ...entry,
        steps: entry.steps.filter((step) => {
          const template = String(plainObject(step).template || "").trim().toLowerCase();
          return !template || visible.has(template);
        }),
      }];
    })
    .filter(([, workflow]) => !Array.isArray(workflow.steps) || workflow.steps.length));
}

function enrollmentTemplateUsage(state, profile, templateName) {
  return 0;
}

function templateEntryByName(templates, name) {
  const requested = String(name || "").trim();
  const objectValue = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const templateMap = objectValue(templates);
  const direct = templateMap[requested];
  if (direct) return { name: requested, template: objectValue(direct) };
  const match = Object.keys(templateMap).find((templateName) => templateName.toLowerCase() === requested.toLowerCase());
  return match ? { name: match, template: objectValue(templateMap[match]) } : null;
}

function workflowsWithoutTemplate(workflows, templateName, plainObject) {
  const deleted = String(templateName || "").trim().toLowerCase();
  if (!deleted) return plainObject(workflows);
  return Object.fromEntries(Object.entries(plainObject(workflows))
    .map(([name, workflow]) => {
      const entry = plainObject(workflow);
      if (!Array.isArray(entry.steps)) return [name, entry];
      const steps = entry.steps.filter((step) => (
        String((typeof step === "string" ? step : plainObject(step).template) || "").trim().toLowerCase() !== deleted
      ));
      return [name, { ...entry, steps }];
    })
    .filter(([, workflow]) => !Array.isArray(workflow.steps) || workflow.steps.length));
}

function unquoteDockerfileEnvValue(value) {
  const text = String(value);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function dockerfileEnvEntries(dockerfileText = "") {
  const instructions = [];
  let current = "";

  String(dockerfileText).split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    current = current ? `${current} ${trimmed}` : trimmed;
    if (trimmed.endsWith("\\")) {
      current = current.slice(0, -1).trim();
      return;
    }

    instructions.push(current);
    current = "";
  });

  if (current) instructions.push(current);

  const seen = new Set();
  const entries = [];
  instructions
    .filter((instruction) => /^ENV\s+/i.test(instruction))
    .forEach((instruction) => {
      const body = instruction.replace(/^ENV\s+/i, "");
      const matches = body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)/g);
      for (const match of matches) {
        const name = match[1];
        if (seen.has(name)) continue;
        seen.add(name);
        entries.push({ name, defaultValue: unquoteDockerfileEnvValue(match[2]) });
      }
    });

  return entries;
}

function environmentVariablesForResponse(env = process.env, dockerfileText = "") {
  return dockerfileEnvEntries(dockerfileText)
    .map(({ name, defaultValue }) => ({ name, value: String(env?.[name] ?? defaultValue ?? "") }));
}

function includeTemplateWorkflows(query = {}) {
  return query.include_workflows === "true";
}

function templateNameRequired(name) {
  return !String(name || "").trim();
}

async function templatesOnlyResponse({ templates }) {
  return templates;
}

async function templatesWithWorkflowsResponse({
  req,
  requestedProfile,
  profile,
  ownerOnly,
  templates,
  workflowsForRequest,
  workflowsForVisibleProfiles,
  visibleProfileNames,
}) {
  const workflows = requestedProfile
    ? await workflowsForRequest(req, profile)
    : await workflowsForVisibleProfiles(req);
  return {
    templates,
    workflows: ownerOnly ? workflowsForVisibleTemplates(workflows, templates) : workflows,
    profiles: requestedProfile ? [requestedProfile] : visibleProfileNames(),
  };
}

async function templatesResponseForRequest(req, {
  readState,
  templatesForRequest,
  templatesForVisibleProfiles,
  workflowsForRequest,
  workflowsForVisibleProfiles,
  visibleProfileNames,
}) {
  const state = readState();
  const requestedProfile = req.query.profile || req.query.config_profile || "";
  const profile = requestedProfile || state.config?.profile || state.config?.config_profile || "";
  const ownerOnly = req.query.owner_only === "true" || req.query.enroll === "true";
  const templates = requestedProfile
    ? await templatesForRequest(req, requestedProfile, { ownerOnly })
    : await templatesForVisibleProfiles(req, { ownerOnly });

  const responseBuilder = {
    false: templatesOnlyResponse,
    true: templatesWithWorkflowsResponse,
  }[String(includeTemplateWorkflows(req.query))];
  return responseBuilder({
    req,
    requestedProfile,
    profile,
    ownerOnly,
    templates,
    workflowsForRequest,
    workflowsForVisibleProfiles,
    visibleProfileNames,
  });
}

function registerConfigRoutes(app, {
  appOwnerEmail,
  authUserFromRequest,
  brandingLimit = 1,
  maxInstancesValue,
  parseProfiles,
  plainObject,
  processEnv = process.env,
  readDockerfile = (dockerfilePath) => fs.readFileSync(dockerfilePath, "utf8"),
  dockerfilePath = path.join(process.cwd(), "Dockerfile"),
  dataPath = path.join(process.cwd(), "data"),
  profilesWithSingleDefault,
  publicApiGuard,
  readState,
  registrySecretForTemplate,
  registryWebhookSecret,
  requireAdmin,
  selectedProfileConfig,
  sendContactEmail,
  sendTestEmail,
  syncTemplatesToNetBoxConfigContext,
  enrollmentTemplateDeleteUsage,
  templatesForRequest,
  templatesForVisibleProfiles = templatesForRequest,
  templatesWithCreatorEmails,
  visibleProfileNames = () => [],
  verifyContactTurnstile,
  writeState,
  workflowsForRequest,
  workflowsForVisibleProfiles = workflowsForRequest,
}) {
  app.get("/admin/config", requireAdmin, (req, res) => {
    const config = readState().config || {};
    if (!Object.keys(plainObject(config)).length) {
      res.json({});
      return;
    }
    res.json(expandedConfigForResponse(config, selectedProfileConfig, parseProfiles, profilesWithSingleDefault, plainObject));
  });
  app.get("/admin/environment", requireAdmin, (req, res) => {
    let dockerfileText = "";
    try {
      dockerfileText = readDockerfile(dockerfilePath);
    } catch {
      dockerfileText = "";
    }
    res.json({ variables: environmentVariablesForResponse(processEnv, dockerfileText) });
  });
  app.get("/config", (req, res) => {
    const state = readState();
    const config = state.config || {};
    if (!Object.keys(plainObject(config)).length) {
      res.json({});
      return;
    }
    res.json(publicConfigForResponse(config, selectedProfileConfig, parseProfiles, profilesWithSingleDefault, plainObject, {
      brandings: plainObject(state.brandings),
    }));
  });
  app.get("/admin/brandings", requireAdmin, (req, res) => {
    res.json({ brandings: plainObject(readState().brandings), limit: brandingLimit });
  });
  app.post("/admin/brandings", requireAdmin, (req, res) => {
    const body = plainObject(req.body);
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) {
      res.status(400).json({ error: "Branding name is required" });
      return;
    }
    const storedBrandings = plainObject(readState().brandings);
    if (!Object.hasOwn(storedBrandings, name) && Object.keys(storedBrandings).length >= brandingLimit) {
      const brandingNoun = brandingLimit === 1 ? "branding" : "brandings";
      res.status(409).json({ error: `Branding limit reached (${brandingLimit} ${brandingNoun} max). Delete an existing branding or raise the BRANDING_LIMIT environment variable.` });
      return;
    }
    const existing = plainObject(storedBrandings[name]);
    const id = /^[a-f0-9]{12}$/.test(String(existing.id || "")) ? existing.id : crypto.randomBytes(6).toString("hex");
    const branding = { id, ...brandingForStore(body, plainObject) };
    const brandingDir = path.join(dataPath, "branding");
    const imageKinds = [
      { suffix: "logo", uploadKey: "logo_upload", removeKey: "logo_remove", field: "brand_logo" },
      { suffix: "bg", uploadKey: "background_upload", removeKey: "background_remove", field: "brand_background" },
    ];

    for (const kind of imageKinds) {
      const filePath = path.join(brandingDir, `${id}-${kind.suffix}.webp`);
      if (body[kind.uploadKey]) {
        const { buffer, error } = decodedBrandingImage(body[kind.uploadKey]);
        if (error || !buffer) {
          res.status(400).json({ error: `${kind.field}: ${error || "invalid image"}` });
          return;
        }
        fs.mkdirSync(brandingDir, { recursive: true });
        fs.writeFileSync(filePath, buffer);
        branding[kind.field] = `/branding-assets/${id}-${kind.suffix}.webp?v=${Date.now()}`;
      } else if (body[kind.removeKey] === true) {
        try { fs.unlinkSync(filePath); } catch { /* already absent */ }
      } else if (existing[kind.field]) {
        branding[kind.field] = existing[kind.field];
      }
    }

    writeState((state) => {
      state.brandings = { ...plainObject(state.brandings), [name]: branding };
      return state;
    });
    res.json({ name, branding });
  });
  app.get("/branding-assets/:file", (req, res) => {
    const file = String(req.params.file || "");
    if (!/^[a-f0-9]{12}-(logo|bg)\.webp$/.test(file)) {
      res.status(404).end();
      return;
    }
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(path.join(dataPath, "branding", file), (error) => {
      if (error) res.status(404).end();
    });
  });
  app.delete("/admin/brandings/:name", requireAdmin, (req, res) => {
    const name = String(req.params.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Branding name is required" });
      return;
    }
    const existing = plainObject(plainObject(readState().brandings)[name]);
    const existingId = String(existing.id || "");
    if (/^[a-f0-9]{12}$/.test(existingId)) {
      ["logo", "bg"].forEach((suffix) => {
        try { fs.unlinkSync(path.join(dataPath, "branding", `${existingId}-${suffix}.webp`)); } catch { /* already absent */ }
      });
    }
    writeState((state) => {
      const brandings = { ...plainObject(state.brandings) };
      delete brandings[name];
      state.brandings = brandings;
      const config = plainObject(state.config);
      const profiles = parseProfiles(config.profiles);
      Object.entries(profiles).forEach(([profileName, profile]) => {
        const data = plainObject(profile);
        if (String(data.branding || "").trim() === name) {
          delete data.branding;
          profiles[profileName] = data;
        }
      });
      state.config = { ...config, profiles };
      return state;
    });
    res.json({ deleted: name });
  });
  app.get("/mail-settings", requireAdmin, (req, res) => res.json({ owner_email_configured: Boolean(appOwnerEmail) }));
  app.get("/registry-webhook-secret", requireAdmin, (req, res) => {
    const template = req.query.template || "";
    const image = req.query.image || "";
    res.json({ secret: template ? registrySecretForTemplate(template, image) : registryWebhookSecret, default_secret: registryWebhookSecret });
  });
  app.post("/test-email", requireAdmin, async (req, res) => {
    try {
      const data = { ...selectedProfileConfig(req.body), ...req.body };
      const info = await sendTestEmail(data);
      res.json({
        status: "sent",
        message_id: info?.messageId || "",
        accepted: Array.isArray(info?.accepted) ? info.accepted : [],
        rejected: Array.isArray(info?.rejected) ? info.rejected : [],
        response: info?.response || "",
      });
    } catch (error) {
      const status = Number.isFinite(Number(error.statusCode)) ? Number(error.statusCode) : 500;
      res.status(status).json({ detail: error.message || "email test failed" });
    }
  });
  app.options("/contact", publicApiGuard);
  app.post("/contact", publicApiGuard, async (req, res) => {
    try {
      const data = { ...req.query, ...req.body };
      await verifyContactTurnstile(data, req);
      const info = await sendContactEmail(data);
      res.json({
        status: "sent",
        skipped: Boolean(info?.skipped),
        message_id: info?.messageId || "",
        accepted: Array.isArray(info?.accepted) ? info.accepted : [],
        rejected: Array.isArray(info?.rejected) ? info.rejected : [],
        response: info?.response || "",
      });
    } catch (error) {
      res.status(error.statusCode || 502).json({ detail: error.message || "contact email failed" });
    }
  });
  app.delete("/config", requireAdmin, (req, res) => {
    writeState((state) => {
      state.config = {};
      return state;
    });
    res.json({});
  });
  app.get("/webhook", requireAdmin, async (req, res) => {
    const profileName = req.query.profile || req.query.config_profile || "";
    const configProfileName = req.query.config_profile || req.query.profile || "";
    const existingConfig = plainObject(readState().config);
    const storedProfiles = parseProfiles(existingConfig.profiles);
    const parsedProfiles = profilesWithSingleDefault(normalizeImportedProfiles(parseProfiles(req.query.profiles), maxInstancesValue, plainObject));
    const selectedInputProfile = plainObject(parsedProfiles[profileName]);
    const existingProfile = plainObject(storedProfiles[profileName]);
    const secretValue = (key) => {
      const values = [req.query[key], selectedInputProfile[key], existingProfile[key], existingConfig[key]];
      return values.find((value) => String(value || "").trim()) || "";
    };
    const selectedProfileLimit = selectedInputProfile.enrollment_limit
      ?? selectedInputProfile.max_templates
      ?? selectedInputProfile.max_instances;
    const enrollmentLimit = maxInstancesValue(selectedProfileLimit ?? req.query.enrollment_limit ?? req.query.max_templates ?? req.query.max_instances);
    const ownerEnvVar = String(req.query.owner_env_var ?? selectedInputProfile.owner_env_var ?? "SAASHUP_OWNER").trim() || "SAASHUP_OWNER";
    const cloudflareFilter = req.query.cloudflare_filter !== undefined
      ? req.query.cloudflare_filter !== "false"
      : selectedInputProfile.cloudflare_filter !== false;
    if (profileName) {
      parsedProfiles[profileName] = {
        ...selectedInputProfile,
        netbox: secretValue("netbox"),
        token: secretValue("token"),
        proxy: secretValue("proxy"),
        domain: req.query.domain ?? selectedInputProfile.domain ?? "",
        tag: req.query.tag ?? selectedInputProfile.tag ?? "",
        enrollment_limit: enrollmentLimit,
        owner_env_var: ownerEnvVar,
        cloudflare_filter: cloudflareFilter,
        smtp_config: secretValue("smtp_config"),
        ...(selectedInputProfile.saashup_visible === true || selectedInputProfile.saashup_default === true ? { saashup_visible: true } : {}),
      };
    }
    const profiles = profilesWithSingleDefault(parsedProfiles);
    const selectedProfile = plainObject(profiles[profileName]);
    const profileValue = (key, fallback = "") => (profileName && selectedProfile[key] !== undefined ? selectedProfile[key] : fallback);
    const config = {
      customer_name: req.query.customer_name || "",
      netbox: profileValue("netbox", req.query.netbox || ""),
      token: profileValue("token", req.query.token || ""),
      proxy: profileValue("proxy", req.query.proxy || ""),
      domain: profileValue("domain", req.query.domain || ""),
      tag: profileValue("tag", req.query.tag || ""),
      enrollment_limit: maxInstancesValue(profileValue("enrollment_limit", enrollmentLimit)),
      owner_env_var: String(profileValue("owner_env_var", ownerEnvVar)).trim(),
      cloudflare_filter: profileValue("cloudflare_filter", cloudflareFilter) !== false,
      smtp_config: profileValue("smtp_config", req.query.smtp_config || ""),
      profile: profileName,
      config_profile: configProfileName,
      profiles,
    };
    const storedConfig = cleanStoredConfig(config, parseProfiles, profilesWithSingleDefault, plainObject);
    writeState((state) => {
      state.config = storedConfig;
      return state;
    });

    let templateCatalogSync = null;
    try {
      templateCatalogSync = profileName
        ? await syncTemplatesToNetBoxConfigContext(req, profileName, {}, {}, { preserveExisting: true })
        : null;
    } catch (error) {
      templateCatalogSync = {
        action: "failed",
        detail: error.message || "template catalog sync failed",
      };
    }

    res.json(templateCatalogSync ? { ...config, template_catalog_sync: templateCatalogSync } : config);
  });

  app.get("/templates", async (req, res) => {
    res.json(await templatesResponseForRequest(req, {
      readState,
      templatesForRequest,
      templatesForVisibleProfiles,
      workflowsForRequest,
      workflowsForVisibleProfiles,
      visibleProfileNames,
    }));
  });
  app.post("/templates", requireAdmin, async (req, res) => {
    const creatorEmail = authUserFromRequest(req).email || "";
    const state = readState();
    const payload = plainObject(req.body);
    const hasCatalogShape = Object.hasOwn(payload, "templates") || Object.hasOwn(payload, "workflows");
    const profile = req.query.profile || req.query.config_profile || payload.profile || payload.config_profile || state.config?.profile || state.config?.config_profile || "";
    const workflows = plainObject(hasCatalogShape ? payload.workflows : state.workflows);
    const templates = templatesWithCreatorEmails(hasCatalogShape ? payload.templates : payload, plainObject(state.templates), creatorEmail);
    try {
      const syncResult = await syncTemplatesToNetBoxConfigContext(req, profile, templates, workflows);
      if (!syncResult) {
        writeState((state) => {
          state.templates = templates;
          state.workflows = workflows;
          return state;
        });
      }
      if (req.query.include_workflows === "true" || hasCatalogShape) {
        res.json({ templates, workflows });
        return;
      }
      res.json(templates);
    } catch (error) {
      res.status(error.statusCode || 502).json({ detail: error.message || "template sync failed", payload: error.payload });
    }
  });

  app.delete("/enroll/template/:name", async (req, res) => {
    const name = String(req.params.name || "").trim();
    const profile = req.query.profile || req.query.config_profile || readState().config?.profile || readState().config?.config_profile || "";
    const authUser = authUserFromRequest(req);
    const creator = String(authUser.email || authUser.user || "").trim().toLowerCase();
    if (!creator) return res.status(401).json({ code: "auth_required", detail: "Authentication is required." });
    if (templateNameRequired(name)) {
      res.status(400).json({ code: "template_required", detail: "Template name is required." });
      return;
    }

    const state = readState();
    const usage = enrollmentTemplateDeleteUsage
      ? await enrollmentTemplateDeleteUsage(req, profile, name, creator)
      : { blocked: enrollmentTemplateUsage(state, profile, name), owned: 0, total: enrollmentTemplateUsage(state, profile, name) };
    if (usage.total > 0) {
      const instanceNoun = Number(usage.total) === 1 ? "instance" : "instances";
      return res.status(409).json({
        code: "template_in_use",
        detail: `Template "${name}" is used by ${usage.total} ${instanceNoun}.`,
        template: name,
        instance_count: usage.total,
        blocking_instance_count: usage.blocked,
        owned_instance_count: usage.owned,
      });
    }

    const catalogTemplates = await templatesForRequest(req, profile);
    const catalogEntry = templateEntryByName(catalogTemplates, name);
    const localEntry = templateEntryByName(state.templates, name);
    const entry = catalogEntry || localEntry;
    const template = plainObject(entry?.template);
    if (!Object.keys(template).length) return res.status(404).json({ code: "template_not_found", detail: `Template "${name}" was not found.`, template: name });
    if (String(template.creator_email || "").trim().toLowerCase() !== creator) return res.status(403).json({ code: "template_not_owned", detail: `Template "${name}" is not owned by the current user.`, template: name });
    const templateProfile = String(template.config_profile || template.profile || "");
    if (templateProfile && templateProfile !== String(profile || "")) return res.status(404).json({ code: "template_not_found", detail: `Template "${name}" was not found for this profile.`, template: name });

    const profileConfig = selectedProfileConfig({ profile, config_profile: profile });
    if (profileConfig.netbox && profileConfig.token) {
      const nextCatalogTemplates = { ...catalogTemplates };
      delete nextCatalogTemplates[entry.name];
      const nextCatalogWorkflows = workflowsWithoutTemplate(await workflowsForRequest(req, profile), entry.name, plainObject);
      const syncResult = await syncTemplatesToNetBoxConfigContext(req, profile, nextCatalogTemplates, nextCatalogWorkflows);
      return res.json({ deleted: true, template: entry.name, template_catalog_sync: syncResult });
    }

    writeState((state) => {
      state.templates = plainObject(state.templates);
      state.workflows = workflowsWithoutTemplate(state.workflows, entry.name, plainObject);
      delete state.templates[entry.name];
      return state;
    });

    return res.json({ deleted: true, template: entry.name });
  });

  app.get("/portable-config", requireAdmin, (req, res) => {
    const state = readState();
    const config = cleanStoredConfig(plainObject(state.config), parseProfiles, profilesWithSingleDefault, plainObject);
    const payload = { config };
    res.attachment(`saashup-config-${new Date().toISOString().slice(0, 10)}.json`).json(payload);
  });
  app.post("/portable-config", requireAdmin, async (req, res) => {
    const payload = plainObject(req.body);
    const config = plainObject(payload.config);
    const profiles = profilesWithSingleDefault(normalizeImportedProfiles(parseProfiles(payload.profiles || config.profiles), maxInstancesValue, plainObject));
    const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
    let selectedProfile = "";
    writeState((state) => {
      const existingConfig = plainObject(state.config);
      const mergedProfiles = profilesWithSingleDefault({ ...parseProfiles(existingConfig.profiles), ...profiles });
      selectedProfile = [
        config.profile,
        config.config_profile,
        existingConfig.profile,
        existingConfig.config_profile,
        names[0],
      ].find((value) => value) || "";
      const nextConfig = {
        customer_name: config.customer_name ?? existingConfig.customer_name ?? "",
        profile: selectedProfile,
        config_profile: selectedProfile,
        profiles: mergedProfiles,
      };
      state.config = cleanStoredConfig(nextConfig, parseProfiles, profilesWithSingleDefault, plainObject);
      return state;
    });
    res.json({ status: "imported", profiles: names.length });
  });

  app.get("/logs", (req, res) => res.type("text/html").send(readState().logs || "&nbsp;<br>"));
  app.delete("/logs", requireAdmin, (req, res) => {
    writeState((state) => {
      state.logs = "";
      return state;
    });
    res.json({ status: "cleared" });
  });
}

module.exports = {
  registerConfigRoutes,
  normalizeImportedProfiles,
  cleanStoredConfig,
  expandedConfigForResponse,
  publicConfigForResponse,
  brandingForStore,
  decodedBrandingImage,
  workflowsForVisibleTemplates,
  enrollmentTemplateUsage,
  dockerfileEnvEntries,
  environmentVariablesForResponse,
  includeTemplateWorkflows,
  templatesResponseForRequest,
  templateEntryByName,
  templateNameRequired,
  workflowsWithoutTemplate,
};
