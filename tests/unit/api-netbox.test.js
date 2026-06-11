const { registerNetBoxRoutes } = require("../../api/netbox");

function mockResponse() {
  return {
    body: undefined,
    statusCode: 200,
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function createRoutes(overrides = {}) {
  const routes = {};
  const app = {
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
    checkRegistryImageExists: async () => ({ exists: true }),
    containerNetworkNames: () => [],
    hostIdQuery: async () => ({ host_id: 1 }),
    NetBoxClient: class {
      async list() {
        return [];
      }
    },
    publicApiGuard: (_req, _res, next) => next && next(),
    reportImages: (_req, res) => res.json({ images: [] }),
    requireAdmin: (_req, _res, next) => next && next(),
    selectedProfileConfig: (query) => query,
    testConnection: (_req, res) => res.json({ ok: true }),
  };

  registerNetBoxRoutes(app, { ...defaultDependencies, ...overrides });
  return routes;
}

describe("api netbox routes", () => {
  test("instances returns empty results when the configured host tag has no hosts", async () => {
    const routes = createRoutes({
      hostIdQuery: async () => ({ host_id: "__none__" }),
    });
    const res = mockResponse();

    await routes["GET /instances"]({ query: { tag: "missing" } }, res);

    expect(res.body).toEqual([]);
  });

  test("containers-count skips container lookup when no image matches", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const routes = createRoutes({
      NetBoxClient: class {
        constructor() {
          this.list = list;
        }
      },
    });
    const res = mockResponse();

    await routes["GET /containers-count"]({ query: { image: "repo/app", version: "1.0" } }, res);

    expect(res.body).toEqual({ count: 0 });
    expect(list).toHaveBeenCalledTimes(1);
  });

  test("registry check reports nested fetch failure causes", async () => {
    const routes = createRoutes({
      checkRegistryImageExists: async () => {
        throw Object.assign(new Error("fetch failed"), {
          cause: new Error("dns lookup failed"),
          statusCode: 503,
        });
      },
    });
    const res = mockResponse();

    await routes["GET /registry/lookup"]({ query: { image: "repo/app:1.0" } }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ detail: "registry check failed: dns lookup failed" });
  });

  test("public registry check reports upstream failures as unavailable images", async () => {
    const routes = createRoutes({
      checkRegistryImageExists: async () => {
        throw Object.assign(new Error("fetch failed"), {
          cause: new Error("dns lookup failed"),
          statusCode: 503,
        });
      },
    });
    const res = mockResponse();

    await routes["GET /registry/check"]({ query: { image: "link-society/flowg" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      image: "link-society/flowg",
      exists: false,
      status: 503,
      detail: "registry check failed: dns lookup failed",
    });
  });

  test("public registry check uses ref query fallback", async () => {
    const checkRegistryImageExists = vi.fn(async () => ({ image: "nginx:latest", exists: true }));
    const routes = createRoutes({ checkRegistryImageExists });
    const res = mockResponse();

    await routes["GET /registry/check"]({ query: { ref: "nginx" } }, res);

    expect(checkRegistryImageExists).toHaveBeenCalledWith("nginx");
    expect(res.body).toEqual({ image: "nginx:latest", exists: true });
  });

  test("public registry check returns client errors as HTTP errors", async () => {
    const routes = createRoutes({
      checkRegistryImageExists: async () => {
        throw Object.assign(new Error("unsupported registry host"), { statusCode: 400 });
      },
    });
    const res = mockResponse();

    await routes["GET /registry/check"]({ query: { image: "registry.example.com/app" } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ detail: "unsupported registry host" });
  });

  test("public registry check defaults client error status when statusCode is missing", async () => {
    const routes = createRoutes({
      checkRegistryImageExists: async () => {
        throw new Error("client blew up");
      },
    });
    const res = mockResponse();

    await routes["GET /registry/check"]({ query: { ref: "nginx" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      image: "nginx",
      exists: false,
      status: 502,
      detail: "client blew up",
    });
  });

  test("private registry lookup supports ref and empty query fallbacks", async () => {
    const checkRegistryImageExists = vi.fn(async (image) => ({ image, exists: true }));
    const routes = createRoutes({ checkRegistryImageExists });

    const refRes = mockResponse();
    await routes["GET /registry/lookup"]({ query: { ref: "nginx" } }, refRes);
    expect(refRes.body).toEqual({ image: "nginx", exists: true });

    const emptyRes = mockResponse();
    await routes["GET /registry/lookup"]({ query: {} }, emptyRes);
    expect(emptyRes.body).toEqual({ image: "", exists: true });
    expect(checkRegistryImageExists).toHaveBeenNthCalledWith(1, "nginx");
    expect(checkRegistryImageExists).toHaveBeenNthCalledWith(2, "");
  });

  test("private registry lookup defaults error status when statusCode is missing", async () => {
    const routes = createRoutes({
      checkRegistryImageExists: async () => {
        throw new Error("lookup exploded");
      },
    });
    const res = mockResponse();

    await routes["GET /registry/lookup"]({ query: { image: "repo/app" } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ detail: "lookup exploded" });
  });

  test("public registry check uses generic fallback for empty upstream errors", async () => {
    const routes = createRoutes({
      checkRegistryImageExists: async () => {
        throw {};
      },
    });
    const res = mockResponse();

    await routes["GET /registry/check"]({ query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      image: "",
      exists: false,
      status: 502,
      detail: "registry check failed",
    });
  });
});
