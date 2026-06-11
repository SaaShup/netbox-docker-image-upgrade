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
  return {
    ...stored,
    ...selected,
    customer_name: stored.customer_name,
    profile: stored.profile,
    config_profile: stored.config_profile,
    profiles: stored.profiles,
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
  enrollmentTemplateDeleteUsage,
  templatesForRequest,
  templatesWithCreatorEmails,
  verifyContactTurnstile,
  writeState,
  workflowsForRequest,
}) {
  app.get("/config", (req, res) => {
    const config = readState().config || {};
    if (!Object.keys(plainObject(config)).length) {
      res.json({});
      return;
    }
    res.json(expandedConfigForResponse(config, selectedProfileConfig, parseProfiles, profilesWithSingleDefault, plainObject));
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
    const parsedProfiles = profilesWithSingleDefault(normalizeImportedProfiles(parseProfiles(req.query.profiles), maxInstancesValue, plainObject));
    const selectedInputProfile = plainObject(parsedProfiles[profileName]);
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
        netbox: req.query.netbox ?? selectedInputProfile.netbox ?? "",
        token: req.query.token ?? selectedInputProfile.token ?? "",
        proxy: req.query.proxy ?? selectedInputProfile.proxy ?? "",
        domain: req.query.domain ?? selectedInputProfile.domain ?? "",
        tag: req.query.tag ?? selectedInputProfile.tag ?? "",
        enrollment_limit: enrollmentLimit,
        owner_env_var: ownerEnvVar,
        cloudflare_filter: cloudflareFilter,
        smtp_config: req.query.smtp_config ?? selectedInputProfile.smtp_config ?? "",
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
    const state = readState();
    const profile = req.query.profile || req.query.config_profile || state.config?.profile || state.config?.config_profile || "";
    const ownerOnly = req.query.owner_only === "true" || req.query.enroll === "true";
    const templates = await templatesForRequest(req, profile, { ownerOnly });
    if (req.query.include_workflows === "true") {
      const workflows = await workflowsForRequest(req, profile);
      res.json({
        templates,
        workflows: ownerOnly ? workflowsForVisibleTemplates(workflows, templates) : workflows,
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

  app.delete("/enroll/template/:name", async (req, res) => {
    const name = String(req.params.name || "").trim();
    const profile = req.query.profile || req.query.config_profile || readState().config?.profile || readState().config?.config_profile || "";
    const authUser = authUserFromRequest(req);
    const creator = String(authUser.email || authUser.user || "").trim().toLowerCase();
    if (!creator) return res.status(401).json({ code: "auth_required", detail: "Authentication is required." });
    if (!name) return res.status(400).json({ code: "template_required", detail: "Template name is required." });

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
  workflowsForVisibleTemplates,
  enrollmentTemplateUsage,
  templateEntryByName,
  workflowsWithoutTemplate,
};
