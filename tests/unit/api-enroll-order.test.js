const { createEnrollHelpers } = require("../../api/enroll");
const { createOrderHelpers } = require("../../api/order");

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function plainObject(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : {};
}

function createEnroll(overrides = {}) {
  const defaultDependencies = {
    asArray,
    authUserFromRequest: () => ({ email: "owner@example.com", user: "owner@example.com" }),
    blockedEnrollmentImages: [],
    containerEnvValue: () => "",
    hostIdQuery: async () => ({ host_id: "__none__" }),
    imageKeyFromImageObject: () => "",
    imageKeyFromRefAndVersion: () => "",
    imageNameFromRef: (value) => String(value || "").split("/").pop().split(":")[0],
    imageNameKey: (value) => String(value || "").split("/").pop().split(/[:@]/)[0],
    imageNameKeyFromImageObject: (value) => String(value || "").split("/").pop().split(/[:@]/)[0],
    labelMapFromContainer: () => ({}),
    logLine: () => {},
    maxInstancesValue: (value) => Number(value ?? 1),
    NetBoxClient: class {},
    orderInstanceCountForTemplate: () => 0,
    ownerEnvVarName: () => "OWNER",
    plainJsonObject: plainObject,
    plainObject,
    profileUsesNetBoxTemplates: () => false,
    readState: () => ({ templates: {} }),
    selectedProfileConfig: () => ({ enrollment_limit: 5 }),
    syncTemplatesToNetBoxConfigContext: async () => ({}),
    templateEntryForRequest: async () => null,
    templatesForRequest: async () => ({}),
    workflowsForRequest: async () => ({}),
    writeState: (fn) => fn({ templates: {} }),
  };
  return createEnrollHelpers({ ...defaultDependencies, ...overrides });
}

describe("api/enroll helpers", () => {
  test("validateEnrollmentTemplate rejects missing version, latest, and duplicate entries", async () => {
    const helpers = createEnroll({
      readState: () => ({
        templates: {
          app: { image: "docker.io/library/app:1.2", version: "1.2" },
        },
      }),
      profileUsesNetBoxTemplates: () => false,
    });
    const req = {};
    const missingVersionRes = mockResponse();
    await expect(helpers.validateEnrollmentTemplate(req, missingVersionRes, "prod", { image: "docker.io/library/app" })).resolves.toBe(false);
    expect(missingVersionRes.statusCode).toBe(400);
    expect(missingVersionRes.body.code).toBe("image_version_required");

    const latestRes = mockResponse();
    await expect(helpers.validateEnrollmentTemplate(req, latestRes, "prod", { image: "docker.io/library/app:latest" })).resolves.toBe(false);
    expect(latestRes.statusCode).toBe(400);
    expect(latestRes.body.code).toBe("image_version_latest_not_allowed");

    const duplicateRes = mockResponse();
    await expect(helpers.validateEnrollmentTemplate(req, duplicateRes, "prod", { image: "docker.io/library/app:1.2" })).resolves.toBe(false);
    expect(duplicateRes.statusCode).toBe(409);
    expect(duplicateRes.body.code).toBe("template_already_enrolled");

    const validRes = mockResponse();
    await expect(helpers.validateEnrollmentTemplate(req, validRes, "prod", { image: "docker.io/library/new:1.2" })).resolves.toBe(true);
    expect(validRes.statusCode).toBe(200);
  });

  test("currentEnrollmentUsage computes used, max, remaining, and reached", async () => {
    const helpers = createEnroll({
      selectedProfileConfig: () => ({ enrollment_limit: 4 }),
      maxInstancesValue: (value) => Number(value),
      profileUsesNetBoxTemplates: () => false,
      readState: () => ({
        templates: {
          first: { image: "docker.io/library/app:1.2", version: "1.2" },
          second: { image: "docker.io/library/app2:2.0", version: "2.0" },
        },
      }),
    });
    const usage = await helpers.currentEnrollmentUsage({}, "prod", { ownerOnly: false });
    expect(usage).toMatchObject({ profile: "prod", used: 2, max: 4, remaining: 2, reached: false });
    expect(usage.instances).toHaveLength(2);
  });

  test("currentEnrollmentUsage returns empty usage for anonymous users when ownerOnly is true", async () => {
    const helpers = createEnroll({
      authUserFromRequest: () => ({}),
      selectedProfileConfig: () => ({ enrollment_limit: 4 }),
      maxInstancesValue: (value) => Number(value),
      profileUsesNetBoxTemplates: () => false,
      readState: () => ({
        templates: {
          first: { image: "docker.io/library/app:1.2", version: "1.2", creator_email: "anon@example.com" },
        },
      }),
    });
    const usage = await helpers.currentEnrollmentUsage({}, "prod");
    expect(usage).toMatchObject({ profile: "prod", used: 0, max: 4, remaining: 4, reached: false });
  });

  test("currentEnrollmentUsage can load NetBox templates when profile uses NetBox templates", async () => {
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      selectedProfileConfig: () => ({ enrollment_limit: 5, netbox: true, token: "token" }),
      maxInstancesValue: (value) => Number(value),
      profileUsesNetBoxTemplates: () => true,
      readState: () => ({ templates: {} }),
      templatesForRequest: async () => ({
        app: {
          creator_email: "owner@example.com",
          config_profile: "prod",
          image: "docker.io/library/app:1.2",
          version: "1.2",
        },
      }),
    });
    const usage = await helpers.currentEnrollmentUsage({}, "prod");
    expect(usage).toMatchObject({ profile: "prod", used: 1, max: 5, remaining: 4, reached: false });
  });

  test("templateNameFromEnrollmentData prefers explicit template names and falls back to image names", () => {
    const helpers = createEnroll();
    expect(helpers.templateNameFromEnrollmentData({ order_template: "explicit-name" })).toBe("explicit-name");
    expect(helpers.templateNameFromEnrollmentData({ image: "saashup/test-image:2.0" })).toBe("test-image");
    expect(helpers.templateNameFromEnrollmentData({ instance: "fallback-name" })).toBe("fallback-name");
  });

  test("normalizes enrollment image names and blocks matching images", () => {
    const helpers = createEnroll({ blockedEnrollmentImages: ["saashup/tile"] });
    expect(helpers.normalizedEnrollImageName("")).toBe("");
    expect(helpers.normalizedEnrollImageName("saashup/tile:1.0")).toBe("saashup/tile");
    expect(helpers.normalizedEnrollImageName("saashup/tile@sha256:abcd")).toBe("saashup/tile");
    expect(helpers.imageTagFromRef("saashup/tile:1.0")).toBe("1.0");
    expect(helpers.imageTagFromRef("saashup/tile")).toBe("");
    expect(helpers.enrollImageTokens("")).toEqual(new Set());
    expect(helpers.enrollImageTokens("saashup/tile:1.0")).toEqual(new Set(["saashup/tile", "tile"]));
    expect(helpers.enrollImageMatches("saashup/tile:1.0", "tile")).toBe(true);
    expect(helpers.configuredEnrollmentImageBlock("saashup/tile:1.0")).toBe("saashup/tile");
  });

  test("validateEnrollmentTemplate allows empty image values", async () => {
    const helpers = createEnroll();
    const res = mockResponse();
    await expect(helpers.validateEnrollmentTemplate({}, res, "prod", {})).resolves.toBe(true);
    expect(res.statusCode).toBe(200);
  });

  test("enrollmentTemplatesForRequest returns no owner templates for anonymous requests", async () => {
    const helpers = createEnroll({
      authUserFromRequest: () => ({}),
      profileUsesNetBoxTemplates: () => false,
      readState: () => ({ templates: { app: { image: "repo/app:1.0", version: "1.0", creator_email: "owner@example.com" } } }),
    });
    const results = await helpers.enrollmentTemplatesForRequest({}, "prod");
    expect(results).toEqual([]);
  });

  test("enrollmentTemplatesForRequest returns local templates for owner requests", async () => {
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      profileUsesNetBoxTemplates: () => false,
      readState: () => ({ templates: { app: { image: "repo/app:1.0", version: "1.0", creator_email: "owner@example.com" } } }),
    });
    const results = await helpers.enrollmentTemplatesForRequest({}, "prod", { ownerOnly: true });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ instance: "app", image: "repo/app:1.0" });
  });

  test("enrollmentTemplatesForRequest logs and returns empty array when NetBox discovery fails", async () => {
    const errors = [];
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      selectedProfileConfig: () => ({ netbox: true, token: "token" }),
      profileUsesNetBoxTemplates: () => true,
      templatesForRequest: async () => { throw new Error("boom"); },
      logLine: (message) => errors.push(message),
    });
    const results = await helpers.enrollmentTemplatesForRequest({}, "prod");
    expect(results).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("NetBox template discovery failed");
  });

  test("enrollmentTemplatesForRequest loads NetBox templates when configured", async () => {
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      selectedProfileConfig: () => ({ netbox: true, token: "token" }),
      profileUsesNetBoxTemplates: () => true,
      templatesForRequest: async () => ({
        app: { creator_email: "owner@example.com", config_profile: "prod", image: "repo/app:1.0", version: "1.0" },
      }),
    });
    const results = await helpers.enrollmentTemplatesForRequest({}, "prod");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ instance: "app", image: "repo/app:1.0" });
  });

  test("enrollmentTemplatesForRequest filters NetBox templates by profile and owner", async () => {
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      selectedProfileConfig: () => ({ netbox: true, token: "token" }),
      profileUsesNetBoxTemplates: () => true,
      templatesForRequest: async () => ({
        app: { creator_email: "owner@example.com", config_profile: "prod", image: "repo/app:1.0", version: "1.0" },
        other: { creator_email: "owner@example.com", config_profile: "other", image: "repo/other:1.0", version: "1.0" },
        notowner: { creator_email: "other@example.com", config_profile: "prod", image: "repo/notowner:1.0", version: "1.0" },
      }),
    });
    const results = await helpers.enrollmentTemplatesForRequest({}, "prod", { ownerOnly: true });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ instance: "app", image: "repo/app:1.0" });
  });

  test("enrollmentTemplatesForUser returns owner-only templates through wrapper", async () => {
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      profileUsesNetBoxTemplates: () => false,
      readState: () => ({ templates: { app: { image: "repo/app:1.0", version: "1.0", creator_email: "owner@example.com" } } }),
    });
    const results = await helpers.enrollmentTemplatesForUser({}, "prod");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ instance: "app", image: "repo/app:1.0" });
  });

  test("enrollmentTemplateDeleteUsage handles NetBox container discovery errors", async () => {
    const log = [];
    const helpers = createEnroll({
      profileUsesNetBoxTemplates: () => true,
      selectedProfileConfig: () => ({ netbox: true, token: "token", tag: "tag" }),
      templateEntryForRequest: async () => ({ template: { image: "saashup/tile:1.0", version: "1.0" } }),
      hostIdQuery: async () => ({ host_id: 1 }),
      NetBoxClient: class {
        constructor() { this.list = async () => { throw new Error("failure"); }; }
      },
      labelMapFromContainer: () => ({}),
      templateLabelValue: () => "",
      imageKeyFromRefAndVersion: () => "",
      imageNameKey: () => "",
      imageKeyFromImageObject: () => "",
      imageNameKeyFromImageObject: () => "",
      containerEnvValue: () => "",
      logLine: (message) => log.push(message),
    });
    const usage = await helpers.enrollmentTemplateDeleteUsage({}, "prod", "tile", "owner@example.com");
    expect(usage).toEqual({ owned: 0, blocked: 1, total: 1 });
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("template delete usage check failed");
  });

  test("enrollmentTemplateDeleteUsage returns empty usage for missing names, disabled NetBox, and missing hosts", async () => {
    const localHelpers = createEnroll({
      selectedProfileConfig: () => ({}),
    });
    await expect(localHelpers.enrollmentTemplateDeleteUsage({}, "prod", "", "owner@example.com")).resolves.toEqual({ owned: 0, blocked: 0, total: 0 });
    await expect(localHelpers.enrollmentTemplateDeleteUsage({}, "prod", "tile", "owner@example.com")).resolves.toEqual({ owned: 0, blocked: 0, total: 0 });

    const noHostHelpers = createEnroll({
      selectedProfileConfig: () => ({ netbox: true, token: "token" }),
      hostIdQuery: async () => ({ host_id: "__none__" }),
      NetBoxClient: class {},
    });
    await expect(noHostHelpers.enrollmentTemplateDeleteUsage({}, "prod", "tile", "owner@example.com")).resolves.toEqual({ owned: 0, blocked: 0, total: 0 });
  });

  test("updateEnrollmentInstanceStatus updates local state and syncs netbox templates", async () => {
    let state = { templates: { existing: { status: "pending" } } };

    const localHelpers = createEnroll({
      profileUsesNetBoxTemplates: () => false,
      writeState: (fn) => { state = fn(state); return state; },
    });
    await localHelpers.updateEnrollmentInstanceStatus({}, "prod", "existing", "ready");
    expect(state.templates.existing.status).toBe("ready");

    const log = [];
    const netboxHelpers = createEnroll({
      profileUsesNetBoxTemplates: () => true,
      templatesForRequest: async () => ({ existing: { status: "pending" } }),
      workflowsForRequest: async () => ({}),
      syncTemplatesToNetBoxConfigContext: async () => ({ name: "sync", action: "updated" }),
      logLine: (message) => log.push(message),
    });
    await netboxHelpers.updateEnrollmentInstanceStatus({}, "prod", "existing", "ready");
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("status ready");
  });

  test("updateEnrollmentInstanceStatus is a no-op for blank or missing templates", async () => {
    let state = { templates: { existing: { status: "pending" } } };
    const localHelpers = createEnroll({
      profileUsesNetBoxTemplates: () => false,
      writeState: (fn) => { state = fn(state); return state; },
    });
    await localHelpers.updateEnrollmentInstanceStatus({}, "prod", "", "ready");
    await localHelpers.updateEnrollmentInstanceStatus({}, "prod", "missing", "ready");
    expect(state).toEqual({ templates: { existing: { status: "pending" } } });

    const sync = vi.fn();
    const netboxHelpers = createEnroll({
      profileUsesNetBoxTemplates: () => true,
      templatesForRequest: async () => ({ existing: { status: "pending" } }),
      syncTemplatesToNetBoxConfigContext: sync,
    });
    await netboxHelpers.updateEnrollmentInstanceStatus({}, "prod", "missing", "ready");
    expect(sync).not.toHaveBeenCalled();
  });

  test("enrollmentTemplateDeleteUsage counts owned and blocked containers", async () => {
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      selectedProfileConfig: () => ({ netbox: true, token: "token", tag: "tag" }),
      profileUsesNetBoxTemplates: () => true,
      hostIdQuery: async () => ({ host_id: 1 }),
      templateEntryForRequest: async () => ({ template: { image: "saashup/tile:1.0", version: "1.0" } }),
      templatesForRequest: async () => ({}),
      imageKeyFromRefAndVersion: (image, version) => `${image}:${version}`,
      imageNameKey: (image) => String(image || "").split("/").pop().split(/[:@]/)[0],
      imageKeyFromImageObject: (image) => String(image || "").split("/").pop(),
      imageNameKeyFromImageObject: (image) => String(image || "").split("/").pop(),
      containerEnvValue: (container) => container.env?.owner || "",
      labelMapFromContainer: (container) => container.labels || {},
      templateLabelValue: (labels, key) => labels[key] || "",
      NetBoxClient: class {
        constructor() { this.list = async () => [
          { image: "saashup/tile:1.0", image_name: "saashup/tile", image_version: "1.0", labels: { name: "tile", owner: "owner@example.com" }, env: { owner: "owner@example.com" } },
          { image: "saashup/tile:1.0", image_name: "saashup/tile", image_version: "1.0", labels: { name: "tile", owner: "other@example.com" }, env: { owner: "other@example.com" } },
        ]; }
      },
    });

    const usage = await helpers.enrollmentTemplateDeleteUsage({}, "prod", "tile", "owner@example.com");
    expect(usage).toEqual({ owned: 1, blocked: 1, total: 2 });
  });

  test("recordEnrollment writes local templates and syncs NetBox templates when configured", async () => {
    let state = { templates: {} };
    const log = [];
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      profileUsesNetBoxTemplates: () => true,
      templatesForRequest: async () => ({}),
      workflowsForRequest: async () => ({}),
      syncTemplatesToNetBoxConfigContext: async () => ({ name: "sync", action: "created" }),
      logLine: (message) => log.push(message),
      selectedProfileConfig: () => ({ netbox: true, token: "token" }),
    });

    await helpers.recordEnrollment({ headers: {} }, "prod", { image: "saashup/tile:1.0" });
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("synced to config context");
  });

  test("recordEnrollment persists local templates when NetBox is not enabled", async () => {
    let state = { templates: {} };
    const helpers = createEnroll({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      profileUsesNetBoxTemplates: () => false,
      writeState: (fn) => { state = fn(state); return state; },
    });

    await helpers.recordEnrollment({ headers: {} }, "prod", { image: "saashup/tile:1.0" });
    expect(state.templates["tile"].status).toBe("creating");
    expect(state.templates["tile"].creator_email).toBe("owner@example.com");
  });

  test("enrollmentTemplateFromData merges template fields and workflow helpers update steps", () => {
    const helpers = createEnroll();
    const data = {
      image: "saashup/tile:2.0",
      version: "2.0",
      var_env_key: ["env"],
      var_env_value: ["prod"],
      label_key: ["env"],
      label_value: ["prod"],
      port_value: ["8080"],
      saashup_enabled: "false",
      template_url: "https://example.com",
    };
    const template = helpers.enrollmentTemplateFromData(data, {}, "prod", "owner@example.com");
    expect(template).toMatchObject({
      image: "saashup/tile:2.0",
      version: "2.0",
      creator_email: "owner@example.com",
      saashup_enabled: false,
      env: [{ key: "env", value: "prod" }],
      ports: [{ value: "8080" }],
    });

    const workflows = { "prod::templates": { steps: ["tile", { template: "other", enabled: false }] } };
    const updated = helpers.workflowsWithEnrollmentTemplate(workflows, "prod", "tile", template);
    expect(updated["prod::templates"].steps).toEqual([
      { template: "tile", template_data: expect.objectContaining({ image: "saashup/tile:2.0" }), enabled: true },
      { template: "other", enabled: false },
    ]);

    const fallback = helpers.enrollmentTemplateFromData({}, {
      config_profile: "existing-profile",
      instance: "existing",
      dns_name: "existing.example.com",
      image: "repo/existing",
      version: "1.0",
      max_instances: 2,
      registry_webhook_secret: "secret",
      template_url: "https://example.com/template",
      network: "traefik",
      log_driver: "json-file",
      log_driver_options: { max_size: "10m" },
      traefik: false,
      all_hosts: true,
      saashup_enabled: false,
      creator_email: "existing@example.com",
    }, "", "owner@example.com");
    expect(fallback).toMatchObject({
      config_profile: "existing-profile",
      instance: "existing",
      dns_name: "existing.example.com",
      image: "repo/existing",
      version: "1.0",
      max_instances: 2,
      registry_webhook_secret: "secret",
      template_url: "https://example.com/template",
      network: "traefik",
      log_driver: "json-file",
      log_driver_options: { max_size: "10m" },
      traefik: false,
      all_hosts: true,
      saashup_enabled: false,
      creator_email: "existing@example.com",
      env: [],
      labels: [],
      ports: [],
    });
  });
});

describe("api/order helpers", () => {
  function createOrder(overrides = {}) {
    const defaultDependencies = {
      authUserFromRequest: () => ({ email: "owner@example.com", user: "owner@example.com" }),
      containerEnvValue: () => "",
      hostIdQuery: async () => ({ host_id: "1" }),
      imagePartsFromContainer: () => ({ image: "repo/image", version: "v1.0" }),
      isContainerStopped: () => true,
      isReadyContainer: () => false,
      labelMapFromContainer: (container) => container.labels || {},
      logLine: () => {},
      maxInstancesValue: (value) => Number(value ?? 1),
      NetBoxClient: class {
        constructor() { this.list = async () => []; }
      },
      orderTemplateEnabled: (enabled) => Boolean(enabled),
      ownerEnvVarName: () => "OWNER",
      plainObject,
      selectedProfileConfig: () => ({ netbox: true, token: "token", tag: "tag" }),
      templateEntryForRequest: async () => null,
      templateLabelValue: (labels, key) => labels[key] || "",
      valueText: (value) => String(value || ""),
    };

    return createOrderHelpers({ ...defaultDependencies, ...overrides });
  }

  test("validateOrderTemplate rejects disabled templates", async () => {
    const helpers = createOrder({
      templateEntryForRequest: async () => ({ name: "disabled", template: { saashup_enabled: false } }),
      orderTemplateEnabled: () => false,
    });
    const res = mockResponse();
    const result = await helpers.validateOrderTemplate({ body: { order_template: "disabled" } }, res, "prod");
    expect(result).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("template_disabled");
  });

  test("validateOrderTemplate allows missing order_template values", async () => {
    const helpers = createOrder();
    const res = mockResponse();
    const result = await helpers.validateOrderTemplate({ body: {} }, res, "prod");
    expect(result).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  test("validateOrderTemplate allows missing template entries when an order template is not found", async () => {
    const helpers = createOrder({ templateEntryForRequest: async () => null });
    const res = mockResponse();
    const result = await helpers.validateOrderTemplate({ body: { order_template: "missing" } }, res, "prod");
    expect(result).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  test("currentUsage loads matching NetBox container instances and applies template filtering", async () => {
    const helpers = createOrder({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      hostIdQuery: async () => ({ host_id: 1 }),
      NetBoxClient: class {
        constructor() { this.list = async () => [
          { display: "demo", labels: { name: "demo", owner: "owner@example.com" } },
          { display: "other", labels: { name: "other", owner: "owner@example.com" } },
        ]; }
      },
      labelMapFromContainer: (container) => container.labels || {},
      templateLabelValue: (labels, key) => labels[key] || "",
      selectedProfileConfig: () => ({ netbox: true, token: "token", tag: "tag" }),
      templateEntryForRequest: async () => ({ template: { max_instances: 3 } }),
      isReadyContainer: () => true,
      isContainerStopped: () => false,
      imagePartsFromContainer: () => ({ image: "repo/image", version: "v1" }),
    });

    const usage = await helpers.currentUsage({ body: {}, query: { template: "demo" } }, "prod");
    expect(usage).toMatchObject({ profile: "prod", template: "demo", used: 1, max: 3, remaining: 2, reached: false });
    expect(usage.instances).toHaveLength(1);
  });

  test("currentUsage returns zero when NetBox is disabled or unavailable", async () => {
    const helpers = createOrder({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      selectedProfileConfig: () => ({}),
      templateEntryForRequest: async () => ({ template: { max_instances: 5 } }),
    });

    const usage = await helpers.currentUsage({ body: {}, query: {} }, "prod");
    expect(usage).toMatchObject({ profile: "prod", used: 0, max: 5, remaining: 5, reached: false });
  });

  test("orderInstancesForUser marks instances as creating when not ready or stopped", async () => {
    const helpers = createOrder({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      hostIdQuery: async () => ({ host_id: 1 }),
      NetBoxClient: class {
        constructor() { this.list = async () => [
          { id: "1", display: "demo", labels: { name: "demo", owner: "owner@example.com", template: "demo" } },
        ]; }
      },
      labelMapFromContainer: (container) => container.labels || {},
      templateLabelValue: (labels, key) => labels[key] || "",
      selectedProfileConfig: () => ({ netbox: true, token: "token", tag: "tag" }),
      isReadyContainer: () => false,
      isContainerStopped: () => false,
      imagePartsFromContainer: () => ({ image: "repo/image", version: "v1" }),
      valueText: (value) => String(value || ""),
    });

    const instances = await helpers.currentUsage({ body: {}, query: { template: "demo" } }, "prod");
    expect(instances.instances).toHaveLength(1);
    expect(instances.instances[0].status).toBe("creating");
  });

  test("orderInstancesForUser logs and returns empty when NetBox label discovery fails", async () => {
    const log = [];
    const helpers = createOrder({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      selectedProfileConfig: () => ({ netbox: true, token: "token", tag: "tag" }),
      hostIdQuery: async () => ({ host_id: 1 }),
      NetBoxClient: class {
        constructor() { this.list = async () => { throw new Error("boom"); }; }
      },
      labelMapFromContainer: () => ({}),
      templateLabelValue: () => "",
      ownerEnvVarName: () => "OWNER",
      isReadyContainer: () => false,
      isContainerStopped: () => false,
      imagePartsFromContainer: () => ({ image: "repo/image", version: "v1" }),
      logLine: (message) => log.push(message),
    });

    const instances = await helpers.currentUsage({ body: {}, query: {} }, "prod");
    expect(instances.instances).toEqual([]);
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("NetBox label discovery failed");
  });

  test("currentUsage returns zero for anonymous users and missing tagged hosts", async () => {
    const anonymous = createOrder({
      authUserFromRequest: () => ({}),
      templateEntryForRequest: async () => ({ template: { max_instances: 2 } }),
    });
    await expect(anonymous.currentUsage({ body: {}, query: {} }, "prod")).resolves.toMatchObject({
      used: 0,
      max: 2,
      instances: [],
    });

    const noHosts = createOrder({
      hostIdQuery: async () => ({ host_id: "__none__" }),
      templateEntryForRequest: async () => ({ template: { max_instances: 2 } }),
    });
    await expect(noHosts.currentUsage({ body: {}, query: {} }, "prod")).resolves.toMatchObject({
      used: 0,
      max: 2,
      instances: [],
    });
  });

  test("currentUsage can identify order containers through creator labels and env fallback", async () => {
    const helpers = createOrder({
      authUserFromRequest: () => ({ email: "owner@example.com" }),
      containerEnvValue: (container, key) => container.env?.[key] || "",
      hostIdQuery: async () => ({ host_id: 1 }),
      imagePartsFromContainer: () => ({ image: "repo/image", version: "v1" }),
      isReadyContainer: (container) => container.id === "ready",
      isContainerStopped: (container) => container.id === "failed",
      labelMapFromContainer: (container) => container.labels || {},
      NetBoxClient: class {
        constructor() {
          this.list = async () => [
            { id: "creating", display: "z.example.com", labels: { name: "demo", creator: "owner@example.com" } },
            { id: "ready", name: "a.example.com", labels: { name: "demo", owner_env_var: "APP_OWNER" }, env: { APP_OWNER: "owner@example.com" } },
            { id: "failed", name: "b.example.com", labels: { name: "other", owner: "owner@example.com" } },
          ];
        }
      },
      templateEntryForRequest: async () => ({ template: { max_instances: 5 } }),
      templateLabelValue: (labels, key) => labels[key] || "",
      valueText: (value) => String(value || ""),
    });

    const usage = await helpers.currentUsage({ body: {}, query: {} }, "prod");

    expect(usage.instances.map((item) => item.instance)).toEqual(["a.example.com", "b.example.com", "z.example.com"]);
    expect(usage.instances.map((item) => item.status)).toEqual(["ready", "failed", "creating"]);
    expect(usage.instances).toHaveLength(3);
  });

  test("currentUsage computes usage totals and respects template max instances", async () => {
    const helpers = createOrder({
      authUserFromRequest: () => ({ email: "buyer@example.com" }),
      hostIdQuery: async () => ({ host_id: "1" }),
      NetBoxClient: class {
        constructor() {
          this.list = async () => [
            { display: "demo.example.com", image_name: "repo/image", image_version: "v1", labels: { name: "demo", owner: "buyer@example.com" } },
          ];
        }
      },
      labelMapFromContainer: (container) => container.labels,
      templateLabelValue: (labels, key) => labels[key] || "",
      selectedProfileConfig: () => ({ netbox: true, token: "token", tag: "tag" }),
      templateEntryForRequest: async () => ({ template: { max_instances: 3 } }),
      isReadyContainer: () => true,
      isContainerStopped: () => false,
      valueText: (value) => String(value || ""),
      imagePartsFromContainer: () => ({ image: "repo/image", version: "v1" }),
    });

    const usage = await helpers.currentUsage({ body: {}, query: { template: "demo" } }, "prod");
    expect(usage).toMatchObject({
      profile: "prod",
      template: "demo",
      used: 1,
      max: 3,
      remaining: 2,
      reached: false,
    });
    expect(Array.isArray(usage.instances)).toBe(true);
  });
});
