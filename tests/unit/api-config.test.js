const configHelpers = require("../../api/config");

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {};
}

function mockResponse() {
  return {
    body: undefined,
    statusCode: 200,
    headers: {},
    attachmentName: "",
    attachment(name) {
      this.attachmentName = name;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(value) {
      this.headers.type = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createRoutes(overrides = {}) {
  const routes = {};
  let state = {
    config: {},
    templates: {},
    workflows: {},
    logs: "",
  };
  const app = {
    delete(path, ...handlers) {
      routes[`DELETE ${path}`] = handlers.at(-1);
    },
    get(path, ...handlers) {
      routes[`GET ${path}`] = handlers.at(-1);
    },
    options(path, ...handlers) {
      routes[`OPTIONS ${path}`] = handlers.at(-1);
    },
    post(path, ...handlers) {
      routes[`POST ${path}`] = handlers.at(-1);
    },
  };
  const defaultDependencies = {
    appOwnerEmail: "",
    authUserFromRequest: () => ({ email: "owner@example.com" }),
    maxInstancesValue: (value) => Number(value || 0),
    parseProfiles: (value) => {
      if (!value) return {};
      if (typeof value === "object" && !Array.isArray(value)) return value;
      return JSON.parse(value);
    },
    plainObject,
    profilesWithSingleDefault: (profiles) => profiles,
    publicApiGuard: (_req, _res, next) => next && next(),
    readState: () => state,
    registrySecretForTemplate: () => "",
    registryWebhookSecret: "",
    requireAdmin: (_req, _res, next) => next && next(),
    isAdminAllowed: () => true,
    selectedProfileConfig: () => ({}),
    sendContactEmail: async () => ({}),
    sendTestEmail: async () => ({}),
    syncTemplatesToNetBoxConfigContext: async () => null,
    templatesForRequest: async () => state.templates,
    templatesWithCreatorEmails: (templates) => templates,
    verifyContactTurnstile: async () => {},
    writeState: (updater) => {
      state = updater(state);
      return state;
    },
    workflowsForRequest: async () => state.workflows,
  };

  configHelpers.registerConfigRoutes(app, { ...defaultDependencies, ...overrides });
  return {
    routes,
    getState: () => state,
    setState: (nextState) => { state = nextState; },
  };
}

describe("api config helpers", () => {
  test("normalizeImportedProfiles migrates legacy limits and drops max_templates", () => {
    const profiles = {
      prod: { max_templates: 5, customer_name: "Acme" },
      dev: { max_instances: 2 },
      test: { enrollment_limit: 10, max_templates: 1 },
    };

    const normalized = configHelpers.normalizeImportedProfiles(profiles, (value) => Number(value), plainObject);
    expect(normalized.prod.enrollment_limit).toBe(5);
    expect(normalized.dev.enrollment_limit).toBe(2);
    expect(normalized.test.enrollment_limit).toBe(10);
    expect(normalized.prod.max_templates).toBeUndefined();
  });

  test("cleanStoredConfig chooses the configured profile and falls back alphabetically", () => {
    const config = {
      customer_name: "Acme",
      profiles: {
        dev: { tag: "dev" },
        prod: { tag: "prod" },
      },
    };
    const cleaned = configHelpers.cleanStoredConfig(config, (profiles) => profiles, (profiles) => profiles, plainObject);
    expect(cleaned.profile).toBe("dev");
    expect(cleaned.config_profile).toBe("dev");
    expect(cleaned.customer_name).toBe("Acme");
  });

  test("expandedConfigForResponse merges selected profile config when available", () => {
    const config = { customer_name: "Acme", profile: "prod", profiles: { prod: { tag: "prod" } } };
    const expanded = configHelpers.expandedConfigForResponse(config, ({ profile }) => ({ extra: profile }), (profiles) => profiles, (profiles) => profiles, plainObject);
    expect(expanded).toMatchObject({ customer_name: "Acme", profile: "prod", config_profile: "prod", extra: "prod" });

    const empty = configHelpers.expandedConfigForResponse({}, () => ({ extra: "unused" }), (profiles) => profiles || {}, (profiles) => profiles, plainObject);
    expect(empty).toEqual({ customer_name: "", profile: "", config_profile: "", profiles: {} });
  });

  test("publicConfigForResponse removes secrets and keeps profile metadata", () => {
    const config = {
      customer_name: "Acme",
      profile: "prod",
      profiles: {
        prod: {
          netbox: "https://netbox.example.com",
          token: "secret",
          proxy: "http://proxy:secret@example.com",
          domain: "example.com",
          tag: "tile",
          enrollment_limit: 2,
          smtp_config: "mailer:smtp-secret@smtp.example.com:587",
        },
      },
    };

    const sanitized = configHelpers.publicConfigForResponse(
      config,
      ({ profile }) => ({ ...config.profiles[profile], profile }),
      (profiles) => profiles,
      (profiles) => profiles,
      plainObject,
    );

    expect(sanitized).toMatchObject({
      customer_name: "Acme",
      profile: "prod",
      config_profile: "prod",
      domain: "example.com",
      tag: "tile",
      enrollment_limit: 2,
      profiles: {
        prod: { domain: "example.com", tag: "tile", enrollment_limit: 2 },
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("secret");
    expect(sanitized.netbox).toBeUndefined();
    expect(sanitized.token).toBeUndefined();
    expect(sanitized.proxy).toBeUndefined();
    expect(sanitized.smtp_config).toBeUndefined();
  });

  test("publicConfigForResponse adds selected profile metadata when profiles omit it", () => {
    const config = {
      customer_name: "Acme",
      profile: "prod",
      profiles: {},
    };

    const sanitized = configHelpers.publicConfigForResponse(
      config,
      () => ({
        domain: "example.com",
        tag: "tile",
        netbox: "https://netbox.example.com",
        token: "secret",
      }),
      (profiles) => profiles,
      (profiles) => profiles,
      plainObject,
    );

    expect(sanitized.profiles.prod).toEqual({
      domain: "example.com",
      tag: "tile",
      netbox_configured: true,
      token_configured: true,
      proxy_configured: false,
      smtp_configured: false,
    });
    expect(JSON.stringify(sanitized)).not.toContain("secret");
  });

  test("publicConfigForResponse returns empty strings for missing config identity", () => {
    const sanitized = configHelpers.publicConfigForResponse(
      {},
      () => ({}),
      (profiles) => profiles || {},
      (profiles) => profiles,
      plainObject,
    );

    expect(sanitized).toEqual({
      customer_name: "",
      profile: "",
      config_profile: "",
      netbox_configured: false,
      token_configured: false,
      proxy_configured: false,
      smtp_configured: false,
      profiles: {},
    });
  });

  test("workflowsForVisibleTemplates filters steps based on visible templates", () => {
    const workflows = {
      prod: { steps: [{ template: "nginx" }, { template: "missing" }, "simple" ] },
      other: { name: "other" },
    };
    const templates = { nginx: { image: "nginx" } };
    const filtered = configHelpers.workflowsForVisibleTemplates(workflows, templates);
    expect(filtered.prod.steps).toEqual([{ template: "nginx" }, "simple"]);
    expect(filtered.other).toEqual({ name: "other" });
  });

  test("workflowsForVisibleTemplates drops workflows once all template steps are hidden", () => {
    const filtered = configHelpers.workflowsForVisibleTemplates({
      hidden: { steps: [{ template: "missing" }] },
      emptyName: { steps: [{ label: "manual" }] },
    }, { visible: { image: "nginx" } });

    expect(filtered.hidden).toBeUndefined();
    expect(filtered.emptyName.steps).toEqual([{ label: "manual" }]);
  });

  test("enrollmentTemplateUsage default implementation reports no usage", () => {
    expect(configHelpers.enrollmentTemplateUsage({ templates: { nginx: {} } }, "prod", "nginx")).toBe(0);
  });

  test("templateEntryByName finds templates by exact and case-insensitive name", () => {
    const templates = { NGINX: { image: "nginx" }, redis: { image: "redis" } };
    expect(configHelpers.templateEntryByName(templates, "NGINX")).toEqual({ name: "NGINX", template: { image: "nginx" } });
    expect(configHelpers.templateEntryByName(templates, "nginx")).toEqual({ name: "NGINX", template: { image: "nginx" } });
    expect(configHelpers.templateEntryByName(templates, "none")).toBeNull();
    expect(configHelpers.templateEntryByName(templates)).toBeNull();
    expect(configHelpers.templateEntryByName({ scalar: "nginx" }, "scalar")).toEqual({ name: "scalar", template: {} });
    expect(configHelpers.templateEntryByName(null, "nginx")).toBeNull();
  });

  test("workflowsWithoutTemplate removes matching template steps and drops empty workflows", () => {
    const workflows = {
      prod: { steps: [{ template: "nginx" }, { template: "redis" }, "nginx"] },
      empty: { steps: [{ template: "nginx" }] },
      other: { name: "other" },
    };
    const result = configHelpers.workflowsWithoutTemplate(workflows, "nginx", plainObject);
    expect(result.prod.steps).toEqual([{ template: "redis" }]);
    expect(result.empty).toBeUndefined();
    expect(result.other).toEqual({ name: "other" });
    expect(configHelpers.workflowsWithoutTemplate({ manual: { steps: [{ label: "manual" }] } }, "nginx", plainObject).manual.steps).toEqual([{ label: "manual" }]);
    expect(configHelpers.workflowsWithoutTemplate(workflows, "", plainObject)).toEqual(workflows);
  });

  test("cleanStoredConfig falls back to the first profile when none is selected", () => {
    const config = { profiles: { alpha: { tag: "a" }, beta: { tag: "b" } } };
    const cleaned = configHelpers.cleanStoredConfig(config, (profiles) => profiles, (profiles) => profiles, plainObject);
    expect(cleaned.profile).toBe("alpha");
    expect(cleaned.config_profile).toBe("alpha");
  });
});

describe("api config routes", () => {
  test("mail routes report default failure details", async () => {
    const { routes } = createRoutes({
      sendContactEmail: async () => { throw {}; },
      sendTestEmail: async () => { throw {}; },
    });

    const testEmailRes = mockResponse();
    await routes["POST /test-email"]({ body: {} }, testEmailRes);
    expect(testEmailRes.statusCode).toBe(500);
    expect(testEmailRes.body).toEqual({ detail: "email test failed" });

    const contactRes = mockResponse();
    await routes["POST /contact"]({ body: {}, query: {} }, contactRes);
    expect(contactRes.statusCode).toBe(502);
    expect(contactRes.body).toEqual({ detail: "contact email failed" });
  });

  test("mail and registry secret routes include default response fallbacks", async () => {
    const { routes } = createRoutes({
      registrySecretForTemplate: (template, image) => `${template}:${image || "none"}`,
      registryWebhookSecret: "default-secret",
      sendTestEmail: async () => ({}),
    });

    const emailRes = mockResponse();
    await routes["POST /test-email"]({ body: {} }, emailRes);
    expect(emailRes.body).toMatchObject({
      status: "sent",
      message_id: "",
      accepted: [],
      rejected: [],
      response: "",
    });

    const defaultSecretRes = mockResponse();
    await routes["GET /registry-webhook-secret"]({ query: {} }, defaultSecretRes);
    expect(defaultSecretRes.body).toEqual({ secret: "default-secret", default_secret: "default-secret" });

    const templateSecretRes = mockResponse();
    await routes["GET /registry-webhook-secret"]({ query: { template: "Tile" } }, templateSecretRes);
    expect(templateSecretRes.body).toEqual({ secret: "Tile:none", default_secret: "default-secret" });
  });

  test("config route redacts credentials for all users", async () => {
    const state = {
      config: {
        customer_name: "Acme",
        profile: "prod",
        config_profile: "prod",
        profiles: {
          prod: {
            netbox: "https://netbox.example.com",
            token: "secret",
            proxy: "http://proxy:secret@example.com",
            domain: "example.com",
            tag: "tile",
            enrollment_limit: 2,
            smtp_config: "mailer:smtp-secret@smtp.example.com:587",
          },
        },
      },
      templates: {},
      workflows: {},
      logs: "",
    };
    const selectedProfileConfig = ({ profile }) => state.config.profiles[profile] || {};
    const nonAdmin = createRoutes({
      isAdminAllowed: () => false,
      readState: () => state,
      selectedProfileConfig,
    });
    const admin = createRoutes({
      isAdminAllowed: () => true,
      readState: () => state,
      selectedProfileConfig,
    });

    const nonAdminRes = mockResponse();
    await nonAdmin.routes["GET /config"]({}, nonAdminRes);
    expect(nonAdminRes.body.profiles.prod).toMatchObject({
      domain: "example.com",
      tag: "tile",
      enrollment_limit: 2,
      netbox_configured: true,
      token_configured: true,
      proxy_configured: true,
      smtp_configured: true,
    });
    expect(JSON.stringify(nonAdminRes.body)).not.toContain("secret");
    expect(JSON.stringify(nonAdminRes.body)).not.toContain("netbox.example.com");

    const adminRes = mockResponse();
    await admin.routes["GET /config"]({}, adminRes);
    expect(adminRes.body.profiles.prod).toMatchObject({
      domain: "example.com",
      tag: "tile",
      enrollment_limit: 2,
      netbox_configured: true,
      token_configured: true,
      proxy_configured: true,
      smtp_configured: true,
    });
    expect(JSON.stringify(adminRes.body)).not.toContain("secret");
    expect(JSON.stringify(adminRes.body)).not.toContain("netbox.example.com");
  });

  test("config route defaults to non-admin responses", async () => {
    const state = {
      config: {
        customer_name: "Acme",
        profile: "prod",
        profiles: {
          prod: {
            domain: "example.com",
            netbox: "https://netbox.example.com",
            token: "secret",
          },
        },
      },
      templates: {},
      workflows: {},
      logs: "",
    };
    const { routes } = createRoutes({
      isAdminAllowed: undefined,
      readState: () => state,
      selectedProfileConfig: ({ profile }) => state.config.profiles[profile] || {},
    });

    const res = mockResponse();
    await routes["GET /config"]({}, res);

    expect(res.body.profiles.prod).toMatchObject({ domain: "example.com", netbox_configured: true, token_configured: true });
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  test("webhook accepts profile values from imported profiles and empty fallbacks", async () => {
    const syncTemplatesToNetBoxConfigContext = vi.fn().mockResolvedValue(null);
    const { routes } = createRoutes({ syncTemplatesToNetBoxConfigContext });

    const profileRes = mockResponse();
    await routes["GET /webhook"]({
      query: {
        profile: "prod",
        profiles: JSON.stringify({ prod: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" } }),
      },
    }, profileRes);
    expect(profileRes.body).toMatchObject({ netbox: "https://netbox.example.com", token: "secret", tag: "tile" });

    const emptyRes = mockResponse();
    await routes["GET /webhook"]({
      query: { profile: "empty", owner_env_var: "   ", profiles: JSON.stringify({ empty: {} }) },
    }, emptyRes);
    expect(emptyRes.body).toMatchObject({ netbox: "", token: "", tag: "", owner_env_var: "SAASHUP_OWNER" });

    const cloudflareRes = mockResponse();
    await routes["GET /webhook"]({
      query: { profile: "filtered", cloudflare_filter: "false", profiles: JSON.stringify({ filtered: {} }) },
    }, cloudflareRes);
    expect(cloudflareRes.body.cloudflare_filter).toBe(false);

    const preserve = createRoutes();
    preserve.setState({
      config: {
        customer_name: "Acme",
        profile: "prod",
        config_profile: "prod",
        profiles: {
          prod: {
            netbox: "https://netbox.example.com",
            token: "secret",
            proxy: "http://proxy:secret@example.com",
            smtp_config: "mailer:smtp-secret@smtp.example.com:587",
            domain: "old.example.com",
            tag: "old",
          },
        },
      },
      templates: {},
      workflows: {},
      logs: "",
    });
    const preserveRes = mockResponse();
    await preserve.routes["GET /webhook"]({
      query: {
        profile: "prod",
        domain: "new.example.com",
        tag: "new",
        profiles: JSON.stringify({
          prod: {
            netbox_configured: true,
            token_configured: true,
            smtp_configured: true,
          },
        }),
      },
    }, preserveRes);
    expect(preserveRes.body).toMatchObject({
      netbox: "https://netbox.example.com",
      token: "secret",
      proxy: "http://proxy:secret@example.com",
      smtp_config: "mailer:smtp-secret@smtp.example.com:587",
      domain: "new.example.com",
      tag: "new",
    });

    const failed = createRoutes({
      syncTemplatesToNetBoxConfigContext: async () => { throw {}; },
    });
    const failedRes = mockResponse();
    await failed.routes["GET /webhook"]({ query: { profile: "prod", profiles: JSON.stringify({ prod: {} }) } }, failedRes);
    expect(failedRes.body.template_catalog_sync).toEqual({ action: "failed", detail: "template catalog sync failed" });
  });

  test("templates route filters workflows for owner-only catalog requests", async () => {
    const { routes, setState } = createRoutes();
    setState({
      config: { profile: "prod", config_profile: "prod" },
      templates: { Tile: { image: "saashup/tile" } },
      workflows: {
        keep: { steps: [{ template: "Tile" }] },
        drop: { steps: [{ template: "Missing" }] },
      },
      logs: "",
    });

    const res = mockResponse();
    await routes["GET /templates"]({ query: { include_workflows: "true", owner_only: "true" } }, res);
    expect(res.body.workflows.keep.steps).toEqual([{ template: "Tile" }]);
    expect(res.body.workflows.drop).toBeUndefined();
  });

  test("templates route reports default sync failure details", async () => {
    const { routes } = createRoutes({
      syncTemplatesToNetBoxConfigContext: async () => { throw {}; },
    });

    const res = mockResponse();
    await routes["POST /templates"]({ body: { tile: { image: "saashup/tile" } }, query: {} }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ detail: "template sync failed", payload: undefined });
  });

  test("enroll template delete handles singular usage and local validation errors", async () => {
    const singular = createRoutes({
      enrollmentTemplateDeleteUsage: async () => ({ total: 1, blocked: 1, owned: 0 }),
    });
    const singularRes = mockResponse();
    await singular.routes["DELETE /enroll/template/:name"]({ params: { name: "Tile" }, query: { profile: "prod" } }, singularRes);
    expect(singularRes.statusCode).toBe(409);
    expect(singularRes.body.detail).toBe('Template "Tile" is used by 1 instance.');

    const plural = createRoutes({
      enrollmentTemplateDeleteUsage: async () => ({ total: 2, blocked: 2, owned: 0 }),
    });
    const pluralRes = mockResponse();
    await plural.routes["DELETE /enroll/template/:name"]({ params: { name: "Tile" }, query: { profile: "prod" } }, pluralRes);
    expect(pluralRes.statusCode).toBe(409);
    expect(pluralRes.body.detail).toBe('Template "Tile" is used by 2 instances.');

    const notFound = createRoutes({ enrollmentTemplateDeleteUsage: async () => ({ total: 0, blocked: 0, owned: 0 }) });
    const notFoundRes = mockResponse();
    await notFound.routes["DELETE /enroll/template/:name"]({ params: { name: "Missing" }, query: { profile: "prod" } }, notFoundRes);
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.body.code).toBe("template_not_found");

    const notOwned = createRoutes({ enrollmentTemplateDeleteUsage: async () => ({ total: 0, blocked: 0, owned: 0 }) });
    notOwned.setState({
      config: {},
      templates: { Tile: { creator_email: "other@example.com", image: "saashup/tile" } },
      workflows: {},
      logs: "",
    });
    const notOwnedRes = mockResponse();
    await notOwned.routes["DELETE /enroll/template/:name"]({ params: { name: "Tile" }, query: { profile: "prod" } }, notOwnedRes);
    expect(notOwnedRes.statusCode).toBe(403);
    expect(notOwnedRes.body.code).toBe("template_not_owned");

    const wrongProfile = createRoutes({ enrollmentTemplateDeleteUsage: async () => ({ total: 0, blocked: 0, owned: 0 }) });
    wrongProfile.setState({
      config: {},
      templates: { Tile: { profile: "other", creator_email: "owner@example.com", image: "saashup/tile" } },
      workflows: {},
      logs: "",
    });
    const wrongProfileRes = mockResponse();
    await wrongProfile.routes["DELETE /enroll/template/:name"]({ params: { name: "Tile" }, query: {} }, wrongProfileRes);
    expect(wrongProfileRes.statusCode).toBe(404);
    expect(wrongProfileRes.body.code).toBe("template_not_found");
  });

  test("local enroll template delete handles auth guards and local catalog entries", async () => {
    const missingAuth = createRoutes({ authUserFromRequest: () => ({}) });
    const missingAuthRes = mockResponse();
    await missingAuth.routes["DELETE /enroll/template/:name"]({ params: { name: "Tile" }, query: { profile: "prod" } }, missingAuthRes);
    expect(missingAuthRes.statusCode).toBe(401);
    expect(missingAuthRes.body.code).toBe("auth_required");

    const blankName = createRoutes();
    const blankNameRes = mockResponse();
    await blankName.routes["DELETE /enroll/template/:name"]({ params: { name: "   " }, query: { profile: "prod" } }, blankNameRes);
    expect(blankNameRes.statusCode).toBe(400);
    expect(blankNameRes.body.code).toBe("template_required");

    const { getState, routes, setState } = createRoutes({ authUserFromRequest: () => ({ user: "owner@example.com" }) });
    setState({
      config: { profile: "prod", config_profile: "prod" },
      templates: { Tile: { creator_email: "owner@example.com", image: "saashup/tile" } },
      workflows: {
        templates: { steps: [{ template: "Tile" }, { template: "Other" }] },
      },
      logs: "",
    });

    const res = mockResponse();
    await routes["DELETE /enroll/template/:name"]({ params: { name: "Tile" }, query: { profile: "prod" } }, res);

    expect(res.body).toEqual({ deleted: true, template: "Tile" });
    expect(getState().templates.Tile).toBeUndefined();
    expect(getState().workflows.templates.steps).toEqual([{ template: "Other" }]);
  });

  test("portable config import falls back to existing config profile and imported names", async () => {
    const { getState, routes, setState } = createRoutes();
    setState({ config: { config_profile: "stored" }, templates: {}, workflows: {}, logs: "" });

    const existingRes = mockResponse();
    await routes["POST /portable-config"]({ body: { config: {}, profiles: {} } }, existingRes);
    expect(existingRes.body).toEqual({ status: "imported", profiles: 0 });
    expect(getState().config.profile).toBe("stored");

    setState({ config: {}, templates: {}, workflows: {}, logs: "" });
    const importedNameRes = mockResponse();
    await routes["POST /portable-config"]({
      body: { config: {}, profiles: { alpha: { tag: "a" } } },
    }, importedNameRes);
    expect(importedNameRes.body).toEqual({ status: "imported", profiles: 1 });
    expect(getState().config.profile).toBe("alpha");

    setState({ config: {}, templates: {}, workflows: {}, logs: "" });
    const emptyRes = mockResponse();
    await routes["POST /portable-config"]({ body: { config: {}, profiles: {} } }, emptyRes);
    expect(emptyRes.body).toEqual({ status: "imported", profiles: 0 });
    expect(getState().config.profile).toBe("");
  });
});
