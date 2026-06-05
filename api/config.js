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

  app.get("/templates", (req, res) => res.json(readState().templates || {}));
  app.post("/templates", requireAdmin, (req, res) => {
    let templates = {};
    const creatorEmail = authUserFromRequest(req).email || "";
    writeState((state) => {
      templates = templatesWithCreatorEmails(req.body, plainObject(state.templates), creatorEmail);
      state.templates = templates;
      return state;
    });
    res.json(templates);
  });

  app.get("/portable-config", requireAdmin, (req, res) => {
    const state = readState();
    const config = plainObject(state.config);
    const payload = {
      type: "saashup-config-export",
      version: 1,
      app_version: packageJson.version,
      exported_at: new Date().toISOString(),
      config: { ...config, profiles: profilesWithSingleDefault(parseProfiles(config.profiles)) },
      templates: plainObject(state.templates),
      order_counts: plainObject(state.order_counts),
      enrollment_counts: plainObject(state.enrollment_counts),
      order_instances: plainObject(state.order_instances),
      enrollment_instances: plainObject(state.enrollment_instances),
    };
    res.attachment(`saashup-config-${new Date().toISOString().slice(0, 10)}.json`).json(payload);
  });
  app.post("/portable-config", requireAdmin, (req, res) => {
    const payload = plainObject(req.body);
    const config = plainObject(payload.config);
    const profiles = profilesWithSingleDefault(normalizeImportedProfiles(parseProfiles(payload.profiles || config.profiles), maxInstancesValue, plainObject));
    const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
    const importedTemplates = plainObject(payload.templates);
    const importedOrderCounts = plainObject(payload.order_counts);
    const importedEnrollmentCounts = plainObject(payload.enrollment_counts);
    const importedOrderInstances = plainObject(payload.order_instances);
    const importedEnrollmentInstances = plainObject(payload.enrollment_instances);
    writeState((state) => {
      const existingConfig = plainObject(state.config);
      const mergedProfiles = profilesWithSingleDefault({ ...parseProfiles(existingConfig.profiles), ...profiles });
      const selectedProfile = config.profile || config.config_profile || existingConfig.profile || existingConfig.config_profile || names[0] || "";
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
      state.templates = { ...plainObject(state.templates), ...importedTemplates };
      state.order_counts = mergeProfileMaps(plainObject(state.order_counts), importedOrderCounts);
      state.enrollment_counts = mergeProfileMaps(plainObject(state.enrollment_counts), importedEnrollmentCounts);
      state.order_instances = mergeProfileMaps(plainObject(state.order_instances), importedOrderInstances);
      state.enrollment_instances = mergeProfileMaps(plainObject(state.enrollment_instances), importedEnrollmentInstances);
      return state;
    });
    res.json({ status: "imported", profiles: names.length, templates: Object.keys(importedTemplates).length });
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
