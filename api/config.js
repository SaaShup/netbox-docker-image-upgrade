function normalizeImportedProfiles(profiles, maxInstancesValue, plainObject) {
  return Object.fromEntries(Object.entries(plainObject(profiles)).map(([name, profile]) => {
    const normalized = plainObject(profile);
    if (normalized.max_templates === undefined && normalized.max_instances !== undefined) {
      normalized.max_templates = maxInstancesValue(normalized.max_instances);
    }
    if (normalized.enrollment_limit === undefined && normalized.max_templates !== undefined) {
      normalized.enrollment_limit = maxInstancesValue(normalized.max_templates);
    }
    return [name, normalized];
  }));
}

function registerConfigRoutes(app, {
  appOwnerEmail,
  authUserFromRequest,
  maxInstancesValue,
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
  syncTemplatesToNetBoxConfigContext,
  templatesForRequest,
  templatesWithCreatorEmails,
  verifyContactTurnstile,
  writeState,
  workflowsForRequest,
}) {
  app.get("/config", (req, res) => res.json(readState().config || {}));
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
      res.status(error.statusCode || 502).json({ detail: error.message || "email test failed" });
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
  app.get("/webhook", requireAdmin, (req, res) => {
    const profiles = profilesWithSingleDefault(parseProfiles(req.query.profiles));
    const config = {
      customer_name: req.query.customer_name || "",
      netbox: req.query.netbox || "",
      token: req.query.token || "",
      proxy: req.query.proxy || "",
      domain: req.query.domain || "",
      tag: req.query.tag || "",
      max_templates: maxInstancesValue(req.query.max_templates ?? req.query.max_instances ?? req.query.enrollment_limit),
      enrollment_limit: maxInstancesValue(req.query.enrollment_limit),
      owner_env_var: String(req.query.owner_env_var || "SAASHUP_OWNER").trim() || "SAASHUP_OWNER",
      cloudflare_filter: req.query.cloudflare_filter !== "false",
      smtp_config: req.query.smtp_config || "",
      profile: req.query.profile || req.query.config_profile || "",
      config_profile: req.query.config_profile || req.query.profile || "",
      profiles: JSON.stringify(profiles),
    };
    writeState((state) => {
      state.config = config;
      return state;
    });
    res.json(config);
  });

  app.get("/templates", async (req, res) => {
    const state = readState();
    const profile = req.query.profile || req.query.config_profile || state.config?.profile || state.config?.config_profile || "";
    const templates = await templatesForRequest(req, profile);
    if (req.query.include_workflows === "true") {
      res.json({
        templates,
        workflows: await workflowsForRequest(req, profile),
      });
      return;
    }
    res.json(templates);
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

  app.get("/portable-config", requireAdmin, (req, res) => {
    const state = readState();
    const config = plainObject(state.config);
    const payload = { config: { ...config, profiles: profilesWithSingleDefault(parseProfiles(config.profiles)) } };
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
      selectedProfile = config.profile || config.config_profile || existingConfig.profile || existingConfig.config_profile || names[0] || "";
      const nextConfig = {
        ...existingConfig,
        ...config,
        profiles: JSON.stringify(mergedProfiles),
      };
      if (selectedProfile) {
        nextConfig.profile = selectedProfile;
        nextConfig.config_profile = selectedProfile;
      }
      state.config = nextConfig;
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

module.exports = { registerConfigRoutes };
