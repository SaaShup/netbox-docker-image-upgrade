const configHelpers = require("../../api/config");

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {};
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

  test("templateEntryByName finds templates by exact and case-insensitive name", () => {
    const templates = { NGINX: { image: "nginx" }, redis: { image: "redis" } };
    expect(configHelpers.templateEntryByName(templates, "NGINX")).toEqual({ name: "NGINX", template: { image: "nginx" } });
    expect(configHelpers.templateEntryByName(templates, "nginx")).toEqual({ name: "NGINX", template: { image: "nginx" } });
    expect(configHelpers.templateEntryByName(templates, "none")).toBeNull();
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
    expect(configHelpers.workflowsWithoutTemplate(workflows, "", plainObject)).toEqual(workflows);
  });

  test("cleanStoredConfig falls back to the first profile when none is selected", () => {
    const config = { profiles: { alpha: { tag: "a" }, beta: { tag: "b" } } };
    const cleaned = configHelpers.cleanStoredConfig(config, (profiles) => profiles, (profiles) => profiles, plainObject);
    expect(cleaned.profile).toBe("alpha");
    expect(cleaned.config_profile).toBe("alpha");
  });
});
