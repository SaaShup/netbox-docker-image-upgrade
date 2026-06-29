const { registerRegistryWebhookRoutes } = require("../../api/registry-webhooks");

function createRoute(overrides = {}) {
  let handler;
  const app = {
    post: vi.fn((paths, fn) => {
      handler = fn;
    }),
  };
  const deps = {
    logLine: vi.fn(),
    recreateContainers: vi.fn().mockResolvedValue(true),
    registryWebhookAllowed: vi.fn(() => true),
    registryWebhookEvents: vi.fn(() => [{ image: "saashup/tile", tag: "v2.0.0" }]),
    registryWebhookTemplates: vi.fn(() => []),
    imageNameFromRef: vi.fn((value) => String(value || "").split("@")[0].split(":")[0].toLowerCase()),
    sendImageUpgradeEmail: vi.fn().mockResolvedValue(undefined),
    sendOrderReadyEmail: vi.fn().mockResolvedValue(undefined),
    selectedProfileConfig: vi.fn(() => ({ smtp_config: "smtp.example.com:587" })),
    templatesForRequest: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  registerRegistryWebhookRoutes(app, deps);
  return { deps, handler };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function request(body = {}, profile = "prod") {
  return { body, params: { profile } };
}

describe("registry webhook route helper", () => {
  test("falls back to local webhook templates and order ready sender", async () => {
    const { deps, handler } = createRoute({
      templatesForRequest: undefined,
      sendImageUpgradeEmail: undefined,
      registryWebhookTemplates: vi.fn(() => [
        { name: "Tile", template: { image: "saashup/tile", dns_name: "tile.example.com", creator_email: "creator@example.com" } },
      ]),
    });
    const res = response();

    handler(request(), res);

    expect(res.statusCode).toBe(202);
    await vi.waitFor(() => expect(deps.sendOrderReadyEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "saashup/tile",
        from_version: "",
        to_version: "v2.0.0",
        version: "v2.0.0",
        instance: "tile.example.com",
      }),
      "creator@example.com",
    ));
    expect(deps.registryWebhookTemplates).toHaveBeenCalledWith("prod", "saashup/tile");
  });

  test("filters async templates and skips templates without recipients", async () => {
    const { deps, handler } = createRoute({
      templatesForRequest: vi.fn().mockResolvedValue({
        Empty: { image: "saashup/tile", creator_email: "" },
        ProfileAlias: { profile: "prod", image: "saashup/tile:v1.0.0", creator_email: "profile@example.com" },
        NamedFallback: { image: "saashup/tile", version: "v1.0.0", creator_email: "name@example.com" },
        OtherProfile: { config_profile: "dev", image: "saashup/tile", creator_email: "dev@example.com" },
        OtherImage: { image: "saashup/other", creator_email: "other@example.com" },
      }),
    });

    handler(request(), response());

    await vi.waitFor(() => expect(deps.sendImageUpgradeEmail).toHaveBeenCalledTimes(2));
    expect(deps.sendImageUpgradeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from_version: "",
        instance: "ProfileAlias",
      }),
      "profile@example.com",
    );
    expect(deps.sendImageUpgradeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from_version: "v1.0.0",
        instance: "NamedFallback",
      }),
      "name@example.com",
    );
  });

  test("handles empty profile and image fallbacks while filtering templates", async () => {
    const { deps, handler } = createRoute({
      registryWebhookEvents: vi.fn(() => [{ image: "", tag: "v2.0.0" }]),
      templatesForRequest: vi.fn().mockResolvedValue({
        EmptyImage: { creator_email: "empty@example.com" },
      }),
    });

    handler(request({}, ""), response());

    await vi.waitFor(() => expect(deps.sendImageUpgradeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "",
        instance: "EmptyImage",
      }),
      "empty@example.com",
    ));
    expect(deps.imageNameFromRef).toHaveBeenCalledWith("");
  });

  test("rejects invalid webhook secrets before starting async work", async () => {
    const { deps, handler } = createRoute({
      registryWebhookAllowed: vi.fn(() => false),
    });
    const res = response();

    handler(request(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ detail: "invalid webhook secret" });
    expect(deps.recreateContainers).not.toHaveBeenCalled();
    expect(deps.sendImageUpgradeEmail).not.toHaveBeenCalled();
  });

  test("logs default smtp error text when upgrade email rejection has no message", async () => {
    const { deps, handler } = createRoute({
      sendImageUpgradeEmail: vi.fn().mockRejectedValue({}),
      templatesForRequest: vi.fn().mockResolvedValue({
        Tile: { image: "saashup/tile", creator_email: "creator@example.com" },
      }),
    });

    handler(request(), response());

    await vi.waitFor(() => expect(deps.logLine).toHaveBeenCalledWith(
      "EMAIL : ready notification failed for creator@example.com smtp error",
    ));
  });

  test("does not notify when only latest tags arrive or recreate is not ready", async () => {
    const latest = createRoute({
      registryWebhookEvents: vi.fn(() => [{ image: "saashup/tile", tag: "latest" }]),
      templatesForRequest: vi.fn().mockResolvedValue({
        Tile: { image: "saashup/tile", creator_email: "creator@example.com" },
      }),
    });

    latest.handler(request(), response());
    await new Promise((resolve) => setImmediate(resolve));
    expect(latest.deps.recreateContainers).not.toHaveBeenCalled();
    expect(latest.deps.sendImageUpgradeEmail).not.toHaveBeenCalled();

    const notReady = createRoute({
      recreateContainers: vi.fn().mockResolvedValue(false),
      templatesForRequest: vi.fn().mockResolvedValue({
        Tile: { image: "saashup/tile", creator_email: "creator@example.com" },
      }),
    });

    notReady.handler(request(), response());
    await vi.waitFor(() => expect(notReady.deps.recreateContainers).toHaveBeenCalled());
    await new Promise((resolve) => setImmediate(resolve));
    expect(notReady.deps.sendImageUpgradeEmail).not.toHaveBeenCalled();
  });

  test("logs when the async registry webhook recreate flow fails", async () => {
    const { deps, handler } = createRoute({
      recreateContainers: vi.fn().mockRejectedValue(new Error("registry exploded")),
    });

    handler(request(), response());

    await vi.waitFor(() => expect(deps.logLine).toHaveBeenCalledWith("REGISTRY_WEBHOOK : failed registry exploded"));
  });
});
