const { createCreateHelpers } = require("../../api/create");

function createHelpers(overrides = {}) {
  const calls = {
    createdDns: [],
    delays: [],
    logs: [],
    operations: [],
    statusUpdates: [],
  };
  const defaultDependencies = {
    containerConfigPayloadFromForm: (data, id) => ({ id, env: [], labels: [], mounts: [] }),
    containerCreatePayloadFromForm: (data, imageId) => ({ name: data.instance || "demo", image: imageId }),
    createConfigureDelayMs: 0,
    createDnsRecord: async (_client, data, host) => {
      calls.createdDns.push({ data: { ...data }, host });
    },
    createRecreateDelayMs: 0,
    delay: async (ms) => {
      calls.delays.push(ms);
    },
    dockerHosts: async () => [{ id: "host-a", name: "host-a" }],
    ensureImageOnHost: async (_client, host) => ({ id: `image-${host.id}` }),
    hostName: (item) => item?.name || item?.display || item?.id || String(item || ""),
    logLine: (message) => calls.logs.push(message),
    NetBoxClient: class {
      async list(path, query) {
        if (path.includes("/containers/")) return [];
        if (path.includes("/volumes/")) return [];
        return [];
      }
      async request(method, path, options = {}) {
        if (method === "POST" && path.includes("/containers/")) {
          return { payload: { id: `container-${options.body.name}`, name: options.body.name, host: { name: "host-a" } } };
        }
        return { payload: {} };
      }
    },
    normalizedSaashupLabelConfig: (data) => data,
    requestContainerOperation: async (_client, container, operation, prefix) => {
      calls.operations.push({ container, operation, prefix });
      return true;
    },
    sendOrderReadyEmail: async () => ({}),
    templateNameFromEnrollmentData: (data) => data.template_name || data.instance || "",
    traefikEnabled: (data) => data.traefik !== false,
    updateEnrollmentInstanceStatus: async (_req, profile, template, status) => {
      calls.statusUpdates.push({ profile, template, status });
    },
    valueText: (value) => String(value || ""),
    volumePayloadsFromForm: () => [],
    waitForContainerConfigured: async () => true,
  };
  return { calls, helpers: createCreateHelpers({ ...defaultDependencies, ...overrides }) };
}

describe("api create helpers", () => {
  test("createInstance returns failed and marks enrollment failed when no hosts are available", async () => {
    const { calls, helpers } = createHelpers({
      dockerHosts: async () => [],
    });

    const result = await helpers.createInstance({}, { instance: "tile", tag: "" }, {
      isEnrollRequest: true,
      isOrderRequest: false,
      orderProfile: "prod",
      authUser: {},
    });

    expect(result).toBe(false);
    expect(calls.logs).toContain("CREATE : no Docker hosts found");
    expect(calls.statusUpdates).toEqual([{ profile: "prod", template: "tile", status: "failed" }]);
  });

  test("createInstance deploys to all hosts, skips DNS when Traefik is disabled, and reports partial readiness", async () => {
    const { calls, helpers } = createHelpers({
      dockerHosts: async () => [{ id: "host-a", name: "host-a" }, { id: "host-b", name: "host-b" }],
      ensureImageOnHost: async (_client, host) => ({ id: `image-${host.id}` }),
      requestContainerOperation: async (_client, container) => {
        calls.operations.push(container.id);
        return container.id.includes("host-a");
      },
      NetBoxClient: class {
        async list() {
          return [];
        }
        async request(method, path, options = {}) {
          if (method === "POST" && path.includes("/containers/")) {
            const hostId = options.body.image.replace("image-", "");
            return { payload: { id: `container-${hostId}`, name: options.body.name, host: { name: hostId } } };
          }
          return { payload: {} };
        }
      },
    });

    const result = await helpers.createInstance({}, { instance: "tile", all_hosts: "true", traefik: false }, {
      isEnrollRequest: true,
      isOrderRequest: false,
      orderProfile: "prod",
      authUser: {},
    });

    expect(result).toBe(false);
    expect(calls.createdDns).toEqual([]);
    expect(calls.logs).toContain("CREATE : host selection all_hosts=true hosts=2 selected=host-a,host-b");
    expect(calls.logs).toContain("CREATE : finished all hosts ready=1/2");
    expect(calls.statusUpdates).toEqual([{ profile: "prod", template: "tile", status: "failed" }]);
  });

  test("createInstance prepares reused volumes and logs ready email failures", async () => {
    const requestBodies = [];
    const { calls, helpers } = createHelpers({
      createConfigureDelayMs: 5,
      createRecreateDelayMs: 7,
      sendOrderReadyEmail: async () => {
        throw new Error("mail down");
      },
      volumePayloadsFromForm: () => [{ host: "host-a", name: "data" }, { host: "host-a", name: "cache" }],
      NetBoxClient: class {
        async list(path, query) {
          if (path.includes("/volumes/") && query.name === "data") return [{ id: "volume-data", name: "data", host: { id: "host-a" } }];
          if (path.includes("/volumes/")) return [];
          if (path.includes("/containers/")) return [];
          return [];
        }
        async request(method, path, options = {}) {
          requestBodies.push({ method, path, body: options.body });
          if (method === "POST" && path.includes("/containers/")) {
            return { payload: [{ id: "container-demo", name: options.body.name, host: { name: "host-a" } }] };
          }
          return { payload: {} };
        }
      },
    });

    const result = await helpers.createInstance({}, { instance: "tile", image: "repo/app", version: "1.0" }, {
      isEnrollRequest: false,
      isOrderRequest: true,
      orderProfile: "prod",
      authUser: { email: "owner@example.com" },
    });

    expect(result).toBe(true);
    expect(requestBodies).toContainEqual(expect.objectContaining({
      method: "POST",
      path: "/api/plugins/docker/volumes/",
      body: { host: "host-a", name: "cache" },
    }));
    expect(calls.delays).toEqual([5, 7]);
    expect(calls.logs).toContain("CREATE : 2 volumes prepared on host-a (1 reused, 1 created)");
    expect(calls.logs).toContain("EMAIL : ready notification failed for owner@example.com mail down");
  });

  test("createInstance matches hostless and mismatched Docker volumes before creating missing ones", async () => {
    const requestBodies = [];
    const { calls, helpers } = createHelpers({
      sendOrderReadyEmail: async () => {
        throw {};
      },
      volumePayloadsFromForm: () => [{ name: "shared" }, { host: "host-a", name: "data" }, { host: "host-a", name: "cache" }],
      NetBoxClient: class {
        async list(path, query) {
          if (path.includes("/volumes/") && query.name === "shared") return [{ id: "shared-volume", name: "shared", host: { id: "other-host" } }];
          if (path.includes("/volumes/") && query.name === "data") return [
            { id: "wrong-host-volume", name: "data", host: { id: "other-host" } },
          ];
          if (path.includes("/volumes/") && query.name === "cache") return [];
          if (path.includes("/containers/")) return [];
          return [];
        }
        async request(method, path, options = {}) {
          requestBodies.push({ method, path, body: options.body });
          if (method === "POST" && path.includes("/containers/")) {
            return { payload: { id: "container-demo", name: options.body.name, host: { name: "host-a" } } };
          }
          return { payload: {} };
        }
      },
    });

    await expect(helpers.createInstance({}, { instance: "tile" }, {
      isEnrollRequest: false,
      isOrderRequest: true,
      orderProfile: "prod",
      authUser: {},
    })).resolves.toBe(true);

    expect(requestBodies).toContainEqual(expect.objectContaining({
      method: "POST",
      path: "/api/plugins/docker/volumes/",
      body: [
        { host: "host-a", name: "data" },
        { host: "host-a", name: "cache" },
      ],
    }));
    expect(calls.logs).toContain("CREATE : 3 volumes prepared on host-a (1 reused, 2 created)");
    expect(calls.logs).toContain("EMAIL : ready notification failed for  smtp error");
  });

  test("createInstance treats malformed Docker volume records as missing", async () => {
    const requestBodies = [];
    const { helpers } = createHelpers({
      volumePayloadsFromForm: () => [{ host: "host-a", name: "" }],
      NetBoxClient: class {
        async list(path) {
          if (path.includes("/volumes/")) return [null];
          if (path.includes("/containers/")) return [];
          return [];
        }
        async request(method, path, options = {}) {
          requestBodies.push({ method, path, body: options.body });
          if (method === "POST" && path.includes("/containers/")) {
            return { payload: { id: "container-demo", name: options.body.name, host: { name: "host-a" } } };
          }
          return { payload: {} };
        }
      },
    });

    await expect(helpers.createInstance({}, { instance: "tile" }, {
      isEnrollRequest: false,
      isOrderRequest: false,
      orderProfile: "prod",
      authUser: {},
    })).resolves.toBe(true);

    expect(requestBodies).toContainEqual(expect.objectContaining({
      method: "POST",
      path: "/api/plugins/docker/volumes/",
      body: { host: "host-a", name: "" },
    }));
  });

  test("createInstance converts container log driver options to a list for NetBox patch", async () => {
    const requestBodies = [];
    const { helpers } = createHelpers({
      containerConfigPayloadFromForm: (data, id) => ({
        id,
        env: [],
        labels: [],
        mounts: [],
        log_driver: "syslog",
        log_driver_options: { "syslog-address": "udp://127.0.0.1:5514", tag: "{{.Name}}" },
      }),
      NetBoxClient: class {
        async list(path) {
          if (path.includes("/containers/")) return [];
          if (path.includes("/volumes/")) return [];
          return [];
        }
        async request(method, path, options = {}) {
          requestBodies.push({ method, path, body: options.body });
          if (method === "POST" && path.includes("/containers/")) {
            return { payload: { id: `container-${options.body.name}`, name: options.body.name, host: { name: "host-a" } } };
          }
          return { payload: {} };
        }
      },
      volumePayloadsFromForm: () => [],
    });

    await helpers.createInstance({}, { instance: "tile", image: "repo/app", version: "1.0" }, {
      isEnrollRequest: true,
      isOrderRequest: false,
      orderProfile: "prod",
      authUser: { email: "owner@example.com" },
    });

    const patch = requestBodies.find((item) => item.method === "PATCH" && item.path === "/api/plugins/docker/containers/");
    expect(patch?.body?.[0]?.log_driver_options).toEqual([
      { option_name: "syslog-address", value: "udp://127.0.0.1:5514" },
      { option_name: "tag", value: "{{.Name}}" },
    ]);
  });

  test("createInstance parses string log driver options and drops invalid values", async () => {
    const patchBodies = [];
    async function runWithLogOptions(logDriverOptions) {
      const { helpers } = createHelpers({
        containerConfigPayloadFromForm: (data, id) => ({
          id,
          env: [],
          labels: [],
          mounts: [],
          log_driver: "json-file",
          log_driver_options: logDriverOptions,
        }),
        NetBoxClient: class {
          async list(path) {
            if (path.includes("/containers/")) return [];
            if (path.includes("/volumes/")) return [];
            return [];
          }
          async request(method, path, options = {}) {
            if (method === "POST" && path.includes("/containers/")) {
              return { payload: { id: `container-${options.body.name}`, name: options.body.name, host: { name: "host-a" } } };
            }
            if (method === "PATCH" && path === "/api/plugins/docker/containers/") {
              patchBodies.push(options.body[0]);
            }
            return { payload: {} };
          }
        },
      });

      await helpers.createInstance({}, { instance: "tile" }, {
        isEnrollRequest: false,
        isOrderRequest: false,
        orderProfile: "prod",
        authUser: {},
      });
    }

    await runWithLogOptions('{"max-size":"10m","max-file":3}');
    await runWithLogOptions("{invalid-json");
    await runWithLogOptions(["mode=non-blocking"]);
    await runWithLogOptions(42);
    await runWithLogOptions({ "": "skip", missing: undefined, ok: "yes" });

    expect(patchBodies[0].log_driver_options).toEqual([
      { option_name: "max-size", value: "10m" },
      { option_name: "max-file", value: "3" },
    ]);
    expect(patchBodies[1]).not.toHaveProperty("log_driver_options");
    expect(patchBodies[2].log_driver_options).toEqual([{ option_name: "mode", value: "non-blocking" }]);
    expect(patchBodies[3]).not.toHaveProperty("log_driver_options");
    expect(patchBodies[4].log_driver_options).toEqual([{ option_name: "ok", value: "yes" }]);
  });

  test("createInstance skips volume creation when all requested volumes already exist", async () => {
    const requestBodies = [];
    const { calls, helpers } = createHelpers({
      volumePayloadsFromForm: () => [{ host: "host-a", name: "data" }],
      NetBoxClient: class {
        async list(path, query) {
          if (path.includes("/volumes/") && query.name === "data") return [{ id: "volume-data", name: "data", host: "host-a" }];
          if (path.includes("/containers/")) return [];
          return [];
        }
        async request(method, path, options = {}) {
          requestBodies.push({ method, path, body: options.body });
          if (method === "POST" && path.includes("/containers/")) {
            return { payload: { id: "container-demo", name: options.body.name, host: { name: "host-a" } } };
          }
          return { payload: {} };
        }
      },
    });

    await expect(helpers.createInstance({}, { instance: "tile" }, {
      isEnrollRequest: false,
      isOrderRequest: false,
      orderProfile: "prod",
      authUser: {},
    })).resolves.toBe(true);

    expect(requestBodies.some((call) => call.path === "/api/plugins/docker/volumes/")).toBe(false);
    expect(calls.logs).toContain("CREATE : 1 volume prepared on host-a (1 reused, 0 created)");
  });
});
