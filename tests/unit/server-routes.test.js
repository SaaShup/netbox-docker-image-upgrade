const fs = require("fs");
const os = require("os");
const path = require("path");
const supertest = require("supertest");
const packageJson = require("../../package.json");

function jsonResponse(payload, status = 200) {
  return {
    status,
    text: async () => JSON.stringify(payload),
  };
}

async function loadServer({
  adminEmails = "",
  configureDelayMs = "0",
  operationTimeoutSeconds = "1",
  recreateDelayMs = "0",
} = {}) {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "saashup-test-"));
  process.env.DATAPATH = dataPath;
  process.env.APPPATH = path.resolve(__dirname, "../..");
  process.env.ENABLE_EDITOR = "1";
  process.env.OPERATION_TIMEOUT_SECONDS = operationTimeoutSeconds;
  process.env.OPERATION_POLL_MS = "10";
  process.env.CREATE_CONFIGURE_DELAY_MS = configureDelayMs;
  process.env.CREATE_RECREATE_DELAY_MS = recreateDelayMs;
  if (adminEmails) process.env.ADMIN_ALLOWED_EMAILS = adminEmails;
  else delete process.env.ADMIN_ALLOWED_EMAILS;

  const fetchMock = vi.fn();
  delete require.cache[require.resolve("../../server")];
  const server = require("../../server");
  server.setNetBoxFetchForTests(fetchMock);
  return {
    ...server,
    dataPath,
    fetchMock,
    request: supertest(server.app),
  };
}

function writeState(dataPath, state) {
  fs.writeFileSync(path.join(dataPath, "app-state.json"), JSON.stringify(state, null, 2));
}

function readState(dataPath) {
  return JSON.parse(fs.readFileSync(path.join(dataPath, "app-state.json"), "utf8"));
}

function setupNetBoxFetch(fetchMock, {
  containerPostArray = false,
  containerHostAsId = false,
  deleteContainerRunning = false,
  emptyContainersForName = "",
  emptyImagesForName = "",
  omitContainerDisplay = false,
  omitContainerName = false,
  recreateContainerName = "tiles",
} = {}) {
  let deleteContainerGetCount = 0;
  let stopRequested = false;
  fetchMock.mockImplementation(async (url, options = {}) => {
    const parsed = new URL(String(url));
    const method = options.method || "GET";
    const pathname = parsed.pathname;

    if (pathname === "/api/status/") return jsonResponse({ status: "ok" });

    if (pathname === "/api/plugins/cloudflare/dns/accounts/" && method === "GET") {
      return jsonResponse({ count: 1, results: [{ id: 51, name: parsed.searchParams.get("name") }] });
    }

    if (pathname === "/api/plugins/cloudflare/dns/records/" && method === "GET") {
      return jsonResponse({ count: 1, results: [{ id: 61, name: parsed.searchParams.get("name") }] });
    }

    if (pathname === "/api/plugins/cloudflare/dns/records/" && method === "POST") {
      return jsonResponse({ id: 61, ...JSON.parse(options.body) }, 201);
    }

    if (pathname === "/api/plugins/cloudflare/dns/records/61/" && method === "DELETE") {
      return jsonResponse({}, 204);
    }

    if (pathname === "/api/plugins/docker/hosts/" && method === "GET") {
      return jsonResponse({
        results: [
          { id: 1, name: "host-a", tags: [{ slug: "tile" }] },
          { id: 2, name: "host-b", tags: [{ slug: "guide" }] },
        ],
      });
    }

    if (pathname === "/api/plugins/docker/images/" && method === "GET") {
      if (parsed.searchParams.get("name") === emptyImagesForName) return jsonResponse({ results: [] });
      const version = parsed.searchParams.get("version");
      const hostId = parsed.searchParams.get("host_id");
      if (version === "v2.0.0") return jsonResponse({ results: [{ id: 20, name: "saashup/tile", version, host: { id: Number(hostId || 1) } }] });
      if (version === "v3.0.0") return jsonResponse({});
      return jsonResponse({ results: [{ id: 10, name: "saashup/tile", version: "v1.0.0", host: { id: Number(hostId || 1), display: "host-a" } }] });
    }

    if (pathname === "/api/plugins/docker/images/" && method === "POST") {
      const body = JSON.parse(options.body);
      return jsonResponse({ id: 20, ...body }, 201);
    }

    if (pathname === "/api/plugins/docker/volumes/" && method === "POST") {
      return jsonResponse(JSON.parse(options.body), 201);
    }

    if (pathname === "/api/plugins/docker/containers/" && method === "GET") {
      if (parsed.searchParams.get("limit") === "1") return jsonResponse({ results: [{ id: 30 }] });
      if (parsed.searchParams.get("name") === emptyContainersForName) return jsonResponse({ results: [] });
      return jsonResponse({
        results: [
          {
            id: 30,
            ...(omitContainerName ? {} : { name: recreateContainerName }),
            ...(omitContainerDisplay ? {} : { display: recreateContainerName }),
            host: containerHostAsId ? 1 : { id: 1, display: "host-a" },
            image: { id: 10 },
            state: deleteContainerRunning ? "running" : "created",
            status: deleteContainerRunning ? "running" : "created",
            network_settings: [{ network: { name: "bridge" } }, { network: { name: "traefik-public" } }],
          },
        ],
      });
    }

    if (pathname === "/api/plugins/docker/containers/" && method === "POST") {
      const body = JSON.parse(options.body);
      const container = { id: 31, name: body.name, host: { id: body.host, display: "host-a" }, status: "running", operation: "none" };
      return jsonResponse(containerPostArray ? [container] : container, 201);
    }

    if (pathname === "/api/plugins/docker/containers/" && method === "PATCH") {
      const body = JSON.parse(options.body);
      if (Array.isArray(body) && body.some((item) => item.operation === "stop")) stopRequested = true;
      if (Array.isArray(body) && body.some((item) => item.id === 31 && item.operation)) {
        expect(body.some((item) => item.operation === "create")).toBe(false);
        expect(body.some((item) => item.operation === "recreate")).toBe(true);
      }
      if (Array.isArray(body) && body.some((item) => item.id === 31 && !item.operation)) {
        const config = body.find((item) => item.id === 31);
        expect(config.env).toEqual(expect.arrayContaining([{ var_name: "APP_ENV", value: "production" }]));
        expect(config.labels).toEqual(expect.arrayContaining([
          { key: "traefik.http.middlewares.force-https-header.headers.customrequestheaders.X-Forwarded-Proto", value: "https" },
          { key: "custom.label", value: "custom-value" },
        ]));
        expect(config.labels.some((label) => label.key.endsWith(".middlewares") && label.value === "force-https-header")).toBe(true);
        expect(config.labels.some((label) => label.key.endsWith(".ipallowlist.sourcerange") && label.value.includes("173.245.48.0/20"))).toBe(true);
      }
      return jsonResponse({});
    }
    if (pathname === "/api/plugins/docker/containers/31/" && method === "GET") return jsonResponse({ id: 31, status: "running", operation: "none" });
    if (pathname === "/api/plugins/docker/containers/30/" && method === "GET") {
      if (!stopRequested) return jsonResponse({ id: 30, state: "running", status: "running", operation: "none" });
      deleteContainerGetCount += 1;
      if (deleteContainerRunning && deleteContainerGetCount === 1) return jsonResponse({ id: 30, state: "running", status: "running", operation: "stop" });
      return jsonResponse({ id: 30, state: "exited", status: "exited", operation: "none" });
    }
    if (pathname === "/api/plugins/docker/containers/30/" && method === "DELETE") return jsonResponse({}, 204);
    if (pathname === "/api/plugins/docker/hosts/1/" && method === "PATCH") return jsonResponse({});
    if (pathname === "/api/plugins/docker/hosts/1/" && method === "GET") return jsonResponse({ id: 1, operation: "none", state: "active" });

    return jsonResponse({ detail: `${method} ${pathname}` }, 404);
  });
}

function rejectNextMatchingNetBoxFetch(fetchMock, predicate, error) {
  const previousImplementation = fetchMock.getMockImplementation();
  let rejected = false;
  fetchMock.mockImplementation(async (url, options = {}) => {
    if (!rejected && predicate(new URL(String(url)), options)) {
      rejected = true;
      throw error;
    }
    return previousImplementation(url, options);
  });
}

describe("server routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DATAPATH;
    delete process.env.APPPATH;
    delete process.env.ADMIN_ALLOWED_EMAILS;
    delete process.env.ENABLE_EDITOR;
    delete process.env.OPERATION_TIMEOUT_SECONDS;
    delete process.env.OPERATION_POLL_MS;
    delete process.env.CREATE_CONFIGURE_DELAY_MS;
    delete process.env.CREATE_RECREATE_DELAY_MS;
  });

  test("serves version, user session, metrics, and protected admin pages", async () => {
    const { request } = await loadServer({ adminEmails: "allowed@example.com" });

    await request.get("/version").expect(200).expect((res) => {
      expect(res.body).toMatchObject({ name: packageJson.name, version: packageJson.version });
    });
    await request.get("/session/user").set("x-auth-request-email", "allowed@example.com").expect(200).expect((res) => {
      expect(res.body.email).toBe("allowed@example.com");
    });
    await request.get("/admin").set("x-auth-request-email", "denied@example.com").expect(403);
    await request.get("/admin").set("x-auth-request-email", "allowed@example.com").expect(200);
    await request.get("/metrics").expect(200).expect((res) => {
      expect(res.text).toContain("saashup_app_info");
      expect(res.text).toContain('route="/admin"');
    });
  });

  test("persists config, templates, logs, and portable exports", async () => {
    const { dataPath, request } = await loadServer();

    await request.get("/config").expect(200);
    writeState(dataPath, { config: null, templates: null, order_counts: {}, logs: "" });
    await request.get("/config").expect(200).expect((res) => {
      expect(res.body).toEqual({});
    });
    await request.get("/templates").expect(200).expect((res) => {
      expect(res.body).toEqual({});
    });

    await request.get("/webhook").expect(200).expect((res) => {
      expect(res.body).toMatchObject({ netbox: "", token: "", domain: "", tag: "", profile: "", config_profile: "" });
    });

    await request.get("/webhook")
      .query({
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "tile",
        max_instances: "3",
        profile: "prod",
        profiles: JSON.stringify({ prod: { tag: "tile" } }),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.max_instances).toBe(3);
      });

    await request.get("/config").expect(200).expect((res) => {
      expect(res.body.profile).toBe("prod");
    });
    await request.post("/templates").send({ tile: { image: "saashup/tile" } }).expect(200);
    await request.get("/templates").expect(200).expect((res) => {
      expect(res.body.tile.image).toBe("saashup/tile");
    });
    await request.get("/portable-config").expect(200).expect((res) => {
      expect(res.body.config.profiles.prod.tag).toBe("tile");
      expect(res.body.templates.tile.image).toBe("saashup/tile");
    });
    await request.post("/portable-config").send({
      config: { profiles: { dev: { tag: "guide" } } },
      templates: { guide: { image: "saashup/guide" } },
      order_counts: { "user@example.com": { dev: 1 } },
    }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "imported", profiles: 1, templates: 1 });
    });
    await request.post("/portable-config").send({
      config: {
        profile: "prod",
        config_profile: "prod",
        profiles: { prod: { tag: "tile" } },
      },
      templates: {},
      order_counts: {},
    }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "imported", profiles: 1, templates: 0 });
    });
    await request.post("/portable-config").send({
      config: { profile: "solo" },
      templates: {},
      order_counts: {},
    }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "imported", profiles: 0, templates: 0 });
    });
    await request.delete("/logs").expect(200);
    await request.get("/logs").expect(200).expect((res) => {
      expect(res.text).toContain("&nbsp;<br>");
    });
    await request.delete("/config").expect(200);
    expect(readState(dataPath).config).toEqual({});
  });

  test("calls NetBox for read endpoints", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { emptyImagesForName: "saashup/missing" });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3 },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.get("/test").expect(200).expect((res) => {
      expect(res.body.status).toBe("ok");
    });
    await request.post("/test").send({
      netbox: "https://netbox.example.com",
      token: "secret",
    }).expect(200).expect((res) => {
      expect(res.body.status).toBe("ok");
    });
    await request.get("/instances").expect(200).expect((res) => {
      expect(res.body[0].instance).toBe("tiles");
      expect(res.body[0].networks).toContain("traefik-public");
    });
    setupNetBoxFetch(fetchMock, { emptyImagesForName: "saashup/missing", omitContainerDisplay: true });
    await request.get("/instances").expect(200).expect((res) => {
      expect(res.body[0].instance).toBe("tiles");
    });
    await request.get("/images").expect(200).expect((res) => {
      expect(res.body[0].name).toBe("saashup/tile");
    });
    await request.get("/containers-count").query({ image: "saashup/tile", version: "v2.0.0" }).expect(200).expect((res) => {
      expect(res.body.count).toBe(1);
    });
    await request.get("/containers-count").query({ image: "saashup/missing", version: "v2.0.0" }).expect(200).expect((res) => {
      expect(res.body.count).toBe(0);
    });
    await request.get("/report/images").query({ profile: "all" }).expect(200).expect((res) => {
      expect(res.body.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          image: "saashup/tile",
          version: "v1.0.0",
          containers: 1,
        }),
      ]));
      expect(res.body.total_hosts).toBe(1);
      expect(res.body.total_containers).toBeGreaterThanOrEqual(1);
    });
  });

  test("returns NetBox read errors and empty-list fallbacks", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3 },
      templates: {},
      order_counts: {},
      logs: "",
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "bad token" }, 403));
    await request.get("/test").expect(403).expect((res) => {
      expect(res.body.detail).toBe("NetBox request failed 403");
      expect(res.body.payload.detail).toBe("bad token");
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await request.get("/instances").expect(200).expect((res) => {
      expect(res.body).toEqual([]);
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await request.get("/images").expect(200).expect((res) => {
      expect(res.body).toEqual([]);
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await request.get("/containers-count").expect(200).expect((res) => {
      expect(res.body.count).toBe(0);
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await request.get("/images").query({ tag: "" }).expect(200).expect((res) => {
      expect(res.body).toEqual([]);
    });

    fetchMock.mockRejectedValueOnce(new Error("instances failed"));
    await request.get("/instances").query({ tag: "" }).expect(502).expect((res) => {
      expect(res.body.detail).toBe("instances failed");
    });

    fetchMock.mockRejectedValueOnce(new Error("images failed"));
    await request.get("/images").query({ tag: "" }).expect(502).expect((res) => {
      expect(res.body.detail).toBe("images failed");
    });

    fetchMock.mockRejectedValueOnce(new Error("count failed"));
    await request.get("/containers-count").query({ tag: "" }).expect(502).expect((res) => {
      expect(res.body.detail).toBe("count failed");
    });

    fetchMock.mockRejectedValueOnce(new Error("test failed"));
    await request.get("/test").expect(502).expect((res) => {
      expect(res.body.detail).toBe("test failed");
    });
  });

  test("enforces order limits before create", async () => {
    const { dataPath, request } = await loadServer();
    writeState(dataPath, {
      config: { max_instances: 1, profile: "prod", config_profile: "prod" },
      templates: {},
      order_counts: { "buyer@example.com": { prod: 1 } },
      logs: "",
    });

    await request.get("/order/limit").set("x-auth-request-email", "buyer@example.com").query({ profile: "prod" }).expect(200).expect((res) => {
      expect(res.body.reached).toBe(true);
    });
    await request.get("/order/limit").expect(200).expect((res) => {
      expect(res.body.profile).toBe("");
    });
    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ order_request: "true", profile: "prod" })
      .expect(429)
      .expect((res) => {
        expect(res.body.code).toBe("max_instances_reached");
      });

    writeState(dataPath, {
      config: { max_instances: 2, profile: "prod", config_profile: "prod" },
      templates: {},
      order_counts: { "buyer@example.com": { prod: 2 } },
      logs: "",
    });
    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ order_request: "true", profile: "prod" })
      .expect(429)
      .expect((res) => {
        expect(res.body.detail).toContain("maximum of 2 instances");
      });
  });

  test("accepts write operations and records logs", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3 },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "tiles.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      volume_source: ["/app/data", "/app/cache"],
      volume_name: ["tiles-data", "tiles-cache"],
      order_request: "true",
      profile: "prod",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE :"));
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : 2 volumes prepared on host-a"));
    await vi.waitFor(() => expect(Object.values(readState(dataPath).order_counts).some((counts) => counts.prod === 1)).toBe(true));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/cloudflare/dns/records/") && options?.method === "POST" && JSON.parse(options.body).content === "host-a.example.com")).toBe(true);
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/") && options?.method === "POST" && JSON.parse(options.body).length === 2)).toBe(true);

    await request.post("/create").send({
      instance: "tiles-second.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      order_request: "true",
      profile: "",
      config_profile: "prod",
    }).expect(202);
    await vi.waitFor(() => expect(Object.values(readState(dataPath).order_counts).some((counts) => counts.prod === 2)).toBe(true));

    await request.post("/create").send({
      instance: "tiles-empty-profile.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      order_request: "true",
      profile: "",
      config_profile: "",
    }).expect(202);
    await vi.waitFor(() => expect(Object.values(readState(dataPath).order_counts).some((counts) => counts[""] === 1)).toBe(true));

    await request.post("/create").send({
      instance: "tiles-no-order.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      order_request: "false",
      profile: "prod",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : container tiles-no-order configured on host-a"));

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v1.0.0", clean_name: "true" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : finished"));

    await request.post("/recreate").send({ image: "saashup/tile", version: "v3.0.0", oldversion: "v1.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("created image saashup/tile:v3.0.0"));

    await request.post("/restart").send({ restart_mode: "instance", instance: "tiles.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RESTART : finished"));

    await request.post("/restart").send({ restart_mode: "instance", operate_action: "stop", instance: "tiles.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("STOP : finished stop loop"));

    await request.post("/restart").send({ restart_mode: "image", image: "saashup/tile", restart_version: "v1.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RESTART : finished restart loop"));

    const stopPatchCountBeforeDelete = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/plugins/docker/containers/") && options?.method === "PATCH" && JSON.parse(options.body).some((item) => item.operation === "stop")).length;
    await request.post("/delete").send({ instance: "tiles.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted"));
    const stopPatchCountAfterDelete = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/plugins/docker/containers/") && options?.method === "PATCH" && JSON.parse(options.body).some((item) => item.operation === "stop")).length;
    expect(stopPatchCountAfterDelete).toBe(stopPatchCountBeforeDelete);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : Cloudflare DNS record delete requested for tiles.example.com"));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/cloudflare/dns/records/61/") && options?.method === "DELETE")).toBe(true);

    await request.post("/refresh-hosts").send({}).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("REFRESH_HOST : finished"));

    await request.post("/dockerhub").send({ push_data: { tag: "latest" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await request.post("/dockerhub").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("v2.0.0"));
  });

  test("records async operation errors and timeout branches", async () => {
    const { dataPath, fetchMock, request } = await loadServer({ operationTimeoutSeconds: "0" });
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/restart").send({ restart_mode: "instance", instance: "tiles.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RESTART : finished restart loop"));

    await request.post("/refresh-hosts").send({}).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("REFRESH_HOST : finished host refresh loop"));

    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => url.pathname === "/api/plugins/docker/containers/" && (options.method || "GET") === "GET" && url.searchParams.get("name") === "tiles",
      Object.assign(new Error("network down"), { payload: { reason: "offline" } }),
    );
    await request.post("/restart").send({ restart_mode: "instance", instance: "tiles.example.com", tag: "" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("ERROR : network down"));

    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => url.pathname === "/api/plugins/docker/images/" && (options.method || "GET") === "GET" && url.searchParams.get("version") === "v9.0.0",
      new Error("dockerhub exploded"),
    );
    await request.post("/dockerhub").send({ push_data: { tag: "v9.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DOCKERHUB : failed"));

    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => url.pathname === "/api/plugins/docker/containers/" && (options.method || "GET") === "GET" && url.searchParams.get("name") === "tiles",
      { payload: { reason: "empty message" } },
    );
    await request.post("/restart").send({ restart_mode: "instance", instance: "tiles.example.com", tag: "" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("ERROR : operation failed"));
  });

  test("covers recreate and restart edge branches", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      emptyImagesForName: "saashup/missing",
      recreateContainerName: "tiles-1700000000000",
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v1.0.0", clean_name: "true" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : finished"));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/containers/") && options?.method === "PATCH" && JSON.parse(options.body).some((item) => item.name === "tiles"))).toBe(true);

    await request.post("/recreate").send({ image: "saashup/missing", version: "v2.0.0", oldversion: "v1.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : no old images found for saashup/missing:v1.0.0"));

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", tag: "absent" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : no Docker hosts found with tag absent"));

    await request.post("/restart").send({ restart_mode: "instance", instance: "tiles.example.com", tag: "absent" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RESTART : no Docker hosts found with tag absent"));
  });

  test("covers create, recreate, and delete alternate branches", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      emptyContainersForName: "missing",
      emptyImagesForName: "saashup/missing",
      recreateContainerName: "tiles",
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "single.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      volume_source: "/app/data",
      volume_name: "single-data",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : 1 volume prepared on host-a"));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/") && options?.method === "POST" && !Array.isArray(JSON.parse(options.body)))).toBe(true);

    const volumeCallsBeforeNoVolumeCreate = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/") && options?.method === "POST").length;
    await request.post("/create").send({
      instance: "novolume.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      order_request: "false",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : container novolume created on host-a"));
    const volumeCallsAfterNoVolumeCreate = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/") && options?.method === "POST").length;
    expect(volumeCallsAfterNoVolumeCreate).toBe(volumeCallsBeforeNoVolumeCreate);

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : finished saashup/tile:all previous versions -> v2.0.0"));
    expect(fetchMock.mock.calls.some(([url, options]) => {
      if (!String(url).endsWith("/api/plugins/docker/containers/") || options?.method !== "PATCH") return false;
      return JSON.parse(options.body).some((item) => item.image === 20 && !Object.prototype.hasOwnProperty.call(item, "name"));
    })).toBe(true);

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v1.0.0", clean_name: "on" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : finished saashup/tile:v1.0.0 -> v2.0.0"));

    await request.post("/recreate").send({ image: "saashup/missing", version: "v2.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : no old images found for saashup/missing:all previous versions"));

    await request.post("/delete").send({ instance: "missing.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : cannot delete missing, expected 1 container got 0"));
  });

  test("covers create response and validation branches", async () => {
    const { dataPath, fetchMock, request } = await loadServer({ configureDelayMs: "1", recreateDelayMs: "1" });
    setupNetBoxFetch(fetchMock, { containerPostArray: true });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "array-response.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      order_request: "true",
      config_profile: "prod",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : container array-response configured on host-a"));
    await vi.waitFor(() => expect(Object.values(readState(dataPath).order_counts).some((counts) => counts.prod === 1)).toBe(true));

    await request.post("/create").send({
      instance: "nohosts.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      tag: "absent",
      port_value: "8080",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : no Docker hosts found with tag absent"));

    await request.post("/create").send({
      instance: "missing-image.example.com",
      image: "saashup/tile",
      version: "v3.0.0",
      port_value: "8080",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : image saashup/tile:v3.0.0 not found on host-a"));
  });

  test("covers fallback container fields used by host and log labels", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      containerHostAsId: true,
      deleteContainerRunning: true,
      omitContainerDisplay: true,
      recreateContainerName: "fallback-1700000000000",
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "fallback.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      order_request: "true",
      profile: "prod",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : container fallback configured on host-a"));

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v1.0.0", clean_name: true }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : 1/fallback-1700000000000 image set to saashup/tile:v2.0.0"));

    await request.post("/delete").send({ instance: "fallback-1700000000000.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : 1/fallback-1700000000000 stopped"));
  });

  test("covers recreate fallback names from display-only containers", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      omitContainerName: true,
      recreateContainerName: "display-only-1700000000000",
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      logs: "",
    });

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v1.0.0", clean_name: true }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : host-a/display-only-1700000000000 image set to saashup/tile:v2.0.0"));
    expect(fetchMock.mock.calls.some(([url, options]) => {
      if (!String(url).endsWith("/api/plugins/docker/containers/") || options?.method !== "PATCH") return false;
      return JSON.parse(options.body).some((item) => item.name === "display-only");
    })).toBe(true);

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v1.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : finished saashup/tile:v1.0.0 -> v2.0.0"));
  });

  test("waits for a running container to stop before deleting it", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { deleteContainerRunning: true });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/delete").send({ instance: "tiles.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted"));

    const calls = fetchMock.mock.calls.map(([url, options]) => ({
      path: new URL(String(url)).pathname,
      method: options?.method || "GET",
      body: options?.body ? JSON.parse(options.body) : undefined,
    }));
    const stopIndex = calls.findIndex((call) => call.path === "/api/plugins/docker/containers/" && call.method === "PATCH" && call.body.some((item) => item.operation === "stop"));
    const stoppedIndex = calls.findIndex((call) => call.path === "/api/plugins/docker/containers/30/" && call.method === "GET");
    const deleteIndex = calls.findIndex((call) => call.path === "/api/plugins/docker/containers/30/" && call.method === "DELETE");

    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(stoppedIndex).toBeGreaterThan(stopIndex);
    expect(deleteIndex).toBeGreaterThan(stoppedIndex);
    expect(readState(dataPath).logs).toContain("DELETE : host-a/tiles stopped");
  });
});
