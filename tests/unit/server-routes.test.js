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
  appPath = path.resolve(__dirname, "../.."),
  configureDelayMs = "0",
  dockerhubSecret = "",
  oidc = false,
  operationTimeoutSeconds = "1",
  ownerEmail = "",
  recreateDelayMs = "0",
} = {}) {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "saashup-test-"));
  process.env.DATAPATH = dataPath;
  process.env.APPPATH = appPath;
  process.env.ENABLE_EDITOR = "1";
  process.env.OPERATION_TIMEOUT_SECONDS = operationTimeoutSeconds;
  process.env.OPERATION_POLL_MS = "10";
  process.env.CREATE_CONFIGURE_DELAY_MS = configureDelayMs;
  process.env.CREATE_RECREATE_DELAY_MS = recreateDelayMs;
  if (dockerhubSecret) process.env.DOCKERHUB_WEBHOOK_SECRET = dockerhubSecret;
  else delete process.env.DOCKERHUB_WEBHOOK_SECRET;
  if (ownerEmail) process.env.SAASHUP_OWNER_EMAIL = ownerEmail;
  else delete process.env.SAASHUP_OWNER_EMAIL;
  delete process.env.APP_OWNER_EMAIL;
  if (adminEmails) process.env.ADMIN_ALLOWED_EMAILS = adminEmails;
  else delete process.env.ADMIN_ALLOWED_EMAILS;
  if (oidc) {
    process.env.OIDC_ISSUER_URL = "https://id.example.com/auth/realms/paashup";
    process.env.OIDC_CLIENT_ID = "saashup";
    process.env.OIDC_CLIENT_SECRET = "secret";
    process.env.OIDC_REDIRECT_URI = "https://app.example.com/oidc/callback";
    process.env.SESSION_SECRET = "test-session-secret";
  } else {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI;
    delete process.env.SESSION_SECRET;
  }

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

function cookieHeader(setCookie) {
  return setCookie.map((value) => value.split(";")[0]).join("; ");
}

function setupNetBoxFetch(fetchMock, {
  containerPostArray = false,
  containerHostAsId = false,
  deleteContainerRunning = false,
  dockerVolumeMount = false,
  volumeIdOnlyMount = false,
  omitContainerHost = false,
  emptyContainersForName = "",
  emptyImagesForName = "",
  invalidReportImages = false,
  multipleReportImages = false,
  omitContainerDisplay = false,
  omitContainerName = false,
  recreateContainerName = "tiles",
  reportContainerOwners = false,
  expectTraefikConfig = true,
  fuzzyContainerNameMatches = false,
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
      if (invalidReportImages && parsed.searchParams.get("limit") === "1000") {
        return jsonResponse({
          results: [
            { id: 0, name: "", version: "" },
            { id: 10, name: "saashup/tile", version: "v1.0.0", host: { id: 1, display: "host-a" } },
          ],
        });
      }
      if (multipleReportImages && parsed.searchParams.get("limit") === "1000") {
        const hostId = Number(parsed.searchParams.getAll("host_id")[0] || 1);
        return jsonResponse({
          results: [
            { id: 10, name: "saashup/tile", version: "v1.0.0", host: { id: hostId, display: "host-a" } },
            { id: 14, name: "saashup/tile", version: "v1.0.0", host: { id: hostId, display: "host-a" } },
            { id: 13, name: "saashup/tile", version: "v10.0.0", host: { id: hostId, display: "host-a" } },
            { id: 12, name: "saashup/zeta", version: "v2.0.0", host: { id: hostId, display: "host-a" } },
          ],
        });
      }
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

    if (pathname === "/api/plugins/docker/images/20/" && method === "GET") {
      return jsonResponse({ id: 20, imageID: "sha256:20" });
    }

    if (pathname === "/api/plugins/docker/images/10/" && method === "DELETE") {
      return jsonResponse({}, 204);
    }

    if (pathname === "/api/plugins/docker/volumes/" && method === "POST") {
      return jsonResponse(JSON.parse(options.body), 201);
    }

    if (pathname === "/api/plugins/docker/volumes/" && method === "GET") {
      return jsonResponse({ results: [{ id: 41, name: parsed.searchParams.get("name") || "tiles-data" }] });
    }

    if (pathname === "/api/plugins/docker/volumes/40/" && method === "DELETE") return jsonResponse({}, 204);
    if (pathname === "/api/plugins/docker/volumes/41/" && method === "DELETE") return jsonResponse({}, 204);
    if (pathname === "/api/plugins/docker/containers/70/" && method === "DELETE") return jsonResponse({}, 204);

    if (pathname === "/api/plugins/docker/containers/" && method === "GET") {
      if (parsed.searchParams.get("limit") === "1") return jsonResponse({ results: [{ id: 30 }] });
      if (parsed.searchParams.get("name") === emptyContainersForName) return jsonResponse({ results: [] });
      if (fuzzyContainerNameMatches && parsed.searchParams.get("name") === "netbox") {
        return jsonResponse({
          results: [
            {
              id: 70,
              name: "netbox",
              display: "netbox",
              host: { id: 1, display: "host-a" },
              image: { id: 10 },
              state: "created",
              status: "created",
              network_settings: [{ network: { name: "bridge" } }],
              mounts: [],
            },
            {
              id: 71,
              name: "netbox-worker",
              display: "netbox-worker",
              host: { id: 1, display: "host-a" },
              image: { id: 10 },
              state: "created",
              status: "created",
              network_settings: [{ network: { name: "bridge" } }],
              mounts: [],
            },
          ],
        });
      }
      if (reportContainerOwners === "variants") {
        return jsonResponse({
          results: [
            {
              id: 30,
              display: "env-vars",
              host: { id: 1, display: "host-a" },
              image: { id: 10 },
              state: "created",
              status: "created",
              network_settings: [{ network: { name: "bridge" } }],
              env: [null],
              env_vars: [{ name: "SAASHUP_OWNER", value: "envvars@example.com" }],
            },
            {
              id: 31,
              host: { id: 1, display: "host-a" },
              image: { id: 10 },
              state: "created",
              status: "created",
              network_settings: [{ network: { name: "bridge" } }],
              environment: [{ key: "SAASHUP_OWNER", value: "environment@example.com" }],
            },
          ],
        });
      }
      if (reportContainerOwners === "multiple") {
        return jsonResponse({
          results: [
            {
              id: 30,
              name: "zeta",
              display: "zeta",
              host: { id: 1, display: "host-a" },
              image: { id: 10 },
              state: "created",
              status: "created",
              network_settings: [{ network: { name: "bridge" } }],
              env: [{ var_name: "SAASHUP_OWNER", value: "ada@example.com" }],
            },
            {
              id: 31,
              name: "alpha",
              display: "alpha",
              host: { id: 1, display: "host-a" },
              image: { id: 10 },
              state: "created",
              status: "created",
              network_settings: [{ network: { name: "bridge" } }],
              env: [{ var_name: "SAASHUP_OWNER", value: "ada@example.com" }],
            },
            {
              id: 32,
              name: "omega",
              display: "omega",
              host: { id: 1, display: "host-a" },
              image: { id: 10 },
              state: "created",
              status: "created",
              network_settings: [{ network: { name: "bridge" } }],
              env: [{ var_name: "SAASHUP_OWNER", value: "zara@example.com" }],
            },
          ],
        });
      }
      return jsonResponse({
        results: [
          {
            id: 30,
            ...(omitContainerName ? {} : { name: recreateContainerName }),
            ...(omitContainerDisplay ? {} : { display: recreateContainerName }),
            ...(omitContainerHost ? {} : { host: containerHostAsId ? 1 : { id: 1, display: "host-a" } }),
            image: { id: 10 },
            state: deleteContainerRunning ? "running" : "created",
            status: deleteContainerRunning ? "running" : "created",
            network_settings: [{ network: { name: "bridge" } }, { network: { name: "traefik-public" } }],
            mounts: volumeIdOnlyMount
              ? [{ volume_id: 40, source: "/app/data" }]
              : dockerVolumeMount
              ? [{ docker_volume: { id: 40, name: "tiles-data" }, source: "/app/data" }]
              : [
                { volume: { id: 40, name: "tiles-data" }, source: "/app/data" },
                { volume: { name: "tiles-cache" }, source: "/app/cache" },
              ],
            ...(reportContainerOwners ? { env: [{ var_name: "SAASHUP_OWNER", value: "owner@example.com" }] } : {}),
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
        if (expectTraefikConfig) {
          expect(config.env).toEqual(expect.arrayContaining([{ var_name: "APP_ENV", value: "production" }]));
          expect(config.labels).toEqual(expect.arrayContaining([
            { key: "traefik.http.middlewares.force-https-header.headers.customrequestheaders.X-Forwarded-Proto", value: "https" },
            { key: "custom.label", value: "custom-value" },
          ]));
          expect(config.labels.some((label) => label.key.endsWith(".middlewares") && label.value === "force-https-header")).toBe(true);
          expect(config.labels.some((label) => label.key.endsWith(".ipallowlist.sourcerange") && label.value.includes("173.245.48.0/20"))).toBe(true);
        } else {
          expect(config.labels.some((label) => label.key === "traefik.enable" || label.key.startsWith("traefik.http."))).toBe(false);
        }
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

function setupOrderWorkflowNetBoxFetch(fetchMock) {
  const calls = [];
  const containers = new Map();
  let nextContainerId = 31;
  let dnsRecordCreated = false;

  fetchMock.mockImplementation(async (url, options = {}) => {
    const parsed = new URL(String(url));
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    const call = { method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams.entries()), body };
    calls.push(call);

    if (parsed.pathname === "/api/plugins/docker/hosts/" && method === "GET") {
      return jsonResponse({
        count: 2,
        results: [
          { id: 1, name: "host-a", display: "host-a", tags: [{ slug: "prod" }] },
          { id: 2, name: "host-b", display: "host-b", tags: [{ slug: "other" }] },
        ],
      });
    }

    if (parsed.pathname === "/api/plugins/docker/containers/" && method === "GET") {
      if (parsed.searchParams.get("name") === "tiles-order") {
        return jsonResponse({
          count: 1,
          results: [
            {
              id: 31,
              name: "tiles-order",
              display: "tiles-order",
              host: { id: 1, display: "host-a" },
              image: { id: 10 },
              state: "running",
              status: "running",
              operation: "none",
              mounts: [
                { volume: { id: 41, name: "tiles-order-data" }, source: "/data" },
              ],
              network_settings: [{ network: { name: "traefik-public" } }],
            },
          ],
        });
      }
      return jsonResponse({ count: containers.size, results: [...containers.values()] });
    }

    if (parsed.pathname === "/api/plugins/docker/images/" && method === "GET") {
      return jsonResponse({
        count: 1,
        results: [
          { id: 10, name: "saashup/tile", version: "v2.0.0", host: { id: Number(parsed.searchParams.get("host_id") || 1), display: "host-a" } },
        ],
      });
    }

    if (parsed.pathname === "/api/plugins/cloudflare/dns/accounts/" && method === "GET") {
      expect(parsed.searchParams.get("name")).toBe("example.com");
      return jsonResponse({ count: 1, results: [{ id: 51, name: "example.com" }] });
    }

    if (parsed.pathname === "/api/plugins/cloudflare/dns/records/" && method === "POST") {
      dnsRecordCreated = true;
      expect(body).toMatchObject({
        zone: 51,
        name: "tiles-order.example.com",
        type: "CNAME",
        content: "host-a.example.com",
        proxied: true,
      });
      return jsonResponse({ id: 61, ...body }, 201);
    }

    if (parsed.pathname === "/api/plugins/docker/volumes/" && method === "POST") {
      expect(body).toEqual({ host: 1, name: "tiles-order-data" });
      return jsonResponse({ id: 41, ...body }, 201);
    }

    if (parsed.pathname === "/api/plugins/docker/containers/" && method === "POST") {
      expect(body).toMatchObject({
        host: 1,
        name: "tiles-order",
        image: 10,
        restart_policy: "unless-stopped",
      });
      const container = {
        id: nextContainerId++,
        name: body.name,
        display: body.name,
        host: { id: body.host, display: "host-a" },
        image: { id: body.image },
        state: "created",
        status: "created",
        operation: "none",
      };
      containers.set(container.id, container);
      return jsonResponse(container, 201);
    }

    if (parsed.pathname === "/api/plugins/docker/containers/" && method === "PATCH") {
      if (body.some((item) => item.id === 31 && !item.operation)) {
        expect(itemWithId(body, 31)).toMatchObject({
          host: 1,
          ports: [{ public_port: -1, private_port: 8080, type: "tcp" }],
          mounts: [{ source: "/data", volume: { host: 1, name: "tiles-order-data" }, read_only: false }],
        });
        expect(itemWithId(body, 31).env).toEqual(expect.arrayContaining([
          { var_name: "APP_ENV", value: "production" },
          { var_name: "SAASHUP_OWNER", value: "buyer@example.com" },
        ]));
        expect(itemWithId(body, 31).labels).toEqual(expect.arrayContaining([
          { key: "traefik.enable", value: "true" },
          { key: "custom.label", value: "custom-value" },
        ]));
      }
      if (body.some((item) => item.id === 31 && item.operation === "recreate")) {
        const container = containers.get(31);
        containers.set(31, { ...container, state: "running", status: "running", operation: "none" });
      }
      if (body.some((item) => item.id === 31 && item.operation === "stop")) {
        const container = containers.get(31) || {};
        containers.set(31, { ...container, state: "exited", status: "exited", operation: "none" });
      }
      return jsonResponse({}, 200);
    }

    if (parsed.pathname === "/api/plugins/docker/containers/31/" && method === "GET") {
      return jsonResponse(containers.get(31) || { id: 31, state: "running", status: "running", operation: "none" });
    }

    if (parsed.pathname === "/api/plugins/docker/containers/31/" && method === "DELETE") {
      containers.delete(31);
      return jsonResponse({}, 204);
    }

    if (parsed.pathname === "/api/plugins/docker/volumes/41/" && method === "DELETE") {
      return jsonResponse({}, 204);
    }

    if (parsed.pathname === "/api/plugins/cloudflare/dns/records/" && method === "GET") {
      expect(parsed.searchParams.get("name")).toBe("tiles-order.example.com");
      return jsonResponse({ count: dnsRecordCreated ? 1 : 0, results: dnsRecordCreated ? [{ id: 61, name: "tiles-order.example.com" }] : [] });
    }

    if (parsed.pathname === "/api/plugins/cloudflare/dns/records/61/" && method === "DELETE") {
      dnsRecordCreated = false;
      return jsonResponse({}, 204);
    }

    return jsonResponse({ detail: `${method} ${parsed.pathname}` }, 404);
  });

  return calls;
}

function itemWithId(items, id) {
  return items.find((item) => item.id === id);
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
    delete process.env.DOCKERHUB_WEBHOOK_SECRET;
    delete process.env.SAASHUP_OWNER_EMAIL;
    delete process.env.APP_OWNER_EMAIL;
    delete process.env.LOCAL_DEV_EMAIL;
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI;
    delete process.env.SESSION_SECRET;
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

  test("handles Keycloak OIDC login, session, admin access, and logout", async () => {
    const { request, setOidcFetchForTests } = await loadServer({ adminEmails: "allowed@example.com", oidc: true });
    const oidcFetch = vi.fn(async (url, options = {}) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/.well-known/openid-configuration")) {
        return jsonResponse({
          authorization_endpoint: "https://id.example.com/auth",
          token_endpoint: "https://id.example.com/token",
          userinfo_endpoint: "https://id.example.com/userinfo",
        });
      }
      if (pathname === "/token" && options.method === "POST") {
        expect(String(options.body)).toContain("code=abc");
        return jsonResponse({ access_token: "token" });
      }
      if (pathname === "/userinfo") {
        expect(options.headers.Authorization).toBe("Bearer token");
        return jsonResponse({ email: "allowed@example.com", preferred_username: "allowed", name: "Allowed User" });
      }
      return jsonResponse({ detail: "not found" }, 404);
    });
    setOidcFetchForTests(oidcFetch);

    await request.get("/admin").expect(302).expect((res) => {
      expect(res.headers.location).toContain("/login?rd=%2Fadmin");
    });

    const login = await request.get("/login").query({ rd: "/admin" }).expect(302);
    const loginLocation = new URL(login.headers.location);
    const state = loginLocation.searchParams.get("state");
    expect(loginLocation.searchParams.get("client_id")).toBe("saashup");
    expect(loginLocation.searchParams.get("redirect_uri")).toBe("https://app.example.com/oidc/callback");
    expect(loginLocation.searchParams.get("code_challenge_method")).toBe("S256");

    const callback = await request
      .get("/oidc/callback")
      .query({ code: "abc", state })
      .set("Cookie", cookieHeader(login.headers["set-cookie"]))
      .expect(302);
    expect(callback.headers.location).toBe("/admin");
    const sessionCookie = cookieHeader(callback.headers["set-cookie"]);

    await request.get("/session/user").set("Cookie", sessionCookie).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ email: "allowed@example.com", user: "allowed", name: "Allowed User" });
    });
    await request.get("/admin").set("Cookie", sessionCookie).expect(200);

    await request.get("/logout").query({ rd: "/" }).set("Cookie", sessionCookie).expect(302).expect((res) => {
      expect(res.headers.location).toBe("/");
      expect(res.headers["set-cookie"].join("\n")).toContain("saashup_session=");
      expect(res.headers["set-cookie"].join("\n")).toContain("Max-Age=0");
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
      expect(res.body).toMatchObject({ customer_name: "", netbox: "", token: "", domain: "", tag: "", profile: "", config_profile: "" });
    });

    await request.get("/webhook")
      .query({
        customer_name: "CuriooCity",
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "tile",
        max_instances: "3",
        dockerhub_webhook_secret: "profile-hook",
        smtp_config: "mailer:smtp-secret@smtp.example.com:587",
        profile: "prod",
        profiles: JSON.stringify({ prod: { tag: "tile" } }),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.max_instances).toBe(3);
        expect(res.body.dockerhub_webhook_secret).toBe("profile-hook");
        expect(res.body.smtp_config).toBe("mailer:smtp-secret@smtp.example.com:587");
      });
    await request.get("/webhook")
      .query({
        customer_name: "CuriooCity",
        netbox: "https://netbox.example.com",
        token: "secret",
        proxy: "",
        domain: "example.com",
        tag: "tile",
        max_instances: "3",
        owner_env_var: "   ",
        profile: "prod",
        profiles: JSON.stringify({ prod: { tag: "tile" } }),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.owner_env_var).toBe("SAASHUP_OWNER");
      });

    await request.get("/config").expect(200).expect((res) => {
      expect(res.body.owner_env_var).toBe("SAASHUP_OWNER");
      expect(res.body.profile).toBe("prod");
      expect(res.body.customer_name).toBe("CuriooCity");
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
    expect(JSON.parse(readState(dataPath).config.profiles)).toMatchObject({
      prod: { tag: "tile" },
      dev: { tag: "guide" },
    });
    expect(readState(dataPath).templates).toMatchObject({
      tile: { image: "saashup/tile" },
      guide: { image: "saashup/guide" },
    });
    await request.post("/portable-config").send({
      config: {
        profile: "prod",
        config_profile: "prod",
        profiles: { prod: { tag: "tile-v2" } },
      },
      templates: {},
      order_counts: {},
    }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "imported", profiles: 1, templates: 0 });
    });
    expect(JSON.parse(readState(dataPath).config.profiles)).toMatchObject({
      prod: { tag: "tile-v2" },
      dev: { tag: "guide" },
    });
    expect(readState(dataPath).templates.guide.image).toBe("saashup/guide");
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
      expect(res.body.total_users).toBe(0);
    });
    expect(readState(dataPath).logs).toContain("REPORT_IMAGE : starting profile=all");
    expect(readState(dataPath).logs).toContain("REPORT_IMAGE : finished profile=all");

    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        tag: "tile",
        profile: "prod",
        config_profile: "prod",
        profiles: {
          dev: { tag: "guide" },
          prod: { tag: "tile" },
        },
      },
      templates: {},
      order_counts: {
        "dev-user@example.com": { dev: 2 },
        "prod-user@example.com": { prod: 1 },
        "both-user@example.com": { dev: 1, prod: 1 },
        "zero-user@example.com": { prod: 0 },
      },
      logs: "",
    });
    setupNetBoxFetch(fetchMock, { multipleReportImages: true });
    await request.get("/report/images").query({ profile: "prod" }).expect(200).expect((res) => {
      expect(res.body.profile).toBe("prod");
      expect(res.body.total_hosts).toBe(1);
      expect(res.body.total_users).toBe(2);
    });
    await request.get("/report/images").query({ profile: "all" }).expect(200).expect((res) => {
      expect(res.body.profile).toBe("all");
      expect(res.body.total_hosts).toBe(2);
      expect(res.body.total_users).toBe(3);
      expect(res.body.rows.map((row) => `${row.profile}:${row.image}`)).toEqual([
        "dev:saashup/tile",
        "dev:saashup/tile",
        "dev:saashup/zeta",
        "prod:saashup/tile",
        "prod:saashup/tile",
        "prod:saashup/zeta",
      ]);
      expect(res.body.rows.map((row) => row.version)).toEqual([
        "v1.0.0",
        "v10.0.0",
        "v2.0.0",
        "v1.0.0",
        "v10.0.0",
        "v2.0.0",
      ]);
    });
    await request.get("/report/images").expect(200).expect((res) => {
      expect(res.body.rows[0].profile).toBe("prod");
    });

    writeState(dataPath, {
      config: {},
      templates: {},
      order_counts: {},
      logs: "",
    });
    await request.get("/report/images").expect(200).expect((res) => {
      expect(res.body).toMatchObject({ rows: [], total_hosts: 0, total_images: 0, total_containers: 0 });
    });

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "absent" },
      templates: {},
      order_counts: {},
      logs: "",
    });
    await request.get("/report/images").expect(200).expect((res) => {
      expect(res.body).toMatchObject({ rows: [], total_hosts: 0 });
    });

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: { "buyer@example.com": { prod: 1 } },
      order_instances: { "buyer@example.com": { prod: [{ instance: "tiles.example.com" }] } },
      logs: "",
    });
    setupNetBoxFetch(fetchMock, { invalidReportImages: true });
    await request.get("/report/images").expect(200).expect((res) => {
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].image).toBe("saashup/tile");
    });

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: { "buyer@example.com": { prod: 1 } },
      order_instances: { "buyer@example.com": { prod: [{ instance: "tiles.example.com" }] } },
      logs: "",
    });
    setupNetBoxFetch(fetchMock, { reportContainerOwners: true });
    await request.get("/report/images").expect(200).expect((res) => {
      expect(res.body.total_users).toBe(1);
      expect(res.body.users).toEqual([
        expect.objectContaining({
          user: "owner@example.com",
          containers: 1,
          items: [
            expect.objectContaining({
              container: "tiles",
              image: "saashup/tile",
              version: "v1.0.0",
            }),
          ],
        }),
      ]);
    });
    expect(readState(dataPath).logs).toContain("found 1 owner from SAASHUP_OWNER");

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });
    setupNetBoxFetch(fetchMock, { reportContainerOwners: "multiple" });
    await request.get("/report/images").expect(200).expect((res) => {
      expect(res.body.total_users).toBe(2);
      expect(res.body.users.map((user) => user.user)).toEqual(["ada@example.com", "zara@example.com"]);
      expect(res.body.users[0]).toMatchObject({
        user: "ada@example.com",
        containers: 2,
        images: 1,
        items: [
          expect.objectContaining({ container: "alpha", image: "saashup/tile" }),
          expect.objectContaining({ container: "zeta", image: "saashup/tile" }),
        ],
      });
      expect(res.body.users[1]).toMatchObject({
        user: "zara@example.com",
        containers: 1,
        items: [
          expect.objectContaining({ container: "omega", image: "saashup/tile" }),
        ],
      });
    });

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });
    setupNetBoxFetch(fetchMock, { multipleReportImages: true, reportContainerOwners: "multiple" });
    await request.get("/report/images").expect(200).expect((res) => {
      expect(res.body.total_users).toBe(2);
      expect(res.body.users[0].images).toBe(3);
      expect(res.body.users[0].items.map((item) => item.image)).toEqual([
        "saashup/tile",
        "saashup/tile",
        "saashup/zeta",
        "saashup/tile",
        "saashup/tile",
        "saashup/zeta",
      ]);
    });

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });
    setupNetBoxFetch(fetchMock, { reportContainerOwners: "variants" });
    await request.get("/report/images").expect(200).expect((res) => {
      expect(res.body.users.map((user) => user.user)).toEqual(["environment@example.com", "envvars@example.com"]);
      expect(res.body.users[0].items[0].container).toBe("31");
    });

    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        profile: "prod",
        config_profile: "prod",
        profiles: {
          dev: { tag: "guide" },
          prod: { tag: "tile" },
        },
      },
      templates: {},
      order_counts: {},
      logs: "",
    });
    setupNetBoxFetch(fetchMock, { reportContainerOwners: true });
    await request.get("/report/images").query({ profile: "all" }).expect(200).expect((res) => {
      expect(res.body.total_users).toBe(1);
      expect(res.body.users[0]).toMatchObject({
        user: "owner@example.com",
        profiles: ["dev", "prod"],
        containers: 2,
      });
    });

    writeState(dataPath, {
      config: { profile: "prod", config_profile: "prod" },
      templates: {},
      order_counts: {
        "buyer@example.com": { prod: 2 },
        "zara@example.com": { prod: 1 },
      },
      order_instances: {
        "buyer@example.com": {
          prod: [
            { instance: "beta.example.com", image: "saashup/beta", version: "v2" },
            { instance: "alpha.example.com", image: "saashup/alpha", version: "v1" },
          ],
        },
      },
      logs: "",
    });
    await request.get("/report/images").query({ profile: "prod" }).expect(200).expect((res) => {
      expect(res.body.total_users).toBe(2);
      expect(res.body.users).toEqual([
        expect.objectContaining({
          user: "buyer@example.com",
          containers: 2,
          images: 2,
          items: [
            expect.objectContaining({ container: "alpha.example.com" }),
            expect.objectContaining({ container: "beta.example.com" }),
          ],
        }),
        expect.objectContaining({
          user: "zara@example.com",
          containers: 1,
          items: [],
        }),
      ]);
    });

    writeState(dataPath, {
      config: {},
      templates: {},
      order_counts: {
        "buyer@example.com": { "": 1, prod: 1 },
      },
      order_instances: {
        "buyer@example.com": {
          "": [{ name: "default.example.com", template: "Template", version: "v1" }],
          prod: [{ instance: "prod.example.com", image: "saashup/prod", version: "v2" }],
        },
      },
      logs: "",
    });
    await request.get("/report/images").query({ profile: "all" }).expect(200).expect((res) => {
      expect(res.body.users[0]).toMatchObject({
        user: "buyer@example.com",
        profiles: ["default", "prod"],
        containers: 2,
      });
      expect(res.body.users[0].items).toEqual([
        expect.objectContaining({ profile: "default", container: "default.example.com", image: "Template" }),
        expect.objectContaining({ profile: "prod", container: "prod.example.com", image: "saashup/prod" }),
      ]);
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

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("report failed"), { statusCode: 503, payload: { detail: "down" } }));
    await request.get("/report/images").query({ tag: "" }).expect(503).expect((res) => {
      expect(res.body.detail).toBe("report failed");
      expect(res.body.payload.detail).toBe("down");
    });
    fetchMock.mockRejectedValueOnce(new Error("report plain failed"));
    await request.get("/report/images").query({ tag: "" }).expect(502).expect((res) => {
      expect(res.body.detail).toBe("report plain failed");
    });
    fetchMock.mockRejectedValueOnce({});
    await request.get("/report/images").query({ tag: "" }).expect(502).expect((res) => {
      expect(res.body).toEqual({});
    });
    expect(readState(dataPath).logs).toContain("REPORT_IMAGE : failed report error");

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
      order_instances: { "buyer@example.com": { prod: [{ instance: "tiles.example.com", template: "Tiles" }] } },
      logs: "",
    });

    await request.get("/order/limit").set("x-auth-request-email", "buyer@example.com").query({ profile: "prod" }).expect(200).expect((res) => {
      expect(res.body.reached).toBe(true);
      expect(res.body.instances).toEqual([expect.objectContaining({ instance: "tiles.example.com" })]);
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

  test("runs the complete order workflow with mocked NetBox API responses", async () => {
    const { dataPath, fetchMock, request } = await loadServer({ operationTimeoutSeconds: "2" });
    const netboxCalls = setupOrderWorkflowNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        domain: "example.com",
        tag: "prod",
        max_instances: 2,
        profile: "prod",
        config_profile: "prod",
        owner_env_var: "SAASHUP_OWNER",
      },
      templates: {
        Tiles: {
          instance: "tiles-order",
          dns_name: "tiles-order.example.com",
          image: "saashup/tile",
          version: "v2.0.0",
          network: "traefik-public",
          port_value: "8080",
        },
      },
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/order").set("x-auth-request-email", "buyer@example.com").expect(200).expect((res) => {
      expect(res.text).toContain("Order Saashup Instance");
    });

    await request.get("/order/limit")
      .set("x-auth-request-email", "buyer@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ profile: "prod", used: 0, max: 2, remaining: 2, reached: false, instances: [] });
      });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        netbox: "https://netbox.example.com",
        token: "secret",
        domain: "example.com",
        tag: "prod",
        max_instances: "2",
        owner_env_var: "SAASHUP_OWNER",
        profile: "prod",
        config_profile: "prod",
        instance: "tiles-order.example.com",
        dns_name: "tiles-order.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        network: "traefik-public",
        port_value: "8080",
        var_env_key: ["APP_ENV"],
        var_env_value: ["production"],
        label_key: ["custom.label"],
        label_value: ["custom-value"],
        volume_source: ["/data"],
        volume_name: ["tiles-order-data"],
        traefik: "true",
        cloudflare_filter: "true",
        order_request: "true",
        order_template: "Tiles",
        wait: "true",
      })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ status: "finished" });
      });

    await request.get("/order/limit")
      .set("x-auth-request-email", "buyer@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ used: 1, max: 2, remaining: 1, reached: false });
        expect(res.body.instances).toEqual([
          expect.objectContaining({
            instance: "tiles-order.example.com",
            dns_name: "tiles-order.example.com",
            template: "Tiles",
            image: "saashup/tile",
            version: "v2.0.0",
            status: "ready",
          }),
        ]);
      });

    expect(readState(dataPath).logs).toContain("CREATE : Cloudflare DNS record requested for tiles-order.example.com -> host-a.example.com status=201");
    expect(readState(dataPath).logs).toContain("CREATE : container tiles-order configured on host-a");
    expect(readState(dataPath).logs).toContain("CREATE : host-a/tiles-order recreate requested");

    await request.post("/delete")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        netbox: "https://netbox.example.com",
        token: "secret",
        tag: "prod",
        instance: "tiles-order.example.com",
        profile: "prod",
        config_profile: "prod",
        delete_volumes: "true",
        order_request: "true",
      })
      .expect(202);

    await vi.waitFor(() => expect(readState(dataPath).order_counts["buyer@example.com"].prod).toBe(0));
    await vi.waitFor(() => expect(readState(dataPath).order_instances["buyer@example.com"].prod).toEqual([]));

    expect(netboxCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/plugins/docker/hosts/",
      "GET /api/plugins/docker/containers/",
      "GET /api/plugins/docker/images/",
      "GET /api/plugins/cloudflare/dns/accounts/",
      "POST /api/plugins/cloudflare/dns/records/",
      "POST /api/plugins/docker/volumes/",
      "POST /api/plugins/docker/containers/",
      "PATCH /api/plugins/docker/containers/",
      "GET /api/plugins/docker/containers/31/",
      "PATCH /api/plugins/docker/containers/",
      "GET /api/plugins/docker/containers/31/",
      "GET /api/plugins/docker/hosts/",
      "GET /api/plugins/docker/containers/",
      "PATCH /api/plugins/docker/containers/",
      "GET /api/plugins/docker/containers/31/",
      "DELETE /api/plugins/docker/containers/31/",
      "DELETE /api/plugins/docker/volumes/41/",
      "GET /api/plugins/cloudflare/dns/records/",
      "DELETE /api/plugins/cloudflare/dns/records/61/",
    ]);
  });

  test("reserves order slots immediately when create is accepted", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", max_instances: 1, profile: "prod", config_profile: "prod" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "tiles.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        port_value: "8080",
        order_request: "true",
        order_template: "Tiles",
        profile: "prod",
      })
      .expect(202);

    expect(readState(dataPath).order_counts["buyer@example.com"]?.prod).toBe(1);
    expect(readState(dataPath).order_instances["buyer@example.com"]?.prod).toEqual([
      expect.objectContaining({ instance: "tiles.example.com", template: "Tiles", status: expect.stringMatching(/^(creating|failed)$/) }),
    ]);

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "tiles-second.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        port_value: "8080",
        order_request: "true",
        order_template: "Tiles",
        profile: "prod",
      })
      .expect(429)
      .expect((res) => {
        expect(res.body.code).toBe("max_instances_reached");
        expect(res.body.used_instances).toBe(1);
      });
  });

  test("records sparse order reservations before async create work", async () => {
    const { dataPath, request } = await loadServer();
    writeState(dataPath, {
      config: { max_instances: 3, profile: "prod", config_profile: "prod" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ order_request: "true", profile: "prod" })
      .expect(202);

    expect(readState(dataPath).order_counts["buyer@example.com"].prod).toBe(1);
    expect(readState(dataPath).order_instances["buyer@example.com"].prod).toEqual([
      expect.objectContaining({ instance: "", template: "", image: "", version: "", status: expect.stringMatching(/^(creating|failed)$/) }),
    ]);
    await vi.waitFor(() => expect(readState(dataPath).order_instances["buyer@example.com"].prod[0]).toEqual(
      expect.objectContaining({ status: "failed" }),
    ));
    await request.get("/report/images").query({ profile: "prod" }).expect(200).expect((res) => {
      expect(res.body.total_users).toBe(1);
      expect(res.body.users).toEqual([
        expect.objectContaining({
          user: "buyer@example.com",
          containers: 1,
          items: [
            expect.objectContaining({ profile: "prod", container: "" }),
          ],
        }),
      ]);
    });
  });

  test("reports users across all stored orders when no report profiles exist", async () => {
    const { dataPath, request } = await loadServer();
    writeState(dataPath, {
      config: {},
      templates: {},
      order_counts: {
        "buyer@example.com": { prod: 2 },
        "empty@example.com": { prod: 0 },
        "staging@example.com": { staging: 1 },
      },
      order_instances: {},
      logs: "",
    });

    await request.get("/report/images")
      .query({ profile: "all" })
      .expect(200)
      .expect((res) => {
        expect(res.body.total_users).toBe(2);
      });
  });

  test("dockerhub webhook requires and uses the profile path", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        profile: "curioocity-tile",
        profiles: {
          "curioocity-guide": { tag: "guide" },
          "curioocity-tile": { tag: "tile" },
        },
      },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/dockerhub").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(404);
    await request.post("/dockerhub/curioocity-guide").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);

    await vi.waitFor(() => {
      const imageCalls = fetchMock.mock.calls
        .map(([url]) => new URL(String(url)))
        .filter((url) => url.pathname === "/api/plugins/docker/images/" && url.searchParams.get("version") === "v2.0.0");
      expect(imageCalls.some((url) => url.searchParams.get("host_id") === "2")).toBe(true);
    });
  });

  test("dockerhub webhook stays public when OIDC is enabled", async () => {
    const { dataPath, fetchMock, request } = await loadServer({ oidc: true });
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        profiles: {
          prod: { tag: "tile" },
        },
      },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/admin").expect(302).expect((res) => {
      expect(res.headers.location).toContain("/login?rd=%2Fadmin");
    });
    await request.post("/dockerhub/prod")
      .send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } })
      .expect(202)
      .expect((res) => {
        expect(res.body.status).toBe("accepted");
      });
  });

  test("dockerhub webhook can require a shared secret", async () => {
    const { dataPath, request } = await loadServer({ dockerhubSecret: "hook-secret" });
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        profiles: {
          prod: { tag: "tile" },
        },
      },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    const body = { push_data: { tag: "latest" }, repository: { repo_name: "saashup/tile" } };
    await request.post("/dockerhub/prod").send(body).expect(403);
    await request.post("/dockerhub/prod/bad-secret").send(body).expect(403);
    await request.post("/dockerhub/prod/hook-secret").send(body).expect(202);
    await request.post("/dockerhub/prod").query({ secret: "hook-secret" }).send(body).expect(202);
    await request.post("/dockerhub/prod").set("x-saashup-webhook-secret", "hook-secret").send(body).expect(202);
  });

  test("dockerhub webhook can use a profile-specific shared secret", async () => {
    const { dataPath, request } = await loadServer({ dockerhubSecret: "env-secret" });
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        profiles: {
          prod: { tag: "tile", dockerhub_webhook_secret: "profile-secret" },
          dev: { tag: "dev" },
        },
      },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/dockerhub-webhook-secret")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ secret: "profile-secret", default_secret: "env-secret" });
      });
    await request.get("/dockerhub-webhook-secret")
      .query({ config_profile: "dev" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ secret: "env-secret", default_secret: "env-secret" });
      });

    const body = { push_data: { tag: "latest" }, repository: { repo_name: "saashup/tile" } };
    await request.post("/dockerhub/prod/env-secret").send(body).expect(403);
    await request.post("/dockerhub/prod/profile-secret").send(body).expect(202);
    await request.post("/dockerhub/dev/env-secret").send(body).expect(202);
  });

  test("skips Traefik labels and Cloudflare DNS when Traefik is disabled", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { expectTraefikConfig: false });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "plain.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      traefik: "false",
    }).expect(202);

    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : container plain configured on host-a"));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/cloudflare/dns/records/") && options?.method === "POST")).toBe(false);
    expect(fetchMock.mock.calls.some(([url, options]) => {
      if (!String(url).endsWith("/api/plugins/docker/containers/") || options?.method !== "PATCH") return false;
      return JSON.parse(options.body).some((item) => item.id === 31 && item.labels?.some((label) => label.key === "traefik.enable" || label.key.startsWith("traefik.http.")));
    })).toBe(false);
  });

  test("create can install on all matching Docker hosts", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { expectTraefikConfig: false });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "all-hosts",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      traefik: "false",
      all_hosts: "true",
      wait: "true",
    }).expect(200).expect((res) => {
      expect(res.body).toEqual({ status: "finished" });
    });

    expect(readState(dataPath).logs).toContain("CREATE : finished all hosts ready=2/2");
    const containerCreates = fetchMock.mock.calls
      .filter(([url, options]) => String(url).endsWith("/api/plugins/docker/containers/") && options?.method === "POST")
      .map(([, options]) => JSON.parse(options.body).host);
    expect(containerCreates).toEqual([1, 2]);
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/cloudflare/dns/records/") && options?.method === "POST")).toBe(false);
  });

  test("accepts write operations and records logs", async () => {
    const { dataPath, fetchMock, request, setSmtpSenderForTests } = await loadServer({ ownerEmail: "owner@example.com" });
    setupNetBoxFetch(fetchMock);
    const smtpSender = vi.fn().mockResolvedValue({ messageId: "ready-message", accepted: ["admin@example.com"], response: "250 queued" });
    setSmtpSenderForTests(smtpSender);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3, owner_env_var: "OWNER", smtp_config: "mailer:smtp-secret@smtp.example.com:587" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").set("x-auth-request-email", "admin@example.com").send({
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
    await vi.waitFor(() => expect(readState(dataPath).order_instances["admin@example.com"]?.prod?.[0]).toEqual(
      expect.objectContaining({ instance: "tiles.example.com", status: "ready" }),
    ));
    await vi.waitFor(() => expect(smtpSender).toHaveBeenCalledWith(
      expect.objectContaining({ user: "mailer", password: "smtp-secret", host: "smtp.example.com", port: 587 }),
      expect.objectContaining({
        from: "owner@example.com",
        to: "admin@example.com",
        cc: ["owner@example.com"],
        subject: "tiles.example.com is ready",
        text: expect.stringContaining("Your instance is now running: tiles.example.com"),
        html: expect.stringContaining("Your instance is ready"),
      }),
    ));
    expect(smtpSender.mock.calls[0][1].html).toContain('src="cid:saashup-logo"');
    expect(smtpSender.mock.calls[0][1].inlineImages).toEqual([
      expect.objectContaining({ cid: "saashup-logo", contentType: "image/png" }),
    ]);
    expect(readState(dataPath).logs).toContain("EMAIL : ready notification sent to admin@example.com for tiles.example.com");
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/cloudflare/dns/records/") && options?.method === "POST" && JSON.parse(options.body).content === "host-a.example.com")).toBe(true);
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/") && options?.method === "POST" && JSON.parse(options.body).length === 2)).toBe(true);
    expect(fetchMock.mock.calls.some(([url, options]) => {
      if (!String(url).endsWith("/api/plugins/docker/containers/") || options?.method !== "PATCH") return false;
      return JSON.parse(options.body).some((item) => item.env?.some((env) => env.var_name === "OWNER" && env.value === "admin@example.com"));
    })).toBe(true);

    await request.post("/create").set("x-auth-request-email", "buyer@example.com").send({
      instance: "tiles-second.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      order_request: "true",
      order_template: "Tiles",
      profile: "",
      config_profile: "prod",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).order_counts["buyer@example.com"]?.prod).toBe(1));
    await vi.waitFor(() => expect(smtpSender).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(readState(dataPath).order_instances["buyer@example.com"]?.prod).toEqual([
      expect.objectContaining({ instance: "tiles-second.example.com", template: "Tiles", image: "saashup/tile", version: "v2.0.0" }),
    ]));
    expect(readState(dataPath).order_instances.buyer).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url, options]) => {
      if (!String(url).endsWith("/api/plugins/docker/containers/") || options?.method !== "PATCH") return false;
      return JSON.parse(options.body).some((item) => item.env?.some((env) => env.var_name === "OWNER" && env.value === "buyer@example.com"));
    })).toBe(true);

    await request.post("/create").set("x-auth-request-email", "nohosts@example.com").send({
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
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).includes("/api/plugins/docker/volumes/") && options?.method === "DELETE")).toBe(false);

    await request.post("/delete").send({ instance: "tiles.example.com", delete_volumes: "true" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : volume tiles-data deleted"));
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : volume tiles-cache deleted"));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/40/") && options?.method === "DELETE")).toBe(true);
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/41/") && options?.method === "DELETE")).toBe(true);

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3 },
      templates: {},
      order_counts: { "buyer@example.com": { prod: 1 } },
      order_instances: { "buyer@example.com": { prod: [{ instance: "tiles-second.example.com", template: "Tiles" }] } },
      logs: "",
    });
    await request.post("/delete")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ instance: "tiles-second.example.com", order_request: "true", profile: "prod" })
      .expect(202);
    await vi.waitFor(() => expect(readState(dataPath).order_instances["buyer@example.com"].prod).toEqual([]));
    await vi.waitFor(() => expect(readState(dataPath).order_counts["buyer@example.com"].prod).toBe(0));

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });
    await request.post("/delete")
      .set("x-auth-request-email", "missing@example.com")
      .send({ instance: "tiles.example.com", order_request: "true", profile: "prod" })
      .expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted"));
    expect(readState(dataPath).order_counts).toEqual({});
    expect(readState(dataPath).order_instances).toEqual({});

    await request.post("/refresh-hosts").send({}).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("REFRESH_HOST : finished"));

    await request.post("/dockerhub").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(404);
    await request.post("/dockerhub/prod").send({ push_data: { tag: "latest" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await request.post("/dockerhub/prod").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("v2.0.0"));
  });

  test("test email uses smtp config and owner email env", async () => {
    const { dataPath, request, setSmtpSenderForTests } = await loadServer({ ownerEmail: "owner@example.com" });
    const smtpSender = vi.fn().mockResolvedValue({ messageId: "test-message", accepted: ["owner@example.com"], rejected: [], response: "250 queued" });
    setSmtpSenderForTests(smtpSender);
    setSmtpSenderForTests(null);
    setSmtpSenderForTests(smtpSender);
    writeState(dataPath, {
      config: {
        profiles: {
          prod: { smtp_config: "mailer:smtp-secret@smtp.example.com:587" },
        },
      },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/mail-settings").expect(200).expect((res) => {
      expect(res.body).toEqual({ owner_email_configured: true });
    });
    await request.post("/test-email").send({ profile: "prod", config_profile: "prod" }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "sent", message_id: "test-message", accepted: ["owner@example.com"], rejected: [], response: "250 queued" });
    });
    expect(smtpSender).toHaveBeenCalledWith(
      expect.objectContaining({ user: "mailer", password: "smtp-secret", host: "smtp.example.com", port: 587 }),
      expect.objectContaining({
        to: "owner@example.com",
        subject: "test-instance.example.com is ready",
        text: expect.stringContaining("Your instance is now running: test-instance.example.com"),
        html: expect.stringContaining("Your instance is ready"),
      }),
    );
    expect(readState(dataPath).logs).toContain("EMAIL : test notification sent to owner for prod");
  });

  test("test email reports missing owner or smtp config", async () => {
    const { request } = await loadServer();

    await request.post("/test-email").send({ smtp_config: "smtp.example.com:25" }).expect(400).expect((res) => {
      expect(res.body.detail).toBe("owner email is not configured");
    });

    const { request: ownerRequest } = await loadServer({ ownerEmail: "owner@example.com" });
    await ownerRequest.post("/test-email").send({ smtp_config: "" }).expect(400).expect((res) => {
      expect(res.body.detail).toBe("smtp config is not configured");
    });
  });

  test("test email still sends when the email logo asset is missing", async () => {
    const missingAppPath = fs.mkdtempSync(path.join(os.tmpdir(), "saashup-missing-assets-"));
    const { dataPath, request, setSmtpSenderForTests } = await loadServer({ appPath: missingAppPath, ownerEmail: "owner@example.com" });
    const smtpSender = vi.fn().mockResolvedValue({ messageId: "no-logo-message" });
    setSmtpSenderForTests(smtpSender);
    writeState(dataPath, {
      config: {},
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/test-email").send({ smtp_config: "mailer:smtp-secret@smtp.example.com:587" }).expect(200);
    expect(smtpSender).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        html: expect.not.stringContaining("cid:saashup-logo"),
        inlineImages: [],
      }),
    );
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
    await request.post("/dockerhub/prod").send({ push_data: { tag: "v9.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DOCKERHUB : failed"));

    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => url.pathname === "/api/plugins/docker/containers/" && (options.method || "GET") === "GET" && url.searchParams.get("name") === "tiles",
      { payload: { reason: "empty message" } },
    );
    await request.post("/restart").send({ restart_mode: "instance", instance: "tiles.example.com", tag: "" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("ERROR : operation failed"));
  });

  test("marks order create failed when recreate never becomes ready", async () => {
    const { dataPath, fetchMock, request } = await loadServer({ operationTimeoutSeconds: "0" });
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3 },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/create").set("x-auth-request-email", "slow@example.com").send({
      instance: "slow.example.com",
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

    await vi.waitFor(() => expect(readState(dataPath).order_instances["slow@example.com"]?.prod?.[0]).toEqual(
      expect.objectContaining({ instance: "slow.example.com", status: "failed" }),
    ));
    expect(readState(dataPath).logs).toContain("timeout after 0s");
  });

  test("keeps order ready when ready email fails", async () => {
    const { dataPath, fetchMock, request, setSmtpSenderForTests } = await loadServer({ ownerEmail: "owner@example.com" });
    setupNetBoxFetch(fetchMock);
    setSmtpSenderForTests(vi.fn().mockRejectedValue(new Error("smtp unavailable")));
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3, smtp_config: "mailer:smtp-secret@smtp.example.com:587" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/create").set("x-auth-request-email", "mailfail@example.com").send({
      instance: "mailfail.example.com",
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

    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("EMAIL : ready notification failed for mailfail@example.com smtp unavailable"));
    await vi.waitFor(() => expect(readState(dataPath).order_instances["mailfail@example.com"]?.prod?.[0]).toEqual(
      expect.objectContaining({ instance: "mailfail.example.com", status: "ready" }),
    ));
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

    const imageDeletesBefore = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/plugins/docker/images/10/") && options?.method === "DELETE").length;
    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v1.0.0", clean_name: "on", remove_old_images: "true" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : finished saashup/tile:v1.0.0 -> v2.0.0"));
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : removed old image saashup/tile:v1.0.0 from host-a"));
    const imageDeletesAfter = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/plugins/docker/images/10/") && options?.method === "DELETE").length;
    expect(imageDeletesAfter).toBe(imageDeletesBefore + 1);

    await request.post("/recreate").send({ image: "saashup/tile", version: "v2.0.0", oldversion: "v2.0.0", remove_old_images: "true" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : finished saashup/tile:v2.0.0 -> v2.0.0"));
    const imageDeletesAfterSameVersion = fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/api/plugins/docker/images/10/") && options?.method === "DELETE").length;
    expect(imageDeletesAfterSameVersion).toBe(imageDeletesAfter);

    await request.post("/recreate").send({ image: "saashup/missing", version: "v2.0.0" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("RECREATE : no old images found for saashup/missing:all previous versions"));

    await request.post("/delete").send({ instance: "missing.example.com" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : cannot delete missing, expected 1 container got 0"));
  });

  test("deletes the exact container when NetBox returns fuzzy name matches", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { fuzzyContainerNameMatches: true });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/delete").send({ instance: "netbox" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container netbox deleted id=70"));
    expect(readState(dataPath).logs).not.toContain("cannot delete netbox");
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/containers/70/") && options?.method === "DELETE")).toBe(true);
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/containers/71/") && options?.method === "DELETE")).toBe(false);
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

    await request.post("/create")
      .set("x-auth-request-email", "nohosts@example.com")
      .send({
        instance: "nohosts.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        tag: "absent",
        port_value: "8080",
        order_request: "true",
        profile: "prod",
      }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : no Docker hosts found with tag absent"));
    await vi.waitFor(() => expect(readState(dataPath).order_instances["nohosts@example.com"]?.prod?.[0]).toEqual(
      expect.objectContaining({ instance: "nohosts.example.com", status: "failed" }),
    ));

    await request.post("/create").send({
      instance: "missing-image.example.com",
      image: "saashup/tile",
      version: "v3.0.0",
      port_value: "8080",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : image saashup/tile:v3.0.0 not found on host-a"));

    await request.post("/create")
      .set("x-auth-request-email", "missing-image@example.com")
      .send({
        instance: "missing-order.example.com",
        image: "saashup/tile",
        version: "v3.0.0",
        port_value: "8080",
        order_request: "true",
        profile: "prod",
      })
      .expect(202);
    await vi.waitFor(() => expect(readState(dataPath).order_instances["missing-image@example.com"]?.prod?.[0]).toEqual(
      expect.objectContaining({ instance: "missing-order.example.com", status: "failed" }),
    ));
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

  test("deletes mounted docker_volume references when requested", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { dockerVolumeMount: true });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/delete").send({ instance: "tiles.example.com", delete_volumes: "true" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : volume tiles-data deleted"));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/40/") && options?.method === "DELETE")).toBe(true);
  });

  test("deletes mounted volume_id references when requested", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { volumeIdOnlyMount: true });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/delete").send({ instance: "tiles.example.com", delete_volumes: "true" }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : volume 40 deleted"));
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/api/plugins/docker/volumes/40/") && options?.method === "DELETE")).toBe(true);
  });

  test("create wait mode blocks until recreate finishes", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    const response = await request.post("/create").send({
      instance: "workflow-step.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      wait: "true",
    }).expect(200);

    expect(response.body).toEqual({ status: "finished" });
    expect(readState(dataPath).logs).toContain("CREATE : host-a/workflow-step ready status=running operation=none");
  });

  test("create wait mode reports failures and marks order failed", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => url.pathname === "/api/plugins/docker/hosts/" && (options.method || "GET") === "GET",
      Object.assign(new Error("netbox unavailable"), { statusCode: 503, payload: { detail: "down" } }),
    );
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3 },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    const response = await request.post("/create").set("x-auth-request-email", "workflow@example.com").send({
      instance: "broken.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      order_request: "true",
      profile: "prod",
      wait: "true",
    }).expect(503);

    expect(response.body).toMatchObject({ detail: "netbox unavailable", payload: { detail: "down" } });
    expect(readState(dataPath).logs).toContain("ERROR : netbox unavailable");
    expect(readState(dataPath).order_instances["workflow@example.com"]?.prod?.[0]).toEqual(
      expect.objectContaining({ instance: "broken.example.com", status: "failed" }),
    );
  });

  test("deletes named volumes without a container host fallback", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { omitContainerHost: true });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: { "buyer@example.com": { prod: 1 } },
      order_instances: { "buyer@example.com": { prod: [{ instance: "tiles.example.com" }] } },
      logs: "",
    });

    await request.post("/delete")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ instance: "tiles.example.com", delete_volumes: "true", order_request: "true", config_profile: "prod" })
      .expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : volume tiles-cache deleted"));

    const volumeLookup = fetchMock.mock.calls.find(([url, options]) => String(url).includes("/api/plugins/docker/volumes/?") && (options?.method || "GET") === "GET");
    expect(new URL(String(volumeLookup[0])).searchParams.has("host_id")).toBe(false);
    expect(readState(dataPath).order_counts["buyer@example.com"]?.prod).toBe(0);
  });
});
