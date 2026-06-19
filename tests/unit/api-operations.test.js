const { registerOperationRoutes } = require("../../api/operations");

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
  const logs = [];
  const asyncOperations = [];
  const app = {
    post(path, ...handlers) {
      routes[path] = handlers.at(-1);
    },
  };
  const defaultDependencies = {
    asyncOperation: (res, fn) => {
      res.status(202).json({ status: "requested" });
      const promise = fn();
      asyncOperations.push(promise);
      return promise;
    },
    authUserFromRequest: () => ({ email: "owner@example.com" }),
    bindPayloadsFromForm: () => [],
    canCreatePublicImage: () => true,
    currentEnrollmentUsage: async () => ({ reached: false }),
    currentUsage: async () => ({ reached: false }),
    deleteContainerVolumes: vi.fn(),
    deleteDnsRecord: vi.fn(),
    deleteVolumesEnabled: () => false,
    dockerHosts: async () => [],
    exactContainerNameMatches: (containers) => containers,
    hostIdQuery: async () => ({ host_id: 1 }),
    hostName: (item) => item?.host?.name || item?.host || "host",
    instanceShort: (value) => String(value || "").split(".")[0],
    isContainerRunning: () => false,
    logLine: (message) => logs.push(message),
    NetBoxClient: class {
      constructor() {
        this.list = async () => [];
        this.request = async () => ({ payload: {} });
      }
    },
    oidcAuth: { loginRequired: (_req, _res, next) => next() },
    recordEnrollment: vi.fn(),
    recreateContainers: vi.fn(),
    requestContainerOperation: vi.fn(),
    selectedProfileConfig: (body) => ({ ...body, tag: body.tag || "prod" }),
    updateEnrollmentInstanceStatus: vi.fn(),
    validateEnrollmentTemplate: async () => true,
    validateOrderTemplate: async () => true,
    valueText: (value) => String(value || ""),
    waitForContainerStopped: vi.fn(),
    waitForHostReady: vi.fn(),
    waitForRequest: (data) => data.wait === "true",
    createInstance: vi.fn().mockResolvedValue(true),
  };

  registerOperationRoutes(app, { ...defaultDependencies, ...overrides });
  return { asyncOperations, logs, routes };
}

test("create blocks public enrollment but allows orders when disabled for non-admin users", async () => {
  const { routes } = createRoutes({ canCreatePublicImage: () => false });

  const orderRes = mockResponse();
  await routes["/create"]({ body: { order_request: "true" } }, orderRes);
  expect(orderRes.statusCode).toBe(202);
  expect(orderRes.body).toEqual({ status: "requested" });

  const enrollRes = mockResponse();
  await routes["/create"]({ body: { enroll_request: "true" } }, enrollRes);
  expect(enrollRes.statusCode).toBe(403);
  expect(enrollRes.body).toEqual({
    code: "public_image_disabled",
    detail: "Only administrators can create or enroll images.",
  });
});

describe("api operation routes", () => {
  test("restart logs when no Docker hosts match the selected tag", async () => {
    const { asyncOperations, logs, routes } = createRoutes({
      hostIdQuery: async () => ({ host_id: "__none__" }),
    });
    const res = mockResponse();

    routes["/restart"]({ body: { tag: "missing" } }, res);
    await asyncOperations.at(-1);

    expect(res.statusCode).toBe(202);
    expect(logs).toContain("RESTART : no Docker hosts found with tag missing");
  });

  test("restart defaults invalid actions and restarts containers by image", async () => {
    const requestContainerOperation = vi.fn();
    class NetBoxClient {
      async list(path, query) {
        if (path.includes("/images/")) return [{ id: "image-1" }, { id: "image-2" }];
        if (query.image_id === "image-1") return [{ id: "container-1" }];
        return [{ id: "container-2" }];
      }
    }
    const { asyncOperations, logs, routes } = createRoutes({
      NetBoxClient,
      requestContainerOperation,
    });

    routes["/restart"]({ body: { image: "repo/app", restart_version: "1.0", operate_action: "bounce" } }, mockResponse());
    await asyncOperations.at(-1);

    expect(requestContainerOperation).toHaveBeenCalledTimes(2);
    expect(requestContainerOperation.mock.calls.map((call) => call[2])).toEqual(["restart", "restart"]);
    expect(logs).toContain("RESTART : finished restart loop");
  });

  test("create wait mode marks enrollments failed when create fails", async () => {
    const updateEnrollmentInstanceStatus = vi.fn();
    const error = Object.assign(new Error("create failed"), { statusCode: 503, payload: { id: "bad" } });
    const { routes } = createRoutes({
      createInstance: vi.fn().mockRejectedValue(error),
      updateEnrollmentInstanceStatus,
    });
    const res = mockResponse();

    await routes["/create"]({ body: { wait: "true", enroll_request: "true", template_name: "tile", profile: "prod" } }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ detail: "create failed", payload: { id: "bad" } });
    expect(updateEnrollmentInstanceStatus).toHaveBeenCalledWith(expect.any(Object), "prod", "tile", "failed");
  });

  test("create returns singular max instance and enrollment limit messages", async () => {
    const orderRoutes = createRoutes({
      currentUsage: async () => ({ reached: true, max: 1, used: 1 }),
    }).routes;
    const orderRes = mockResponse();
    await orderRoutes["/create"]({ body: { order_request: "true" } }, orderRes);
    expect(orderRes.statusCode).toBe(429);
    expect(orderRes.body).toMatchObject({
      code: "max_instances_reached",
      detail: "You have reached your maximum of 1 instance for this config.",
      requester_email: "owner@example.com",
    });

    const enrollRoutes = createRoutes({
      currentEnrollmentUsage: async () => ({ reached: true, max: 1, used: 1 }),
    }).routes;
    const enrollRes = mockResponse();
    await enrollRoutes["/create"]({ body: { enroll_request: "true" } }, enrollRes);
    expect(enrollRes.statusCode).toBe(429);
    expect(enrollRes.body).toMatchObject({
      code: "enrollment_limit_reached",
      detail: "You have reached your maximum of 1 enrolled image for this config.",
    });
  });

  test("create returns plural max instance and enrollment limit messages", async () => {
    const orderRoutes = createRoutes({
      currentUsage: async () => ({ reached: true, max: 2, used: 2 }),
    }).routes;
    const orderRes = mockResponse();
    await orderRoutes["/create"]({ body: { order_request: "true" } }, orderRes);
    expect(orderRes.statusCode).toBe(429);
    expect(orderRes.body).toMatchObject({
      code: "max_instances_reached",
      detail: "You have reached your maximum of 2 instances for this config.",
      requester_email: "owner@example.com",
    });

    const enrollRoutes = createRoutes({
      currentEnrollmentUsage: async () => ({ reached: true, max: 2, used: 2 }),
    }).routes;
    const enrollRes = mockResponse();
    await enrollRoutes["/create"]({ body: { enroll_request: "true" } }, enrollRes);
    expect(enrollRes.statusCode).toBe(429);
    expect(enrollRes.body).toMatchObject({
      code: "enrollment_limit_reached",
      detail: "You have reached your maximum of 2 enrolled images for this config.",
    });
  });

  test("create wait mode uses fallback error details when an operation throws a non-error", async () => {
    const { routes } = createRoutes({
      createInstance: vi.fn().mockRejectedValue({ payload: { id: "opaque" } }),
    });
    const res = mockResponse();

    await routes["/create"]({ body: { wait: "true" } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ detail: "operation failed", payload: { id: "opaque" } });
  });

  test("async create failures mark enrolled templates failed before bubbling", async () => {
    const updateEnrollmentInstanceStatus = vi.fn();
    const { asyncOperations, routes } = createRoutes({
      createInstance: vi.fn().mockRejectedValue(new Error("async create failed")),
      updateEnrollmentInstanceStatus,
    });
    const res = mockResponse();

    await routes["/create"]({ body: { enroll_request: "true", template_name: "tile", profile: "prod" } }, res);
    await expect(asyncOperations.at(-1)).rejects.toThrow("async create failed");

    expect(res.statusCode).toBe(202);
    expect(updateEnrollmentInstanceStatus).toHaveBeenCalledWith(expect.any(Object), "prod", "tile", "failed");
  });

  test("create failures use order template and instance fallbacks when marking enrollments failed", async () => {
    const waitUpdateEnrollmentInstanceStatus = vi.fn();
    const waitRoutes = createRoutes({
      createInstance: vi.fn().mockRejectedValue(new Error("wait failed")),
      updateEnrollmentInstanceStatus: waitUpdateEnrollmentInstanceStatus,
    }).routes;
    await waitRoutes["/create"]({ body: { wait: "true", enroll_request: "true", order_template: "order-template", profile: "prod" } }, mockResponse());
    expect(waitUpdateEnrollmentInstanceStatus).toHaveBeenCalledWith(expect.any(Object), "prod", "order-template", "failed");

    const waitInstanceUpdateEnrollmentInstanceStatus = vi.fn();
    const waitInstanceRoutes = createRoutes({
      createInstance: vi.fn().mockRejectedValue(new Error("wait failed")),
      updateEnrollmentInstanceStatus: waitInstanceUpdateEnrollmentInstanceStatus,
    }).routes;
    await waitInstanceRoutes["/create"]({ body: { wait: "true", enroll_request: "true", instance: "instance-template", profile: "prod" } }, mockResponse());
    expect(waitInstanceUpdateEnrollmentInstanceStatus).toHaveBeenCalledWith(expect.any(Object), "prod", "instance-template", "failed");

    const asyncUpdateEnrollmentInstanceStatus = vi.fn();
    const { asyncOperations, routes } = createRoutes({
      createInstance: vi.fn().mockRejectedValue(new Error("async failed")),
      updateEnrollmentInstanceStatus: asyncUpdateEnrollmentInstanceStatus,
    });
    await routes["/create"]({ body: { enroll_request: "true", instance: "instance-template", profile: "prod" } }, mockResponse());
    await expect(asyncOperations.at(-1)).rejects.toThrow("async failed");
    expect(asyncUpdateEnrollmentInstanceStatus).toHaveBeenCalledWith(expect.any(Object), "prod", "instance-template", "failed");
  });

  test("create reports enrollment catalog sync failures before creating instances", async () => {
    const createInstance = vi.fn();
    const { routes } = createRoutes({
      createInstance,
      recordEnrollment: vi.fn().mockRejectedValue(new Error("sync failed")),
    });
    const res = mockResponse();

    await routes["/create"]({ body: { enroll_request: "true", image: "repo/app", version: "1.0" } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ code: "template_catalog_sync_failed", detail: "sync failed" });
    expect(createInstance).not.toHaveBeenCalled();
  });

  test("create reports fallback enrollment catalog sync failures", async () => {
    const createInstance = vi.fn();
    const { routes } = createRoutes({
      createInstance,
      recordEnrollment: vi.fn().mockRejectedValue({}),
    });
    const res = mockResponse();

    await routes["/create"]({ body: { enroll_request: "true", image: "repo/app", version: "1.0" } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ code: "template_catalog_sync_failed", detail: "Image catalog sync failed." });
    expect(createInstance).not.toHaveBeenCalled();
  });

  test("delete wait mode reports operation errors", async () => {
    class NetBoxClient {
      async list() {
        return [{ id: "container-1", name: "demo" }];
      }
      async request() {
        throw Object.assign(new Error("delete failed"), { statusCode: 504, payload: { id: "container-1" } });
      }
    }
    const { logs, routes } = createRoutes({
      NetBoxClient,
      exactContainerNameMatches: (containers) => containers,
      waitForRequest: () => true,
    });
    const res = mockResponse();

    await routes["/delete"]({ body: { instance: "demo.example.com", wait: "true" } }, res);

    expect(res.statusCode).toBe(504);
    expect(res.body).toMatchObject({ detail: "delete failed", payload: { id: "container-1" } });
    expect(logs[0]).toContain("ERROR : delete failed");
  });

  test("delete wait mode uses fallback details for opaque operation errors", async () => {
    class NetBoxClient {
      async list() {
        return [{ id: "container-1", name: "demo" }];
      }
      async request() {
        throw { payload: { id: "container-1" } };
      }
    }
    const { routes } = createRoutes({
      NetBoxClient,
      exactContainerNameMatches: (containers) => containers,
      waitForRequest: () => true,
    });
    const res = mockResponse();

    await routes["/delete"]({ body: { instance: "demo.example.com", wait: "true" } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ detail: "operation failed", payload: { id: "container-1" } });
  });

  test("delete by image logs when no exact image records match", async () => {
    class NetBoxClient {
      async list() {
        return [{ id: "image-1", name: "repo/other", version: "1.0" }];
      }
    }
    const { logs, routes } = createRoutes({
      NetBoxClient,
      waitForRequest: () => true,
    });

    await routes["/delete"]({ body: { delete_mode: "image", image: "repo/app", wait: "true" } }, mockResponse());

    expect(logs).toContain("DELETE : cannot delete image repo/app, expected at least 1 image got 0");
  });

  test("delete by image logs empty requested image values", async () => {
    class NetBoxClient {
      async list() {
        return [];
      }
    }
    const { logs, routes } = createRoutes({
      NetBoxClient,
      waitForRequest: () => true,
    });

    await routes["/delete"]({ body: { delete_mode: "image", wait: "true" } }, mockResponse());

    expect(logs).toContain("DELETE : cannot delete image , expected at least 1 image got 0");
  });

  test("delete by image logs when matching images have no containers", async () => {
    class NetBoxClient {
      async list(path) {
        if (path.includes("/images/")) return [{ id: "image-1", name: "repo/app", version: "1.0" }];
        return [];
      }
    }
    const { logs, routes } = createRoutes({
      NetBoxClient,
      waitForRequest: () => true,
    });

    await routes["/delete"]({ body: { delete_mode: "image", image: "repo/app", wait: "true" } }, mockResponse());

    expect(logs).toContain("DELETE : no containers found for image repo/app");
  });

  test("delete by image logs singular container deletion counts", async () => {
    class NetBoxClient {
      async list(path) {
        if (path.includes("/images/")) return [{ id: "image-1", name: "repo/app", version: "1.0" }];
        return [{ id: "container-1", name: "demo", host: "host-a" }];
      }
      async request() {
        return { payload: {} };
      }
    }
    const { logs, routes } = createRoutes({
      NetBoxClient,
      deleteDnsRecord: vi.fn(),
      waitForRequest: () => true,
    });

    await routes["/delete"]({ body: { delete_mode: "image", image: "repo/app", wait: "true" } }, mockResponse());

    expect(logs).toContain("DELETE : container demo deleted id=container-1");
    expect(logs).toContain("DELETE : 1 container deleted for image repo/app");
  });

  test("delete by image matches tagged refs and logs image fallback names", async () => {
    class NetBoxClient {
      async list(path, query) {
        if (path.includes("/images/")) return [{ id: "image-1", display: "repo/app:1.0" }];
        if (query.image_id === "image-1") return [
          { id: "container-1", name: "demo-1", host: "host-a" },
          { id: "container-2", name: "demo-2", host: "host-a" },
        ];
        return [];
      }
      async request() {
        return { payload: {} };
      }
    }
    const { logs, routes } = createRoutes({
      NetBoxClient,
      deleteDnsRecord: vi.fn(),
      valueText: (value) => String(value || ""),
      waitForRequest: () => true,
    });

    await routes["/delete"]({ body: { delete_mode: "image", image: "repo/app:1.0", remove_image: "on", wait: "true" } }, mockResponse());

    expect(logs).toContain("DELETE : 2 containers deleted for image repo/app:1.0");
    expect(logs).toContain("DELETE : image repo/app:1.0: deleted id=image-1");
  });
});
