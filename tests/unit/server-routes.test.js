const fs = require("fs");
const os = require("os");
const path = require("path");
const supertest = require("supertest");

function jsonResponse(payload, status = 200) {
  return {
    status,
    text: async () => JSON.stringify(payload),
  };
}

async function loadServer({ adminEmails = "", operationTimeoutSeconds = "1" } = {}) {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "saashup-test-"));
  process.env.DATAPATH = dataPath;
  process.env.APPPATH = path.resolve(__dirname, "../..");
  process.env.ENABLE_EDITOR = "1";
  process.env.OPERATION_TIMEOUT_SECONDS = operationTimeoutSeconds;
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

function setupNetBoxFetch(fetchMock) {
  fetchMock.mockImplementation(async (url, options = {}) => {
    const parsed = new URL(String(url));
    const method = options.method || "GET";
    const pathname = parsed.pathname;

    if (pathname === "/api/status/") return jsonResponse({ status: "ok" });

    if (pathname === "/api/plugins/docker/hosts/" && method === "GET") {
      return jsonResponse({
        results: [
          { id: 1, name: "host-a", tags: [{ slug: "tile" }] },
          { id: 2, name: "host-b", tags: [{ slug: "guide" }] },
        ],
      });
    }

    if (pathname === "/api/plugins/docker/images/" && method === "GET") {
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

    if (pathname === "/api/plugins/docker/containers/" && method === "GET") {
      if (parsed.searchParams.get("limit") === "1") return jsonResponse({ results: [{ id: 30 }] });
      return jsonResponse({
        results: [
          {
            id: 30,
            name: "tiles",
            display: "tiles",
            host: { id: 1, display: "host-a" },
            image: { id: 10 },
            network_settings: [{ network: { name: "bridge" } }, { network: { name: "traefik-public" } }],
          },
        ],
      });
    }

    if (pathname === "/api/plugins/docker/containers/" && method === "POST") {
      const body = JSON.parse(options.body);
      return jsonResponse({ id: 31, name: body.name, host: { id: body.host, display: "host-a" }, status: "running", operation: "none" }, 201);
    }

    if (pathname === "/api/plugins/docker/containers/" && method === "PATCH") return jsonResponse({});
    if (pathname === "/api/plugins/docker/containers/31/" && method === "GET") return jsonResponse({ id: 31, status: "running", operation: "none" });
    if (pathname === "/api/plugins/docker/containers/30/" && method === "GET") return jsonResponse({ id: 30, status: "running", operation: "none" });
    if (pathname === "/api/plugins/docker/containers/30/" && method === "DELETE") return jsonResponse({}, 204);
    if (pathname === "/api/plugins/docker/hosts/1/" && method === "PATCH") return jsonResponse({});
    if (pathname === "/api/plugins/docker/hosts/1/" && method === "GET") return jsonResponse({ id: 1, operation: "none", state: "active" });

    return jsonResponse({ detail: `${method} ${pathname}` }, 404);
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
  });

  test("serves version, user session, metrics, and protected admin pages", async () => {
    const { request } = await loadServer({ adminEmails: "allowed@example.com" });

    await request.get("/version").expect(200).expect((res) => {
      expect(res.body).toMatchObject({ name: "netbox-docker-image-upgrade", version: "1.0.0" });
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
    await request.delete("/logs").expect(200);
    await request.get("/logs").expect(200).expect((res) => {
      expect(res.text).toContain("&nbsp;<br>");
    });
    await request.delete("/config").expect(200);
    expect(readState(dataPath).config).toEqual({});
  });

  test("calls NetBox for read endpoints", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.get("/test").expect(200).expect((res) => {
      expect(res.body.status).toBe("ok");
    });
    await request.get("/instances").expect(200).expect((res) => {
      expect(res.body[0].instance).toBe("tiles");
      expect(res.body[0].networks).toContain("traefik-public");
    });
    await request.get("/images").expect(200).expect((res) => {
      expect(res.body[0].name).toBe("saashup/tile");
    });
    await request.get("/containers-count").query({ image: "saashup/tile", version: "v2.0.0" }).expect(200).expect((res) => {
      expect(res.body.count).toBe(1);
    });
  });

  test("returns NetBox read errors and empty-list fallbacks", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
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
    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ order_request: "true", profile: "prod" })
      .expect(429)
      .expect((res) => {
        expect(res.body.code).toBe("max_instances_reached");
      });
  });

  test("accepts write operations and records logs", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "tiles.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      order_request: "true",
      profile: "prod",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE :"));
    await vi.waitFor(() => expect(Object.values(readState(dataPath).order_counts).some((counts) => counts.prod === 1)).toBe(true));

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v1.0.0", clean_name: "true" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : finished"));

    await request.post("/recreate").send({ image: "saashup/tile", version: "v3.0.0", oldversion: "v1.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("created image saashup/tile:v3.0.0"));

    await request.post("/restart").send({ restart_mode: "instance", instance: "tiles.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RESTART : finished"));

    await request.post("/restart").send({ restart_mode: "image", image: "saashup/tile", restart_version: "v1.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RESTART : finished restart loop"));

    await request.post("/delete").send({ instance: "tiles.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted"));

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
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("timeout after 0s"));

    await request.post("/refresh-hosts").send({}).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("moving to next host"));

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("network down"), { payload: { reason: "offline" } }));
    await request.post("/restart").send({ restart_mode: "instance", instance: "tiles.example.com", tag: "" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("ERROR : network down"));

    fetchMock.mockRejectedValueOnce(new Error("dockerhub exploded"));
    await request.post("/dockerhub").send({ push_data: { tag: "v9.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DOCKERHUB : failed"));
  });
});
