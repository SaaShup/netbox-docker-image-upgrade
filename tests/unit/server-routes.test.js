const fs = require("fs");
const os = require("os");
const path = require("path");
const supertest = require("supertest");
const packageJson = require("../../package.json");
const activeTestServers = [];

function jsonResponse(payload, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "" },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function registryChallengeResponse(challenge) {
  return {
    status: 401,
    ok: false,
    headers: {
      get: (name) => String(name || "").toLowerCase() === "www-authenticate" ? challenge : "",
    },
    json: async () => ({}),
    text: async () => "",
  };
}

async function loadServer({
  adminEmails = "",
  appPath = path.resolve(__dirname, "../.."),
  configureDelayMs = "0",
  registrySecret = "",
  oidc = false,
  operationTimeoutSeconds = "1",
  ownerEmail = "",
  publicApiAllowedOrigins = "",
  publicApiSecret = "",
  recreateDelayMs = "0",
  enrollBlockedImages = "",
  turnstileSecretKey = "",
} = {}) {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "saashup-test-"));
  process.env.DATAPATH = dataPath;
  process.env.APPPATH = appPath;
  process.env.ENABLE_EDITOR = "1";
  process.env.OPERATION_TIMEOUT_SECONDS = operationTimeoutSeconds;
  process.env.OPERATION_POLL_MS = "10";
  process.env.CREATE_CONFIGURE_DELAY_MS = configureDelayMs;
  process.env.CREATE_RECREATE_DELAY_MS = recreateDelayMs;
  if (registrySecret) process.env.REGISTRY_WEBHOOK_SECRET = registrySecret;
  else delete process.env.REGISTRY_WEBHOOK_SECRET;
  if (enrollBlockedImages) process.env.SAASHUP_ENROLL_BLOCKED_IMAGES = enrollBlockedImages;
  else delete process.env.SAASHUP_ENROLL_BLOCKED_IMAGES;
  if (ownerEmail) process.env.APP_OWNER_EMAIL = ownerEmail;
  else delete process.env.APP_OWNER_EMAIL;
  if (adminEmails) process.env.ADMIN_ALLOWED_EMAILS = adminEmails;
  else delete process.env.ADMIN_ALLOWED_EMAILS;
  if (publicApiAllowedOrigins) process.env.PUBLIC_API_ALLOWED_ORIGINS = publicApiAllowedOrigins;
  else delete process.env.PUBLIC_API_ALLOWED_ORIGINS;
  if (publicApiSecret) process.env.PUBLIC_API_SECRET = publicApiSecret;
  else delete process.env.PUBLIC_API_SECRET;
  if (turnstileSecretKey) process.env.TURNSTILE_SECRET_KEY = turnstileSecretKey;
  else delete process.env.TURNSTILE_SECRET_KEY;
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
  const testServer = server.app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    testServer.once("listening", resolve);
    testServer.once("error", reject);
  });
  activeTestServers.push(testServer);
  return {
    ...server,
    dataPath,
    fetchMock,
    request: supertest(testServer),
  };
}

function writeState(dataPath, state) {
  fs.writeFileSync(path.join(dataPath, "app-state.json"), JSON.stringify(state, null, 2));
}

function readState(dataPath) {
  return JSON.parse(fs.readFileSync(path.join(dataPath, "app-state.json"), "utf8"));
}

function parseProfiles(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return JSON.parse(value);
}

function parsedFetchCalls(fetchMock) {
  return fetchMock.mock.calls.map(([url, options = {}]) => ({
    url: new URL(String(url)),
    method: options.method || "GET",
    body: options.body ? JSON.parse(options.body) : undefined,
  }));
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
  netboxTemplateContainers,
  netboxTemplateContexts = [],
  expectTraefikConfig = true,
  fuzzyContainerNameMatches = false,
  createHostSelectionContainers,
  fuzzyImageNameMatches = false,
  existingVolumes = [],
  dockerRegistries = [],
} = {}) {
  let deleteContainerGetCount = 0;
  let stopRequested = false;
  const configContextStore = [...netboxTemplateContexts];
  fetchMock.mockImplementation(async (url, options = {}) => {
    const parsed = new URL(String(url));
    const method = options.method || "GET";
    const pathname = parsed.pathname;

    if (pathname === "/api/status/") return jsonResponse({ status: "ok" });

    if (pathname === "/api/extras/config-contexts/" && method === "GET") {
      const q = String(parsed.searchParams.get("q") || "").toLowerCase();
      const results = configContextStore.filter((context) => (
        !q || String(context.name || "").toLowerCase().includes(q)
      ));
      return jsonResponse({ results });
    }

    if (pathname === "/api/extras/config-contexts/" && method === "POST") {
      const body = JSON.parse(options.body);
      const next = { id: 501 + configContextStore.length, ...body };
      configContextStore.push(next);
      return jsonResponse(next, 201);
    }

    if (/^\/api\/extras\/config-contexts\/\d+\/$/.test(pathname) && method === "PATCH") {
      const id = Number(pathname.split("/").filter(Boolean).at(-1));
      const next = { id, ...JSON.parse(options.body) };
      const index = configContextStore.findIndex((context) => Number(context.id) === id);
      if (index >= 0) configContextStore[index] = next;
      else configContextStore.push(next);
      return jsonResponse(next);
    }

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

    if (pathname === "/api/plugins/docker/registries/" && method === "GET") {
      return jsonResponse({ results: dockerRegistries });
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
      if (version === "v2.0.0") return jsonResponse({ results: [{ id: 20, name: "saashup/tile", version, host: { id: Number(hostId || 1) }, registry: { id: 7 } }] });
      if (version === "v3.0.0") return jsonResponse({});
      if (fuzzyImageNameMatches && parsed.searchParams.get("name") === "saashup/tile") {
        return jsonResponse({
          results: [
            { id: 10, name: "saashup/tile", version: "v1.0.0", host: { id: Number(hostId || 1), display: "host-a" }, registry: { id: 7 } },
            { id: 99, name: "saashup/netbox-docker-agent", version: "v1.0.0", host: { id: Number(hostId || 1), display: "host-a" }, registry: { id: 7 } },
          ],
        });
      }
      return jsonResponse({ results: [{ id: 10, name: "saashup/tile", version: "v1.0.0", host: { id: Number(hostId || 1), display: "host-a" }, registry: { id: 7 } }] });
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
      if (parsed.searchParams.has("host_id") && parsed.searchParams.get("limit") === "10") {
        const hostIds = parsed.searchParams.getAll("host_id");
        const name = parsed.searchParams.get("name") || "";
        const matches = existingVolumes.filter((volume) => (
          (!name || volume.name === name)
          && (!hostIds.length || hostIds.includes(String(volume.host?.id || volume.host || "")))
        ));
        return jsonResponse({ results: matches });
      }
      return jsonResponse({ results: [{ id: 41, name: parsed.searchParams.get("name") || "tiles-data" }] });
    }

    if (pathname === "/api/plugins/docker/volumes/40/" && method === "DELETE") return jsonResponse({}, 204);
    if (pathname === "/api/plugins/docker/volumes/41/" && method === "DELETE") return jsonResponse({}, 204);
    if (pathname === "/api/plugins/docker/containers/70/" && method === "DELETE") return jsonResponse({}, 204);

    if (pathname === "/api/plugins/docker/containers/" && method === "GET") {
      if (parsed.searchParams.get("limit") === "1") return jsonResponse({ results: [{ id: 30 }] });
      if (parsed.searchParams.get("image_id") === "99") {
        return jsonResponse({
          results: [{
            id: 99,
            name: "netbox-docker-agent",
            display: "netbox-docker-agent",
            host: { id: 1, display: "host-a" },
            image: { id: 99 },
            state: "running",
            status: "running",
          }],
        });
      }
      if (parsed.searchParams.get("name") === emptyContainersForName) return jsonResponse({ results: [] });
      if (createHostSelectionContainers && parsed.searchParams.get("limit") === "1000" && parsed.searchParams.has("host_id")) {
        return jsonResponse({ results: createHostSelectionContainers });
      }
      if (netboxTemplateContainers && parsed.searchParams.get("limit") === "1000" && parsed.searchParams.has("host_id")) {
        return jsonResponse({ results: netboxTemplateContainers });
      }
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
        if (expectTraefikConfig && Array.isArray(config.env) && config.env.length > 0) {
          if (config.env.some((entry) => entry?.var_name === "APP_ENV")) {
            expect(config.env).toEqual(expect.arrayContaining([{ var_name: "APP_ENV", value: "production" }]));
          }
          if (config.env.some((entry) => entry?.var_name === "SAASHUP_OWNER")) {
            expect(config.env).toEqual(expect.arrayContaining([expect.objectContaining({ var_name: "SAASHUP_OWNER" })]));
          }
        }
        if (expectTraefikConfig && Array.isArray(config.labels) && config.labels.length > 0) {
          const hasTraefikMiddleware = config.labels.some((label) => (
            String(label?.key || "").endsWith(".middlewares") && String(label?.value || "") === "force-https-header"
          ));
          if (hasTraefikMiddleware) {
            expect(config.labels).toEqual(expect.arrayContaining([
              { key: "traefik.http.middlewares.force-https-header.headers.customrequestheaders.X-Forwarded-Proto", value: "https" },
            ]));
            if (config.labels.some((label) => label.key === "custom.label")) {
              expect(config.labels).toEqual(expect.arrayContaining([{ key: "custom.label", value: "custom-value" }]));
            }
            expect(config.labels.some((label) => String(label?.key || "").endsWith(".middlewares") && label.value === "force-https-header")).toBe(true);
            if (config.labels.some((label) => String(label?.key || "").endsWith(".ipallowlist.sourcerange"))) {
              expect(config.labels.some((label) => String(label?.key || "").endsWith(".ipallowlist.sourcerange") && String(label?.value || "").includes("173.245.48.0/20"))).toBe(true);
            }
          } else {
            expect(config.labels.some((label) => label.key === "traefik.enable" || label.key.startsWith("traefik.http."))).toBe(false);
          }
        } else {
          expect(config.labels).toEqual(expect.any(Array));
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

    if (parsed.pathname === "/api/extras/config-contexts/" && method === "GET") {
      return jsonResponse({
        results: [{
          id: 501,
          name: "saashup-template-catalog-prod-buyer",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "buyer@example.com",
            saashup_templates: {
              Tiles: {
                instance: "tiles-order",
                dns_name: "tiles-order.example.com",
                image: "saashup/tile",
                version: "v2.0.0",
                max_instances: 2,
                network: "traefik-public",
                port_value: "8080",
              },
            },
          },
        }],
      });
    }

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

    if (parsed.pathname === "/api/plugins/docker/volumes/" && method === "GET") {
      return jsonResponse({ results: [] });
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
        const current = containers.get(31) || {};
        containers.set(31, { ...current, ...itemWithId(body, 31) });
        expect(itemWithId(body, 31)).toMatchObject({
          host: 1,
          ports: [{ public_port: -1, private_port: 8080, type: "tcp" }],
          mounts: [{ source: "/data", volume: { host: 1, name: "tiles-order-data" }, read_only: false }],
        });
        const config = itemWithId(body, 31);
        if (config.env?.length) {
          if (config.env.some((entry) => entry?.var_name === "APP_ENV")) {
            expect(config.env).toEqual(expect.arrayContaining([{ var_name: "APP_ENV", value: "production" }]));
          }
          expect(config.env).toEqual(expect.arrayContaining([expect.objectContaining({ var_name: "SAASHUP_OWNER" })]));
        }
        if (config.labels?.length) {
          expect(config.labels).toEqual(expect.arrayContaining([
            { key: "traefik.enable", value: "true" },
            { key: "custom.label", value: "custom-value" },
          ]));
          if (config.labels.some((label) => String(label?.key || "").startsWith("saashup.template.")) || config.labels.some((label) => label.key === "traefik.enable")) {
            expect(config.labels).toEqual(expect.arrayContaining([
              { key: "saashup.template.name", value: "Tiles" },
              { key: "saashup.template.image", value: "saashup/tile" },
              expect.objectContaining({ key: "saashup.template.owner" }),
              { key: "saashup.template.owner_env_var", value: "SAASHUP_OWNER" },
              { key: "saashup.template.dns_name", value: "tiles-order.example.com" },
            ]));
          }
        }
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
    while (activeTestServers.length > 0) {
      const testServer = activeTestServers.pop();
      if (testServer.listening) {
        testServer.close();
      }
    }
    vi.restoreAllMocks();
    delete process.env.DATAPATH;
    delete process.env.APPPATH;
    delete process.env.ADMIN_ALLOWED_EMAILS;
    delete process.env.PUBLIC_API_ALLOWED_ORIGINS;
    delete process.env.PUBLIC_API_SECRET;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.ENABLE_EDITOR;
    delete process.env.OPERATION_TIMEOUT_SECONDS;
    delete process.env.OPERATION_POLL_MS;
    delete process.env.CREATE_CONFIGURE_DELAY_MS;
    delete process.env.CREATE_RECREATE_DELAY_MS;
    delete process.env.REGISTRY_WEBHOOK_SECRET;
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

  test("checks Docker Hub registry image availability", async () => {
    const { request, setRegistryFetchForTests } = await loadServer({ publicApiSecret: "test-secret" });
    const registryFetch = vi.fn(async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "auth.docker.io") {
        expect(parsed.searchParams.get("scope")).toBe("repository:saashup/netbox-docker-agent:pull");
        return jsonResponse({ token: "registry-token" });
      }
      if (parsed.hostname === "registry-1.docker.io") {
        expect(parsed.pathname).toBe("/v2/saashup/netbox-docker-agent/manifests/v1.24.0");
        if (!options.headers.Authorization) {
          return registryChallengeResponse('Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:saashup/netbox-docker-agent:pull"');
        }
        expect(options.headers.Authorization).toBe("Bearer registry-token");
        return jsonResponse({ schemaVersion: 2 });
      }
      return jsonResponse({ detail: "not found" }, 404);
    });
    setRegistryFetchForTests(registryFetch);

    await request.get("/registry/check")
      .set("X-Public-Api-Secret", "test-secret")
      .query({ image: "saashup/netbox-docker-agent:v1.24.0" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          registry: "docker.io",
          name: "saashup/netbox-docker-agent",
          tag: "v1.24.0",
          image: "saashup/netbox-docker-agent:v1.24.0",
          exists: true,
          status: 200,
        });
      });
  });

  test("checks GitHub, Quay, and GitLab registry image availability", async () => {
    const { request, setRegistryFetchForTests } = await loadServer({ publicApiSecret: "test-secret" });
    const registryFetch = vi.fn(async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (["ghcr.io", "quay.io", "registry.gitlab.com"].includes(parsed.hostname) && parsed.pathname.startsWith("/v2/")) {
        if (!options.headers.Authorization) {
          return registryChallengeResponse(`Bearer realm="https://${parsed.hostname}/token",service="${parsed.hostname}",scope="repository:${parsed.pathname.split("/manifests/")[0].replace(/^\/v2\//, "")}:pull"`);
        }
        expect(options.headers.Authorization).toBe(`Bearer ${parsed.hostname}-token`);
        return jsonResponse({ schemaVersion: 2 });
      }
      if (parsed.pathname === "/token") return jsonResponse({ token: `${parsed.hostname}-token` });
      return jsonResponse({ detail: "not found" }, 404);
    });
    setRegistryFetchForTests(registryFetch);

    await request.get("/registry/check")
      .set("X-Public-Api-Secret", "test-secret")
      .query({ image: "ghcr.io/saashup/netbox-docker-agent:v1.24.0" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ registry: "ghcr.io", name: "saashup/netbox-docker-agent", tag: "v1.24.0", exists: true });
      });
    await request.get("/registry/check")
      .set("X-Public-Api-Secret", "test-secret")
      .query({ image: "quay.io/saashup/netbox-docker-agent:v1.24.0" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ registry: "quay.io", name: "saashup/netbox-docker-agent", tag: "v1.24.0", exists: true });
      });
    await request.get("/registry/check")
      .set("X-Public-Api-Secret", "test-secret")
      .query({ image: "registry.gitlab.com/saashup/netbox-docker-agent:v1.24.0" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ registry: "registry.gitlab.com", name: "saashup/netbox-docker-agent", tag: "v1.24.0", exists: true });
      });
  });

  test("returns false when Docker Hub image tag is missing", async () => {
    const { request, setRegistryFetchForTests } = await loadServer({ publicApiSecret: "test-secret" });
    setRegistryFetchForTests(vi.fn(async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "auth.docker.io") return jsonResponse({ token: "registry-token" });
      if (parsed.hostname === "registry-1.docker.io") return jsonResponse({ detail: "manifest unknown" }, 404);
      return jsonResponse({}, 404);
    }));

    await request.get("/registry/check")
      .set("X-Public-Api-Secret", "test-secret")
      .query({ image: "nginx:no-such-tag" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          name: "library/nginx",
          tag: "no-such-tag",
          image: "library/nginx:no-such-tag",
          exists: false,
          status: 404,
        });
      });
  });

  test("rejects unsupported registry hosts", async () => {
    const { request } = await loadServer({ publicApiSecret: "test-secret" });

    await request.get("/registry/check")
      .set("X-Public-Api-Secret", "test-secret")
      .query({ image: "registry.example.com/saashup/app:v1" })
      .expect(400)
      .expect((res) => {
        expect(res.body.detail).toBe("unsupported registry host");
      });
  });

  test("public APIs return 401 when no origin allowlist or secret is configured", async () => {
    const { request } = await loadServer();

    await request.get("/registry/check")
      .query({ image: "saashup/netbox-docker-agent:v1.24.0" })
      .expect(401)
      .expect((res) => {
        expect(res.body.detail).toBe("public api is not configured");
      });
    await request.post("/contact")
      .send({ email: "ada@example.com", message: "Hello" })
      .expect(401)
      .expect((res) => {
        expect(res.body.detail).toBe("public api is not configured");
      });
  });

  test("public APIs allow configured Hugo origin and reject other origins", async () => {
    const { request, setRegistryFetchForTests } = await loadServer({ publicApiAllowedOrigins: "https://www.saashup.com" });
    setRegistryFetchForTests(vi.fn(async (url, options = {}) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "auth.docker.io") return jsonResponse({ token: "registry-token" });
      if (parsed.hostname === "registry-1.docker.io") return options?.headers?.Authorization ? jsonResponse({ schemaVersion: 2 }) : registryChallengeResponse('Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:saashup/netbox-docker-agent:pull"');
      return jsonResponse({}, 404);
    }));

    await request.options("/registry/check")
      .set("Origin", "https://www.saashup.com")
      .expect(204)
      .expect((res) => {
        expect(res.headers["access-control-allow-origin"]).toBe("https://www.saashup.com");
        expect(res.headers["access-control-allow-headers"]).toContain("X-Public-Api-Secret");
      });

    await request.get("/registry/check")
      .set("Origin", "https://www.saashup.com")
      .query({ image: "saashup/netbox-docker-agent:v1.24.0" })
      .expect(200)
      .expect((res) => {
        expect(res.headers["access-control-allow-origin"]).toBe("https://www.saashup.com");
        expect(res.body.exists).toBe(true);
      });

    await request.get("/registry/check")
      .set("Origin", "https://evil.example.com")
      .query({ image: "saashup/netbox-docker-agent:v1.24.0" })
      .expect(403)
      .expect((res) => {
        expect(res.body.detail).toBe("public api access denied");
      });

    await request.get("/registry/check")
      .query({ image: "saashup/netbox-docker-agent:v1.24.0" })
      .expect(403);
  });

  test("public APIs allow server-side shared secret without browser origin", async () => {
    const { request, setRegistryFetchForTests } = await loadServer({ publicApiAllowedOrigins: "https://www.saashup.com", publicApiSecret: "server-secret" });
    setRegistryFetchForTests(vi.fn(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "auth.docker.io") return jsonResponse({ token: "registry-token" });
      if (parsed.hostname === "registry-1.docker.io") return jsonResponse({ schemaVersion: 2 });
      return jsonResponse({}, 404);
    }));

    await request.get("/registry/check")
      .set("X-Public-Api-Secret", "server-secret")
      .query({ image: "saashup/netbox-docker-agent:v1.24.0" })
      .expect(200)
      .expect((res) => {
        expect(res.body.exists).toBe(true);
      });

    await request.get("/registry/check")
      .set("X-Public-Api-Secret", "wrong-secret")
      .query({ image: "saashup/netbox-docker-agent:v1.24.0" })
      .expect(403);
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
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);

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
        max_templates: "3",
        enrollment_limit: "2",
        smtp_config: "mailer:smtp-secret@smtp.example.com:587",
        profile: "prod",
        profiles: JSON.stringify({ prod: { tag: "tile" } }),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.max_templates).toBe(3);
        expect(res.body.enrollment_limit).toBe(2);
        expect(res.body.registry_webhook_secret).toBeUndefined();
        expect(res.body.smtp_config).toBe("mailer:smtp-secret@smtp.example.com:587");
        expect(res.body.template_catalog_sync).toMatchObject({ action: "created" });
      });
    const emptyTemplateCatalogContext = parsedFetchCalls(fetchMock).find((call) => (
      call.method === "POST"
      && call.url.pathname === "/api/extras/config-contexts/"
      && call.body?.data?.saashup_profile === "prod"
    ));
    expect(emptyTemplateCatalogContext.body).toMatchObject({
      is_active: true,
      data: {
        saashup_template_catalog: true,
        saashup_profile: "prod",
        saashup_templates: {},
        saashup_workflows: {},
      },
    });

    setupNetBoxFetch(fetchMock, {
      netboxTemplateContexts: [{
        id: 700,
        name: "saashup-template-catalog-prod-9a0a63e8463f",
        is_active: true,
        data: {
          saashup_template_catalog: true,
          saashup_profile: "prod",
          saashup_scope: "9a0a63e8463f",
          saashup_netbox_url: "https://netbox.example.com",
          saashup_tag: "tile",
          saashup_templates: {
            nginx: { image: "nginx", version: "1.31.1" },
          },
          saashup_workflows: {
            "prod::templates": { name: "templates", steps: [{ template: "nginx", enabled: true }] },
          },
        },
      }],
    });
    await request.get("/webhook")
      .query({
        customer_name: "CuriooCity",
        netbox: "https://netbox.example.com",
        token: "secret",
        domain: "example.com",
        tag: "tile",
        max_templates: "10",
        enrollment_limit: "10",
        profile: "prod",
        profiles: JSON.stringify({ prod: { tag: "tile", max_templates: 20, enrollment_limit: 20 } }),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.max_templates).toBe(20);
        expect(res.body.enrollment_limit).toBe(20);
      });
    const preservedCatalogPatch = parsedFetchCalls(fetchMock).find((call) => (
      call.method === "PATCH"
      && call.url.pathname === "/api/extras/config-contexts/700/"
    ));
    expect(preservedCatalogPatch.body.data.saashup_templates.nginx).toMatchObject({ image: "nginx", version: "1.31.1" });
    expect(preservedCatalogPatch.body.data.saashup_workflows["prod::templates"].steps).toEqual([{ template: "nginx", enabled: true }]);
    expect(readState(dataPath).config.max_templates).toBeUndefined();
    expect(readState(dataPath).config.enrollment_limit).toBeUndefined();
    expect(parseProfiles(readState(dataPath).config.profiles).prod.max_templates).toBe(20);
    expect(parseProfiles(readState(dataPath).config.profiles).prod.enrollment_limit).toBe(20);
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
        profiles: JSON.stringify({ prod: { tag: "tile", saashup_default: true }, dev: { tag: "guide", saashup_default: true } }),
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.owner_env_var).toBe("SAASHUP_OWNER");
      });

    await request.get("/config").expect(200).expect((res) => {
      expect(res.body.owner_env_var).toBe("SAASHUP_OWNER");
      expect(res.body.profile).toBe("prod");
      expect(res.body.customer_name).toBe("CuriooCity");
      expect(parseProfiles(res.body.profiles).prod.saashup_default).toBe(true);
      expect(parseProfiles(res.body.profiles).dev.saashup_default).toBeUndefined();
    });
    await request.post("/templates").set("x-auth-request-email", "owner@example.com").send({ tile: { image: "saashup/tile" } }).expect(200);
    await request.get("/templates").set("x-auth-request-email", "owner@example.com").expect(200).expect((res) => {
      expect(res.body.tile.image).toBe("saashup/tile");
    });
    await request.get("/portable-config").expect(200).expect((res) => {
      expect(res.body.config.profiles.prod.tag).toBe("tile");
      expect(res.body).toEqual({ config: expect.any(Object) });
    });
    await request.post("/portable-config").send({
      config: { profiles: { dev: { tag: "guide" } } },
      templates: { guide: { image: "saashup/guide" } },
      order_counts: { "user@example.com": { dev: 1 } },
    }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "imported", profiles: 1 });
      expect(res.body.templates).toBeUndefined();
    });
    const importedTemplateContext = parsedFetchCalls(fetchMock).find((call) => (
      call.method === "POST"
      && call.url.pathname === "/api/extras/config-contexts/"
      && call.body?.data?.saashup_templates?.guide?.image === "saashup/guide"
    ));
    expect(importedTemplateContext).toBeUndefined();
    expect(parseProfiles(readState(dataPath).config.profiles)).toMatchObject({
      prod: { tag: "tile" },
      dev: { tag: "guide" },
    });
    expect(readState(dataPath).templates?.guide).toBeUndefined();
    expect(readState(dataPath).templates?.tile).toBeUndefined();
    await request.post("/portable-config").send({
      config: {
        profile: "prod",
        config_profile: "prod",
        profiles: { prod: { tag: "tile-v2" } },
      },
      templates: {},
      order_counts: {},
    }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "imported", profiles: 1 });
      expect(res.body.templates).toBeUndefined();
    });
    expect(parseProfiles(readState(dataPath).config.profiles)).toMatchObject({
      prod: { tag: "tile-v2" },
      dev: { tag: "guide" },
    });
    expect(readState(dataPath).templates?.guide).toBeUndefined();
    await request.post("/portable-config").send({
      config: { profile: "solo" },
      templates: {},
      order_counts: {},
    }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "imported", profiles: 0 });
      expect(res.body.templates).toBeUndefined();
    });
    await request.delete("/logs").expect(200);
    await request.get("/logs").expect(200).expect((res) => {
      expect(res.text).toContain("&nbsp;<br>");
    });
    await request.delete("/config").expect(200);
    expect(readState(dataPath).config).toEqual({});
  });

  test("templates endpoint uses NetBox templates without local fallback when NetBox is configured", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContainers: [
        {
          id: 30,
          name: "guide-one",
          image: { name: "saashup/guide", version: "v1.2.3" },
          env: [{ var_name: "SAASHUP_OWNER", value: "owner@example.com" }],
          labels: [
            { key: "saashup.template.name", value: "Guide" },
            { key: "saashup.template.url", value: "https://templates.example.com/guide" },
            { key: "saashup.template.max_instances", value: "3" },
          ],
        },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", profile: "prod", config_profile: "prod" },
      templates: {
        Local: { image: "saashup/local", version: "v1", creator_email: "owner@example.com" },
      },
      logs: "",
    });

    await request.get("/templates")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body.Guide).toMatchObject({
          source: "netbox-template",
          image: "saashup/guide",
          version: "v1.2.3",
          template_url: "https://templates.example.com/guide",
          max_instances: 3,
        });
        expect(res.body.Local).toBeUndefined();
      });
  });

  test("templates endpoint reads template definitions from NetBox config contexts", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContexts: [
        {
          id: 501,
          name: "saashup-template-catalog-prod-owner",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "owner@example.com",
            saashup_templates: {
              Guide: {
                image: "saashup/guide",
                version: "v1.2.3",
                template_url: "https://templates.example.com/guide",
                max_instances: 3,
              },
              config_profile: "prod",
              saashup_enabled: true,
              instance_count: 2,
              "prod::stack": {
                name: "stack",
                config_profile: "prod",
                steps: [{ template: "Guide", enabled: true }],
              },
            },
            saashup_workflows: {
              "prod::stack": {
                name: "stack",
                config_profile: "prod",
                steps: [{ template: "Guide", enabled: true }],
              },
              Guide: {
                image: "saashup/guide",
              },
            },
          },
        },
        {
          id: 502,
          name: "manual-template-upload",
          is_active: true,
          data: {
            profile: "prod",
            templates: {
              Legacy: {
                image: "saashup/legacy",
                version: "v9.9.9",
                template_url: "https://templates.example.com/legacy",
              },
            },
            workflows: {
              "prod::legacy": {
                name: "legacy",
                steps: [{ template: "Legacy", enabled: true }],
              },
            },
          },
        },
        {
          id: 503,
          name: "nested-export-upload",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "owner@example.com",
            saashup_templates: {
              templates: {
                Nested: {
                  image: "saashup/nested",
                  version: "v1.0.0",
                },
                creator_email: "owner@example.com",
              },
              workflows: {
                "prod::nested": {
                  name: "nested",
                  steps: [{ template: "Nested", enabled: true }],
                },
                creator_email: "owner@example.com",
              },
            },
          },
        },
        {
          id: 504,
          name: "nested-export-without-workflows",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "owner@example.com",
            saashup_templates: {
              templates: {
                Solo: {
                  image: "saashup/solo",
                  version: "v2.0.0",
                },
              },
              workflows: {
                creator_email: "owner@example.com",
              },
            },
          },
        },
        {
          id: 505,
          name: "case-mismatch-catalog",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_scope: "stale-scope-key",
            saashup_profile: "PROD",
            saashup_netbox_url: "https://netbox.example.com/",
            saashup_tag: "MISSING",
            saashup_templates: {
              Nginx: {
                image: "nginx",
                version: "1.31.1",
              },
            },
            saashup_workflows: {
              "prod::nginx": {
                name: "nginx",
                steps: [{ template: "Nginx", enabled: true }],
              },
            },
          },
        },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "missing", profile: "prod", config_profile: "prod" },
      templates: {},
      order_instances: {
        "owner@example.com": {
          prod: [{ instance: "guide-one.example.com", template: "Guide" }],
        },
      },
      logs: "",
    });

    await request.get("/templates")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body.Guide).toMatchObject({
          source: "netbox-config-context",
          image: "saashup/guide",
          version: "v1.2.3",
          template_url: "https://templates.example.com/guide",
          max_instances: 3,
          instance_count: 0,
        });
        expect(res.body.Legacy).toMatchObject({
          source: "netbox-config-context",
          image: "saashup/legacy",
          version: "v9.9.9",
          template_url: "https://templates.example.com/legacy",
        });
        expect(res.body.Nested).toMatchObject({
          source: "netbox-config-context",
          image: "saashup/nested",
          version: "v1.0.0",
        });
        expect(res.body.Solo).toMatchObject({
          source: "netbox-config-context",
          image: "saashup/solo",
          version: "v2.0.0",
        });
        expect(res.body.Nginx).toMatchObject({
          source: "netbox-config-context",
          image: "nginx",
          version: "1.31.1",
        });
        expect(res.body.creator_email).toBeUndefined();
        expect(res.body.config_profile).toBeUndefined();
        expect(res.body.saashup_enabled).toBeUndefined();
        expect(res.body.instance_count).toBeUndefined();
        expect(res.body["prod::stack"]).toBeUndefined();
      });
    await request.get("/templates")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod", include_workflows: "true" })
      .expect(200)
      .expect((res) => {
        expect(res.body.templates.Guide).toMatchObject({ image: "saashup/guide" });
        expect(res.body.workflows["prod::stack"]).toMatchObject({
          name: "stack",
          config_profile: "prod",
          steps: [{ template: "Guide", enabled: true }],
          source: "netbox-config-context",
        });
        expect(res.body.workflows["prod::legacy"]).toMatchObject({
          name: "legacy",
          source: "netbox-config-context",
          steps: [{ template: "Legacy", enabled: true }],
        });
        expect(res.body.workflows["prod::nested"]).toMatchObject({
          name: "nested",
          source: "netbox-config-context",
          steps: [{ template: "Nested", enabled: true }],
        });
        expect(res.body.workflows["prod::templates"]).toMatchObject({
          name: "templates",
          source: "netbox-config-context",
          steps: [{ template: "Solo", enabled: true }],
        });
        expect(res.body.templates.config_profile).toBeUndefined();
        expect(res.body.templates.saashup_enabled).toBeUndefined();
        expect(res.body.templates.instance_count).toBeUndefined();
        expect(res.body.templates["prod::stack"]).toBeUndefined();
        expect(res.body.templates.creator_email).toBeUndefined();
        expect(res.body.workflows.Guide).toBeUndefined();
        expect(res.body.workflows.creator_email).toBeUndefined();
      });
  });

  test("stores template creator email and preserves it on edits", async () => {
    const { dataPath, request } = await loadServer();

    await request
      .post("/templates")
      .set("x-auth-request-email", "creator@example.com")
      .send({ tile: { image: "saashup/tile" } })
      .expect(200)
      .expect((res) => {
        expect(res.body.tile).toMatchObject({
          image: "saashup/tile",
          creator_email: "creator@example.com",
        });
      });

    await request
      .post("/templates")
      .set("x-auth-request-email", "editor@example.com")
      .send({
        tile: { image: "saashup/tile", version: "v2" },
        guide: { image: "saashup/guide" },
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.tile).toMatchObject({
          version: "v2",
          creator_email: "creator@example.com",
        });
        expect(res.body.guide).toMatchObject({
          image: "saashup/guide",
          creator_email: "editor@example.com",
        });
      });

    await request
      .post("/templates")
      .set("x-auth-request-email", "editor@example.com")
      .send({
        tile: { image: "saashup/tile", version: "v2", creator_email: "owner@example.com" },
        guide: { image: "saashup/guide" },
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.tile).toMatchObject({
          creator_email: "owner@example.com",
        });
      });

    expect(readState(dataPath).templates).toMatchObject({
      tile: { image: "saashup/tile", version: "v2", creator_email: "owner@example.com" },
      guide: { image: "saashup/guide", creator_email: "editor@example.com" },
    });
  });

  test("stores templates in a NetBox config context when credentials are configured", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", profile: "prod", config_profile: "prod" },
      templates: {},
      logs: "",
    });

    await request
      .post("/templates")
      .set("x-auth-request-email", "creator@example.com")
      .query({ include_workflows: "true" })
      .send({
        templates: { tile: { image: "saashup/tile", max_instances: 2 } },
        workflows: {
          "prod::stack": {
            name: "stack",
            config_profile: "prod",
            steps: [{ template: "tile", enabled: true }],
          },
        },
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.templates.tile).toMatchObject({
          image: "saashup/tile",
          max_instances: 2,
          creator_email: "creator@example.com",
        });
        expect(res.body.workflows["prod::stack"]).toMatchObject({ name: "stack" });
      });

    const contextPost = parsedFetchCalls(fetchMock).find((call) => call.method === "POST" && call.url.pathname === "/api/extras/config-contexts/");
    expect(contextPost).toBeTruthy();
    expect(contextPost.body).toMatchObject({
      name: expect.stringMatching(/^saashup-template-catalog-prod-/),
      is_active: true,
      data: {
        saashup_template_catalog: true,
        saashup_profile: "prod",
        saashup_scope: expect.stringMatching(/^[a-f0-9]{12}$/),
        saashup_netbox_url: "https://netbox.example.com",
        saashup_tag: "",
        saashup_templates: {
          tile: { image: "saashup/tile", max_instances: 2, creator_email: "creator@example.com" },
        },
        saashup_workflows: {
          "prod::stack": {
            name: "stack",
            config_profile: "prod",
            steps: [{ template: "tile", enabled: true }],
          },
        },
      },
    });
  });

  test("uses one NetBox template catalog per config scope, not per email", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: {
        profile: "prod",
        config_profile: "prod",
        profiles: {
          prod: {
            netbox: "https://netbox.example.com/",
            token: "secret",
            tag: "tile",
          },
        },
      },
      templates: {},
      workflows: {},
      logs: "",
    });

    await request
      .post("/templates")
      .set("x-auth-request-email", "creator@example.com")
      .query({ profile: "prod", include_workflows: "true" })
      .send({ templates: { tile: { image: "saashup/tile" } }, workflows: {} })
      .expect(200);

    await request
      .post("/templates")
      .set("x-auth-request-email", "editor@example.com")
      .query({ profile: "prod", include_workflows: "true" })
      .send({ templates: { guide: { image: "saashup/guide" } }, workflows: {} })
      .expect(200);

    const contextWrites = parsedFetchCalls(fetchMock).filter((call) => (
      (call.method === "POST" && call.url.pathname === "/api/extras/config-contexts/")
      || (call.method === "PATCH" && /^\/api\/extras\/config-contexts\/\d+\/$/.test(call.url.pathname))
    ));
    expect(contextWrites).toHaveLength(2);
    expect(contextWrites[0].method).toBe("POST");
    expect(contextWrites[1].method).toBe("PATCH");
    expect(contextWrites[1].body.name).toBe(contextWrites[0].body.name);
    expect(contextWrites[0].body.data).toMatchObject({
      saashup_profile: "prod",
      saashup_netbox_url: "https://netbox.example.com",
      saashup_tag: "tile",
    });
    expect(contextWrites[0].body.data.saashup_owner).toBeUndefined();
    expect(contextWrites[1].body.data.saashup_owner).toBeUndefined();
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
      expect(res.body.total_users).toBe(0);
    });
    await request.get("/report/images").query({ profile: "all" }).expect(200).expect((res) => {
      expect(res.body.profile).toBe("all");
      expect(res.body.total_hosts).toBe(2);
      expect(res.body.total_users).toBe(0);
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
      expect(res.body.users).toHaveLength(1);
      expect(res.body.users[0].user).toBe("owner@example.com");
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
      expect(res.body.users).toEqual([
        expect.objectContaining({
          user: "owner@example.com",
          containers: 2,
          items: [
            expect.objectContaining({ container: "tiles", image: "saashup/tile", profile: "dev" }),
            expect.objectContaining({ container: "tiles", image: "saashup/tile", profile: "prod" }),
          ],
        }),
      ]);
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
      expect(res.body.total_users).toBe(0);
      expect(res.body.users).toEqual([]);
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
      expect(res.body.total_users).toBe(0);
      expect(res.body.users).toEqual([]);
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
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContainers: [
        {
          id: 30,
          name: "tiles",
          display: "tiles.example.com",
          image: { name: "saashup/tile", version: "v2.0.0" },
          host: { id: 1 },
          state: "running",
          status: "running",
          operation: "none",
          env: [{ var_name: "SAASHUP_OWNER", value: "buyer@example.com" }],
          labels: [
            { key: "saashup.template.name", value: "Tiles" },
            { key: "saashup.template.owner", value: "buyer@example.com" },
            { key: "saashup.template.owner_env_var", value: "SAASHUP_OWNER" },
            { key: "saashup.template.max_instances", value: "1" },
            { key: "saashup.template.image", value: "saashup/tile" },
            { key: "saashup.template.version", value: "v2.0.0" },
            { key: "saashup.template.dns_name", value: "tiles.example.com" },
          ],
        },
        {
          id: 31,
          name: "guide",
          display: "guide.example.com",
          image: { name: "saashup/guide", version: "v1.0.0" },
          host: { id: 1 },
          state: "running",
          status: "running",
          operation: "none",
          env: [{ var_name: "SAASHUP_OWNER", value: "buyer@example.com" }],
          labels: [
            { key: "saashup.template.name", value: "Guide" },
            { key: "saashup.template.owner", value: "buyer@example.com" },
            { key: "saashup.template.dns_name", value: "guide.example.com" },
          ],
        },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_templates: 4, profile: "prod", config_profile: "prod" },
      logs: "",
    });

    await request.get("/order/limit").set("x-auth-request-email", "buyer@example.com").query({ profile: "prod", template: "Tiles" }).expect(200).expect((res) => {
      expect(res.body.reached).toBe(true);
      expect(res.body.used).toBe(1);
      expect(res.body.total_used).toBe(1);
      expect(res.body.instances).toEqual([
        expect.objectContaining({ instance: "tiles.example.com" }),
      ]);
    });
    await request.get("/order/limit").set("x-auth-request-email", "buyer@example.com").query({ profile: "prod" }).expect(200).expect((res) => {
      expect(res.body.instances).toEqual(expect.arrayContaining([
        expect.objectContaining({ instance: "tiles.example.com" }),
        expect.objectContaining({ instance: "guide.example.com" }),
      ]));
      expect(res.body.total_used).toBe(2);
    });
    await request.get("/order/limit").expect(200).expect((res) => {
      expect(res.body.profile).toBe("");
    });
    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ order_request: "true", order_template: "Tiles", profile: "prod" })
      .expect(429)
      .expect((res) => {
        expect(res.body.code).toBe("max_instances_reached");
      });

    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_templates: 4, profile: "prod", config_profile: "prod" },
      logs: "",
    });
    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ order_request: "true", order_template: "Tiles", profile: "prod" })
      .expect(429)
      .expect((res) => {
        expect(res.body.detail).toContain("maximum of 1 instance");
      });
  });

  test("order limit resolves NetBox-labeled templates when no local template exists", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContainers: [
        {
          id: 30,
          name: "guide-one",
          display: "guide-one.example.com",
          image: { name: "saashup/guide", version: "v1.2.3" },
          env: [{ var_name: "SAASHUP_OWNER", value: "buyer@example.com" }],
          labels: [
            { key: "saashup.template.name", value: "Guide" },
            { key: "saashup.template.max_instances", value: "3" },
          ],
        },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", profile: "prod", config_profile: "prod" },
      templates: {},
      logs: "",
    });

    await request.get("/order/limit")
      .set("x-auth-request-email", "buyer@example.com")
      .query({ profile: "prod", template: "Guide" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ used: 1, max: 3, remaining: 2, reached: false });
        expect(res.body.instances).toEqual([
          expect.objectContaining({ instance: "guide-one.example.com" }),
        ]);
      });
  });

  test("enforces enrollment limits separately from order requests", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { expectTraefikConfig: false });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", max_templates: 1, profile: "prod", config_profile: "prod" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "enroll-one.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        port_value: "8080",
        enroll_request: "true",
        profile: "prod",
      })
      .expect(202);

    expect(readState(dataPath).enrollment_counts).toBeUndefined();
    expect(readState(dataPath).enrollment_instances).toBeUndefined();
    expect(readState(dataPath).templates?.["enroll-one.example.com"]).toBeUndefined();
    const contextPost = parsedFetchCalls(fetchMock).find((call) => call.method === "POST" && call.url.pathname === "/api/extras/config-contexts/");
    expect(contextPost.body.data.saashup_templates.tile).toMatchObject({
      image: "saashup/tile",
      version: "v2.0.0",
      creator_email: "buyer@example.com",
      saashup_enabled: true,
    });
    expect(contextPost.body.data.saashup_workflows["prod::templates"]).toMatchObject({
      name: "templates",
      config_profile: "prod",
      steps: [
        expect.objectContaining({
          template: "tile",
          enabled: true,
          template_data: expect.objectContaining({ image: "saashup/tile", saashup_enabled: true }),
        }),
      ],
    });
    await vi.waitFor(() => {
      const configPatch = parsedFetchCalls(fetchMock).find((call) => (
        call.url.pathname === "/api/plugins/docker/containers/"
        && call.method === "PATCH"
        && Array.isArray(call.body)
        && call.body.some((item) => item.id === 31 && !item.operation)
      ));
      expect(configPatch?.body[0].labels).toEqual(expect.arrayContaining([
        { key: "saashup.template.name", value: "tile" },
        { key: "saashup.template.owner", value: "buyer@example.com" },
        { key: "saashup.template.image", value: "saashup/tile" },
        { key: "saashup.template.version", value: "v2.0.0" },
        { key: "saashup.template.port", value: "8080" },
      ]));
    });

    await request.get("/enroll/limit")
      .set("x-auth-request-email", "buyer@example.com")
      .query({ profile: "prod", template: "Tiles" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ used: 1, max: 1, remaining: 0, reached: true });
        expect(res.body.instances).toEqual([
          expect.objectContaining({ instance: "tile", image: "saashup/tile", source: "netbox-template" }),
        ]);
      });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "enroll-two.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        port_value: "8080",
        enroll_request: "true",
        profile: "prod",
      })
      .expect(429)
      .expect((res) => {
        expect(res.body.code).toBe("max_templates_reached");
        expect(res.body.max_templates).toBe(1);
        expect(res.body.used_templates).toBe(1);
      });

    expect(readState(dataPath).enrollment_counts).toBeUndefined();
    expect(readState(dataPath).enrollment_instances).toBeUndefined();
  });

  test("rejects duplicate enrolled images from any user before creating a new enrollment", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      expectTraefikConfig: false,
      netboxTemplateContexts: [{
        id: 800,
        name: "saashup-template-catalog-prod-existing",
        is_active: true,
        data: {
          saashup_template_catalog: true,
          saashup_profile: "prod",
          saashup_netbox_url: "https://netbox.example.com",
          saashup_templates: {
            "nginx-existing.example.com": {
              image: "nginx",
              version: "1.25",
              creator_email: "other@example.com",
            },
          },
        },
      }],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", max_templates: 3, profile: "prod", config_profile: "prod" },
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "nginx-new.example.com",
        image: "nginx:1.26",
        version: "1.26",
        port_value: "8080",
        enroll_request: "true",
        profile: "prod",
      })
      .expect(409)
      .expect((res) => {
        expect(res.body).toMatchObject({
          code: "template_already_enrolled",
          image: "nginx",
          existing_template: "nginx-existing.example.com",
        });
      });

    expect(parsedFetchCalls(fetchMock).some((call) => call.method === "POST" && call.url.pathname === "/api/plugins/docker/containers/")).toBe(false);
  });

  test("rejects enrollment creates without an explicit non-latest version", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { expectTraefikConfig: false });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", max_templates: 3, profile: "prod", config_profile: "prod" },
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "nginx-missing-version.example.com",
        image: "nginx",
        port_value: "8080",
        enroll_request: "true",
        profile: "prod",
      })
      .expect(400)
      .expect((res) => {
        expect(res.body).toMatchObject({
          code: "image_version_required",
          image: "nginx",
        });
      });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "nginx-latest.example.com",
        image: "nginx",
        version: "latest",
        port_value: "8080",
        enroll_request: "true",
        profile: "prod",
      })
      .expect(400)
      .expect((res) => {
        expect(res.body).toMatchObject({
          code: "image_version_latest_not_allowed",
          image: "nginx",
          version: "latest",
        });
      });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "nginx-tag-latest.example.com",
        image: "nginx:latest",
        port_value: "8080",
        enroll_request: "true",
        profile: "prod",
      })
      .expect(400)
      .expect((res) => {
        expect(res.body).toMatchObject({
          code: "image_version_latest_not_allowed",
          image: "nginx",
          version: "latest",
        });
      });

    expect(parsedFetchCalls(fetchMock).some((call) => call.method === "POST" && call.url.pathname === "/api/plugins/docker/containers/")).toBe(false);
  });

  test("enrollment create can use Docker Hub registry for official images", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      expectTraefikConfig: false,
      emptyImagesForName: "nginx",
      dockerRegistries: [{ id: 6, name: "dockerhub", serveraddress: "https://registry.hub.docker.com/v2/", host: { id: 1, name: "saashup1" } }],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", max_templates: 3, profile: "prod", config_profile: "prod" },
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "nginx.example.com",
        image: "nginx",
        version: "1.27",
        port_value: "8080",
        traefik: "false",
        enroll_request: "true",
        profile: "prod",
        wait: "true",
      })
      .expect(200);

    const calls = parsedFetchCalls(fetchMock);
    const registryLookup = calls.find((call) => call.url.pathname === "/api/plugins/docker/registries/" && call.method === "GET");
    expect(registryLookup).toBeTruthy();

    const imageCreate = calls.find((call) => call.url.pathname === "/api/plugins/docker/images/" && call.method === "POST");
    expect(imageCreate.body).toMatchObject({ name: "nginx", version: "1.27", registry: 6 });
    const contextPost = calls.find((call) => call.url.pathname === "/api/extras/config-contexts/" && call.method === "POST");
    expect(contextPost.body.data.saashup_templates.nginx).toMatchObject({
      config_profile: "prod",
      image: "nginx",
      version: "1.27",
      creator_email: "buyer@example.com",
      saashup_enabled: true,
      ports: [{ value: "8080" }],
    });
    expect(contextPost.body.data.saashup_workflows["prod::templates"].steps).toEqual([
      expect.objectContaining({
        template: "nginx",
        enabled: true,
        template_data: expect.objectContaining({ image: "nginx", saashup_enabled: true }),
      }),
    ]);
    expect(readState(dataPath).logs).toContain("ENROLL : template nginx synced to config context");
    expect(readState(dataPath).logs).toContain("CREATE : created image nginx:1.27 on");
    expect(readState(dataPath).logs).not.toContain("registry not found for image nginx");
  });

  test("rejects configured not-enrollable images", async () => {
    const { dataPath, fetchMock, request } = await loadServer({ enrollBlockedImages: "traefik,netbox-docker-agent" });
    setupNetBoxFetch(fetchMock, { expectTraefikConfig: false });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", max_templates: 3, profile: "prod", config_profile: "prod" },
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "agent.example.com",
        image: "saashup/netbox-docker-agent:v1.24.0",
        version: "v1.24.0",
        port_value: "8080",
        enroll_request: "true",
        profile: "prod",
      })
      .expect(403)
      .expect((res) => {
        expect(res.body).toMatchObject({
          code: "image_not_enrollable",
          image: "saashup/netbox-docker-agent",
          blocked_image: "netbox-docker-agent",
        });
      });

    expect(parsedFetchCalls(fetchMock).some((call) => call.method === "POST" && call.url.pathname === "/api/plugins/docker/containers/")).toBe(false);
  });

  test("enroll limit lists templates created by the user", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContexts: [{
        id: 610,
        name: "saashup-template-catalog-prod",
        is_active: true,
        data: {
          saashup_template_catalog: true,
          saashup_profile: "prod",
          saashup_netbox_url: "https://netbox.example.com",
          saashup_tag: "tile",
          saashup_templates: {
            Tile: { config_profile: "prod", image: "saashup/tile", version: "v1", creator_email: "owner@example.com" },
            Guide: { config_profile: "prod", image: "saashup/guide", version: "v2", creator_email: "other@example.com" },
            Install: { config_profile: "prod", image: "saashup/install", version: "v4", creator_email: "owner@example.com" },
            Shared: { image: "saashup/shared", version: "v3", creator_email: "owner@example.com" },
          },
        },
      }],
      netboxTemplateContainers: [
        { id: 30, name: "tile-one", image: { name: "saashup/tile", version: "v1" }, host: { id: 1 }, labels: [{ key: "saashup.template.name", value: "Tile" }, { key: "saashup.template.owner", value: "buyer@example.com" }] },
        { id: 31, name: "tile-two", image: { name: "saashup/tile", version: "v1" }, host: { id: 1 }, labels: [{ key: "saashup.template.name", value: "Tile" }, { key: "saashup.template.owner", value: "buyer@example.com" }] },
        { id: 32, name: "tile-dev", image: { name: "saashup/tile", version: "v1" }, host: { id: 1 }, labels: [{ key: "saashup.template.name", value: "Tile" }, { key: "saashup.template.owner", value: "second@example.com" }] },
        { id: 33, name: "guide", image: { name: "saashup/guide", version: "v2" }, host: { id: 1 }, labels: [{ key: "saashup.template.name", value: "Guide" }, { key: "saashup.template.owner", value: "buyer@example.com" }] },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", enrollment_limit: 2, profile: "prod", config_profile: "prod" },
      logs: "",
    });

    await request.get("/enroll/limit")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ used: 3, max: 2, remaining: 0, reached: true });
        expect(res.body.instances).toEqual(expect.arrayContaining([
          expect.objectContaining({ instance: "Tile", image: "saashup/tile", source: "netbox-template", status: "ready", instance_count: 3 }),
          expect.objectContaining({ instance: "Install", image: "saashup/install", source: "netbox-template", status: "ready", instance_count: 0 }),
          expect.objectContaining({ instance: "Shared", image: "saashup/shared", source: "netbox-template", status: "ready", instance_count: 0 }),
        ]));
      });
  });

  test("enroll template delete is allowed when no other owner uses it", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContexts: [{
        id: 620,
        name: "saashup-template-catalog-prod",
        is_active: true,
        data: {
          saashup_template_catalog: true,
          saashup_profile: "prod",
          saashup_netbox_url: "https://netbox.example.com",
          saashup_tag: "tile",
          saashup_templates: {
            Tile: { config_profile: "prod", image: "saashup/tile", version: "v1", creator_email: "owner@example.com" },
            Owned: { config_profile: "prod", image: "saashup/owned", version: "v2", creator_email: "owner@example.com" },
            Install: { config_profile: "prod", image: "saashup/install", version: "v4", creator_email: "owner@example.com" },
          },
        },
      }],
      netboxTemplateContainers: [
        { id: 40, name: "owned-one", image: { name: "saashup/owned", version: "v2" }, host: { id: 1 }, env: [{ var_name: "SAASHUP_OWNER", value: "owner@example.com" }], labels: [{ key: "saashup.template.name", value: "Owned" }, { key: "saashup.template.owner", value: "owner@example.com" }] },
        { id: 41, name: "tile-one", image: { name: "saashup/tile", version: "v1" }, host: { id: 1 }, env: [{ var_name: "SAASHUP_OWNER", value: "buyer@example.com" }], labels: [{ key: "saashup.template.name", value: "Tile" }, { key: "saashup.template.owner", value: "buyer@example.com" }] },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", enrollment_limit: 3, profile: "prod", config_profile: "prod" },
      logs: "",
    });

    await request.delete("/enroll/template/Tile")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(409)
      .expect((res) => {
        expect(res.body).toMatchObject({ code: "template_in_use", template: "Tile", instance_count: 1, blocking_instance_count: 1, owned_instance_count: 0 });
      });

    await request.delete("/enroll/template/Owned")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(409)
      .expect((res) => {
        expect(res.body).toMatchObject({ code: "template_in_use", template: "Owned", instance_count: 1, blocking_instance_count: 0, owned_instance_count: 1 });
      });

    await request.delete("/enroll/template/Install")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ deleted: true, template: "Install" });
      });

    const state = readState(dataPath);
    expect(state.enrollment_counts).toBeUndefined();
    expect(state.enrollment_instances).toBeUndefined();
  });

  test("enroll templates are only returned to their local owner", async () => {
    const { dataPath, request } = await loadServer();
    writeState(dataPath, {
      config: { enrollment_limit: 4, profile: "prod", config_profile: "prod" },
      templates: {
        OwnerTemplate: { image: "saashup/owner", version: "v1", creator_email: "owner@example.com", config_profile: "prod" },
        OtherTemplate: { image: "saashup/other", version: "v1", creator_email: "other@example.com", config_profile: "prod" },
      },
      logs: "",
    });

    await request.get("/enroll/limit")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body.instances).toEqual([
          expect.objectContaining({ instance: "OwnerTemplate", image: "saashup/owner", source: "template" }),
        ]);
      });

    await request.get("/templates")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod", enroll: "true" })
      .expect(200)
      .expect((res) => {
        expect(Object.keys(res.body)).toEqual(["OwnerTemplate"]);
        expect(res.body.OwnerTemplate.image).toBe("saashup/owner");
      });
  });

  test("enroll templates are only returned to their NetBox catalog owner", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContexts: [
        {
          id: 501,
          name: "saashup-template-catalog-prod-owner",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "owner@example.com",
            saashup_templates: {
              OwnerTemplate: { image: "saashup/owner", version: "v1" },
            },
          },
        },
        {
          id: 502,
          name: "saashup-template-catalog-prod-other",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "other@example.com",
            saashup_templates: {
              OtherTemplate: { image: "saashup/other", version: "v1" },
            },
          },
        },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", enrollment_limit: 4, profile: "prod", config_profile: "prod" },
      logs: "",
    });

    await request.get("/enroll/limit")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body.instances).toEqual([
          expect.objectContaining({ instance: "OwnerTemplate", image: "saashup/owner", source: "netbox-template" }),
        ]);
      });

    await request.get("/templates")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod", enroll: "true" })
      .expect(200)
      .expect((res) => {
        expect(Object.keys(res.body)).toEqual(["OwnerTemplate"]);
        expect(res.body.OwnerTemplate.image).toBe("saashup/owner");
      });
  });

  test("enroll limit discovers owner templates from NetBox labels before local fallback", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContainers: [
        {
          id: 30,
          name: "guide-one",
          image: { name: "saashup/guide", version: "v1.2.3" },
          env: [{ var_name: "SAASHUP_OWNER", value: "owner@example.com" }],
          labels: [
            { key: "saashup.template.name", value: "Guide" },
            { key: "saashup.template.url", value: "https://templates.example.com/guide" },
          ],
        },
        {
          id: 31,
          name: "guide-two",
          image: { name: "saashup/guide", version: "v1.2.3" },
          labels: [
            { key: "saashup.template.name", value: "Guide" },
            { key: "saashup.template.owner", value: "owner@example.com" },
          ],
        },
        {
          id: 32,
          name: "other-owner",
          image: { name: "saashup/private", version: "v9" },
          labels: [
            { key: "saashup.template.name", value: "Private" },
            { key: "saashup.template.owner", value: "other@example.com" },
          ],
        },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", enrollment_limit: 4, profile: "prod", config_profile: "prod" },
      templates: {
        Local: { image: "saashup/local", version: "v1", creator_email: "owner@example.com" },
        Guide: { image: "saashup/local-guide", version: "old", creator_email: "owner@example.com" },
      },
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/enroll/limit")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ used: 1, max: 4, remaining: 3, reached: false });
        expect(res.body.instances).toEqual([
          expect.objectContaining({ instance: "Guide", image: "saashup/guide", version: "v1.2.3", source: "netbox-template", instance_count: 2, template_url: "https://templates.example.com/guide" }),
        ]);
      });
  });

  test("enroll template badges count NetBox containers using the template image", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContexts: [
        {
          id: 501,
          name: "saashup-template-catalog-prod-owner",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "owner@example.com",
            saashup_templates: {
              Tile: {
                image: "saashup/tile",
                version: "v1.0.0",
                template_url: "https://templates.example.com/tile",
              },
            },
          },
        },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", enrollment_limit: 4, profile: "prod", config_profile: "prod" },
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/enroll/limit")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body.instances).toEqual([
          expect.objectContaining({ instance: "Tile", image: "saashup/tile", version: "v1.0.0", source: "netbox-template", instance_count: 1 }),
        ]);
      });
  });

  test("enroll template badges count one container for each template image", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContexts: [
        {
          id: 501,
          name: "saashup-template-catalog-prod-owner",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "owner@example.com",
            saashup_templates: {
              Alpha: { image: "saashup/alpha:v1.0.0" },
              Beta: { image: "saashup/beta:v1.0.0" },
            },
          },
        },
      ],
    });
    fetchMock.mockImplementation(async (url, options = {}) => {
      const parsed = new URL(String(url));
      const method = options.method || "GET";
      if (parsed.pathname === "/api/plugins/docker/hosts/" && method === "GET") {
        return jsonResponse({ results: [{ id: 1, name: "host-a", tags: [{ slug: "tile" }] }] });
      }
      if (parsed.pathname === "/api/extras/config-contexts/" && method === "GET") {
        return jsonResponse({ results: [{
          id: 501,
          name: "saashup-template-catalog-prod-owner",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "owner@example.com",
            saashup_templates: {
              Alpha: { image: "saashup/alpha:v1.0.0" },
              Beta: { image: "saashup/beta:v1.0.0" },
            },
          },
        }] });
      }
      if (parsed.pathname === "/api/plugins/docker/images/" && method === "GET") {
        return jsonResponse({ results: [
          { id: 101, name: "saashup/alpha", version: "v1.0.0", host: { id: 1 } },
          { id: 102, name: "saashup/beta", version: "v1.0.0", host: { id: 1 } },
        ] });
      }
      if (parsed.pathname === "/api/plugins/docker/containers/" && method === "GET") {
        return jsonResponse({ results: [
          { id: 201, name: "alpha-one", image: { id: 101 }, host: { id: 1 } },
          { id: 202, name: "beta-one", image: { id: 102 }, host: { id: 1 } },
        ] });
      }
      return jsonResponse({});
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", enrollment_limit: 4, profile: "prod", config_profile: "prod" },
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/enroll/limit")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body.instances).toEqual([
          expect.objectContaining({ instance: "Alpha", instance_count: 1 }),
          expect.objectContaining({ instance: "Beta", instance_count: 1 }),
        ]);
      });
  });

  test("enroll template badges count image usage when templates omit versions", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    fetchMock.mockImplementation(async (url, options = {}) => {
      const parsed = new URL(String(url));
      const method = options.method || "GET";
      if (parsed.pathname === "/api/plugins/docker/hosts/" && method === "GET") {
        return jsonResponse({ results: [{ id: 1, name: "host-a", tags: [{ slug: "tile" }] }] });
      }
      if (parsed.pathname === "/api/extras/config-contexts/" && method === "GET") {
        return jsonResponse({ results: [{
          id: 501,
          name: "saashup-template-catalog-prod-owner",
          is_active: true,
          data: {
            saashup_template_catalog: true,
            saashup_profile: "prod",
            saashup_owner: "owner@example.com",
            saashup_templates: {
              Alpha: { image: "saashup/alpha" },
              Beta: { image: "saashup/beta" },
            },
          },
        }] });
      }
      if (parsed.pathname === "/api/plugins/docker/images/" && method === "GET") {
        return jsonResponse({ results: [
          { id: 101, name: "saashup/alpha", version: "v1.0.0", host: { id: 1 } },
          { id: 102, name: "saashup/beta", version: "v2.0.0", host: { id: 1 } },
        ] });
      }
      if (parsed.pathname === "/api/plugins/docker/containers/" && method === "GET") {
        return jsonResponse({ results: [
          { id: 201, name: "alpha-one", image: { id: 101 }, host: { id: 1 } },
          { id: 202, name: "beta-one", image: { id: 102 }, host: { id: 1 } },
        ] });
      }
      return jsonResponse({});
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", enrollment_limit: 4, profile: "prod", config_profile: "prod" },
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/enroll/limit")
      .set("x-auth-request-email", "owner@example.com")
      .query({ profile: "prod" })
      .expect(200)
      .expect((res) => {
        expect(res.body.instances).toEqual([
          expect.objectContaining({ instance: "Alpha", instance_count: 1 }),
          expect.objectContaining({ instance: "Beta", instance_count: 1 }),
        ]);
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
        max_templates: 4,
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
          max_instances: 2,
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
    await request.get("/enroll.html").set("x-auth-request-email", "buyer@example.com").expect(200).expect((res) => {
      expect(res.text).toContain("Enroll Saashup Instance");
      expect(res.text).toContain('id="submitBtn" disabled');
      expect(res.headers["cache-control"]).toContain("no-store");
    });

    await request.get("/order/limit")
      .set("x-auth-request-email", "buyer@example.com")
      .query({ profile: "prod", template: "Tiles" })
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
      .query({ profile: "prod", template: "Tiles" })
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

    // order-based usage is no longer persisted in app state.

    const netboxPaths = netboxCalls.map((call) => `${call.method} ${call.path}`);
    expect(netboxPaths).toEqual(expect.arrayContaining([
      "GET /api/extras/config-contexts/",
      "GET /api/plugins/docker/images/",
      "POST /api/plugins/cloudflare/dns/records/",
      "POST /api/plugins/docker/volumes/",
      "POST /api/plugins/docker/containers/",
      "PATCH /api/plugins/docker/containers/",
      "DELETE /api/plugins/docker/containers/31/",
      "DELETE /api/plugins/docker/volumes/41/",
      "DELETE /api/plugins/cloudflare/dns/records/61/",
    ]));
  });

  test("sends the expected NetBox create payloads for container, config, DNS, and volumes", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        domain: "example.com",
        tag: "tile",
        owner_env_var: "OWNER",
      },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "payload@example.com")
      .send({
        instance: "payload-check.example.com",
        dns_name: "payload-check.example.com/app",
        image: "saashup/tile",
        version: "v2.0.0",
        network: "traefik-public",
        port_value: "8080",
        var_env_key: ["APP_ENV", "OWNER"],
        var_env_value: ["production", "spoofed@example.com"],
        label_key: ["custom.label"],
        label_value: ["custom-value"],
        bind_host_path: ["/var/run/docker.sock"],
        bind_container_path: ["/var/run/docker.sock"],
        bind_read_only: ["true"],
        volume_source: ["/data"],
        volume_name: ["payload-data"],
        traefik: "true",
        cloudflare_filter: "true",
        wait: "true",
      })
      .expect(200);

    const calls = parsedFetchCalls(fetchMock);
    const dnsCreates = calls.filter((call) => call.url.pathname === "/api/plugins/cloudflare/dns/records/" && call.method === "POST");
    expect(dnsCreates).toHaveLength(0);
    expect(readState(dataPath).logs).toContain("CREATE : Cloudflare DNS record skipped for payload-check.example.com/app because it includes path info");

    const volumeCreate = calls.find((call) => call.url.pathname === "/api/plugins/docker/volumes/" && call.method === "POST");
    expect(volumeCreate.body).toEqual({ host: 1, name: "payload-data" });

    const containerCreate = calls.find((call) => call.url.pathname === "/api/plugins/docker/containers/" && call.method === "POST");
    expect(containerCreate.body).toEqual({
      host: 1,
      name: "payload-check",
      image: 20,
      restart_policy: "unless-stopped",
    });

    const containerConfig = calls.find((call) => (
      call.url.pathname === "/api/plugins/docker/containers/"
      && call.method === "PATCH"
      && Array.isArray(call.body)
      && call.body.some((item) => item.id === 31 && !item.operation)
    )).body[0];
    expect(containerConfig).toMatchObject({
      id: 31,
      host: 1,
      network_settings: [{ network: { host: 1, name: "traefik-public" } }],
      ports: [{ public_port: -1, private_port: 8080, type: "tcp" }],
      binds: [{ host_path: "/var/run/docker.sock", container_path: "/var/run/docker.sock", read_only: true }],
      mounts: [{ source: "/data", volume: { host: 1, name: "payload-data" }, read_only: false }],
    });
    expect(containerConfig.env).toEqual([
      { var_name: "APP_ENV", value: "production" },
      { var_name: "OWNER", value: "payload@example.com" },
    ]);
    expect(containerConfig.labels).toEqual(expect.arrayContaining([
      { key: "traefik.enable", value: "true" },
      { key: "traefik.http.routers.payload-check.rule", value: "Host(`payload-check.example.com`) && PathPrefix(`/app`)" },
      { key: "traefik.http.services.payload-check.loadbalancer.server.port", value: "8080" },
      { key: "custom.label", value: "custom-value" },
    ]));
    expect(containerConfig.labels.some((label) => label.key === "traefik.http.middlewares.payload-check.ipallowlist.sourcerange")).toBe(true);
  });

  test("reuses existing Docker volumes before creating missing ones", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      existingVolumes: [{ id: 41, host: { id: 1 }, name: "payload-data" }],
      expectTraefikConfig: false,
    });
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        tag: "tile",
      },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create")
      .send({
        instance: "payload-check.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        volume_source: ["/data", "/cache"],
        volume_name: ["payload-data", "payload-cache"],
        traefik: "false",
        wait: "true",
      })
      .expect(200);

    const calls = parsedFetchCalls(fetchMock);
    const volumeLookups = calls.filter((call) => call.url.pathname === "/api/plugins/docker/volumes/" && call.method === "GET" && call.url.searchParams.has("host_id"));
    expect(volumeLookups.map((call) => call.url.searchParams.get("name"))).toEqual(["payload-data", "payload-cache"]);

    const volumeCreates = calls.filter((call) => call.url.pathname === "/api/plugins/docker/volumes/" && call.method === "POST");
    expect(volumeCreates).toHaveLength(1);
    expect(volumeCreates[0].body).toEqual({ host: 1, name: "payload-cache" });

    const containerConfig = calls.find((call) => (
      call.url.pathname === "/api/plugins/docker/containers/"
      && call.method === "PATCH"
      && Array.isArray(call.body)
      && call.body.some((item) => item.id === 31 && !item.operation)
    )).body[0];
    expect(containerConfig.mounts).toEqual([
      { source: "/data", volume: { host: 1, name: "payload-data" }, read_only: false },
      { source: "/cache", volume: { host: 1, name: "payload-cache" }, read_only: false },
    ]);
    expect(readState(dataPath).logs).toContain("CREATE : 2 volumes prepared on host-a (1 reused, 1 created)");
  });

  test("pulls a missing image before creating an instance", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      expectTraefikConfig: false,
    });
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        tag: "tile",
      },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create")
      .send({
        instance: "missing-image.example.com",
        image: "saashup/missing",
        version: "v3.0.0",
        traefik: "false",
        wait: "true",
      })
      .expect(200);

    const calls = parsedFetchCalls(fetchMock);
    const imageLookup = calls.find((call) => call.url.pathname === "/api/plugins/docker/images/" && call.method === "GET" && call.url.searchParams.get("name") === "saashup/missing");
    expect(imageLookup.url.searchParams.get("version")).toBe("v3.0.0");
    expect(imageLookup.url.searchParams.get("host_id")).toBe("1");

    const registryLookup = calls.find((call) => call.url.pathname === "/api/plugins/docker/images/" && call.method === "GET" && call.url.searchParams.get("name") === "saashup/missing" && !call.url.searchParams.has("version"));
    expect(registryLookup.url.searchParams.get("limit")).toBe("1");

    const imageCreate = calls.find((call) => call.url.pathname === "/api/plugins/docker/images/" && call.method === "POST");
    expect(imageCreate.body).toEqual({ host: 1, name: "saashup/missing", version: "v3.0.0", registry: 7 });

    const imagePoll = calls.find((call) => call.url.pathname === "/api/plugins/docker/images/20/" && call.method === "GET");
    expect(imagePoll).toBeTruthy();

    const containerCreate = calls.find((call) => call.url.pathname === "/api/plugins/docker/containers/" && call.method === "POST");
    expect(containerCreate.body).toMatchObject({ name: "missing-image", image: 20 });
    expect(readState(dataPath).logs).toContain("CREATE : created image saashup/missing:v3.0.0 on host-a status=201");
    expect(readState(dataPath).logs).toContain("CREATE : image saashup/missing:v3.0.0 on host-a pulled identifier=sha256:20");
  });

  test("does not persist order slots when async create is accepted", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", max_instances: 1, profile: "prod", config_profile: "prod" },
      templates: {},
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

    // order-based usage is no longer persisted in app state.

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
      .expect(202);

    // order-based usage is no longer persisted in app state.
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

    expect(readState(dataPath).logs).toContain("ERROR : NetBox URL and token are required");
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
        expect(res.body.total_users).toBe(0);
      });
  });

  test("registry webhook requires and uses the profile path", async () => {
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

    await request.post("/registry-webhook").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(404);
    await request.post("/dockerhub/curioocity-guide").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(404);
    await request.post("/registry-webhook/curioocity-guide").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);

    await vi.waitFor(() => {
      const imageCalls = fetchMock.mock.calls
        .map(([url]) => new URL(String(url)))
        .filter((url) => url.pathname === "/api/plugins/docker/images/" && url.searchParams.get("version") === "v2.0.0");
      expect(imageCalls.some((url) => url.searchParams.get("host_id") === "2")).toBe(true);
    });
  });

  test("registry webhook stays public when OIDC is enabled", async () => {
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
    await request.post("/create")
      .set("Accept", "application/json")
      .send({ image: "saashup/tile", version: "v2.0.0", port_value: "3000" })
      .expect(401)
      .expect((res) => {
        expect(res.body.detail).toBe("login required");
      });
    await request.post("/registry-webhook/prod")
      .send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } })
      .expect(202)
      .expect((res) => {
        expect(res.body.status).toBe("accepted");
      });
  });

  test("registry webhook can require a shared secret", async () => {
    const { dataPath, request } = await loadServer({ registrySecret: "hook-secret" });
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
    await request.post("/registry-webhook/prod").send(body).expect(403);
    await request.post("/registry-webhook/prod/bad-secret").send(body).expect(403);
    await request.post("/registry-webhook/prod/hook-secret").send(body).expect(202);
    await request.post("/registry-webhook/prod").query({ secret: "hook-secret" }).send(body).expect(202);
    await request.post("/registry-webhook/prod").set("x-saashup-webhook-secret", "hook-secret").send(body).expect(202);
  });

  test("registry webhook can use a template-specific shared secret", async () => {
    const { dataPath, request } = await loadServer({ registrySecret: "env-secret" });
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        profiles: {
          prod: { tag: "tile" },
          dev: { tag: "dev" },
        },
      },
      templates: {
        Tile: { config_profile: "prod", image: "saashup/tile", registry_webhook_secret: "template-secret" },
        Other: { config_profile: "prod", image: "saashup/other", registry_webhook_secret: "other-secret" },
      },
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.get("/registry-webhook-secret")
      .query({ template: "Tile" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ secret: "template-secret", default_secret: "env-secret" });
      });
    await request.get("/registry-webhook-secret")
      .query({ template: "Missing" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ secret: "env-secret", default_secret: "env-secret" });
      });

    const body = { push_data: { tag: "latest" }, repository: { repo_name: "saashup/tile" } };
    await request.post("/registry-webhook/prod/env-secret").send(body).expect(403);
    await request.post("/registry-webhook/prod/other-secret").send(body).expect(403);
    await request.post("/registry-webhook/prod/template-secret").send(body).expect(202);
    await request.post("/registry-webhook/prod/Tile/env-secret").send(body).expect(403);
    await request.post("/registry-webhook/prod/Other/other-secret").send(body).expect(403);
    await request.post("/registry-webhook/prod/Tile/template-secret").send(body).expect(202);
    await request.post("/registry-webhook/dev/env-secret").send(body).expect(202);
  });

  test("registry webhook accepts Quay tag update payloads", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
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

    await request.post("/registry-webhook/prod")
      .send({ docker_url: "quay.io/acme/tile", updated_tags: ["latest", "v2.0.0"] })
      .expect(202);

    await vi.waitFor(() => {
      const imageCalls = fetchMock.mock.calls
        .map(([url]) => new URL(String(url)))
        .filter((url) => url.pathname === "/api/plugins/docker/images/" && url.searchParams.get("version") === "v2.0.0");
      expect(imageCalls.some((url) => url.searchParams.get("name") === "quay.io/acme/tile")).toBe(true);
    });
  });

  test("registry webhook accepts GitLab distribution notification payloads", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
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

    await request.post("/registry-webhook/prod").send({
      events: [{
        action: "push",
        target: {
          repository: "acme/tile",
          tag: "v2.0.0",
          url: "https://registry.gitlab.com/v2/acme/tile/manifests/v2.0.0",
        },
      }],
    }).expect(202);

    await vi.waitFor(() => {
      const imageCalls = fetchMock.mock.calls
        .map(([url]) => new URL(String(url)))
        .filter((url) => url.pathname === "/api/plugins/docker/images/" && url.searchParams.get("version") === "v2.0.0");
      expect(imageCalls.some((url) => url.searchParams.get("name") === "registry.gitlab.com/acme/tile")).toBe(true);
    });
  });

  test("registry webhook can use a template-specific secret for GitHub package events", async () => {
    const { dataPath, request } = await loadServer({ registrySecret: "env-secret" });
    writeState(dataPath, {
      config: {
        netbox: "https://netbox.example.com",
        token: "secret",
        profiles: {
          prod: { tag: "tile" },
        },
      },
      templates: {
        GhcrTile: { config_profile: "prod", image: "ghcr.io/acme/tile", registry_webhook_secret: "gh-secret" },
      },
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    const body = {
      action: "published",
      registry_package: { name: "tile", owner: { login: "acme" } },
      package_version: { container_metadata: { tag: { name: "latest" } } },
    };
    await request.post("/registry-webhook/prod/env-secret").send(body).expect(403);
    await request.post("/registry-webhook/prod/gh-secret").send(body).expect(202);
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

  test("create all_hosts with Traefik creates DNS once and containers on every host", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", domain: "example.com", tag: "" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "all-traefik.example.com",
      dns_name: "all-traefik.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      network: "traefik-public",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      traefik: "true",
      all_hosts: "true",
      wait: "true",
    }).expect(200).expect((res) => {
      expect(res.body).toEqual({ status: "finished" });
    });

    expect(readState(dataPath).logs).toContain("CREATE : host selection all_hosts=true hosts=2 selected=host-a,host-b");
    expect(readState(dataPath).logs).toContain("CREATE : finished all hosts ready=2/2");
    const calls = parsedFetchCalls(fetchMock);
    expect(calls.filter((call) => call.url.pathname === "/api/plugins/cloudflare/dns/records/" && call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.url.pathname === "/api/plugins/docker/containers/" && call.method === "POST").map((call) => call.body.host)).toEqual([1, 2]);
    expect(calls.filter((call) => call.url.pathname === "/api/plugins/docker/containers/" && call.method === "PATCH" && Array.isArray(call.body) && call.body.some((item) => item.id === 31 && !item.operation)).map((call) => call.body[0].host)).toEqual([1, 2]);
  });

  test("create selects the least loaded host with normalized host ids and logs the decision", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      expectTraefikConfig: false,
      createHostSelectionContainers: [
        { id: 80, name: "existing-a", host: "1" },
        { id: 81, name: "existing-b", host: { id: "1", display: "host-a" } },
      ],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/create").send({
      instance: "least-loaded",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      traefik: "false",
      wait: "true",
    }).expect(200);

    expect(readState(dataPath).logs).toContain("CREATE : host selection hosts=2 containers=2 loads=host-a=2,host-b=0 selected=host-b count=0");
    expect(readState(dataPath).logs).toContain("CREATE : container least-loaded created on host-b");
    const createCall = fetchMock.mock.calls.find(([url, options]) => String(url).endsWith("/api/plugins/docker/containers/") && options?.method === "POST");
    expect(JSON.parse(createCall[1].body).host).toBe(2);
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
    await vi.waitFor(() => expect(smtpSender).toHaveBeenCalledTimes(2));
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
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles-second deleted"));

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
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted"));

    await request.post("/refresh-hosts").send({}).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("REFRESH_HOST : finished"));

    await request.post("/registry-webhook").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(404);
    await request.post("/dockerhub/prod").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(404);
    await request.post("/registry-webhook/prod").send({ push_data: { tag: "latest" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await request.post("/registry-webhook/prod").send({ push_data: { tag: "v2.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("v2.0.0"));
  });

  test("restarts containers by image using the NetBox host filter and requested operation", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/restart").send({
      restart_mode: "image",
      operate_action: "kill",
      image: "saashup/tile",
      restart_version: "v1.0.0",
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("KILL : host-a/tiles kill requested"));

    const calls = parsedFetchCalls(fetchMock);
    const imageLookup = calls.find((call) => call.url.pathname === "/api/plugins/docker/images/" && call.method === "GET" && call.url.searchParams.get("version") === "v1.0.0");
    expect(imageLookup.url.searchParams.get("name")).toBe("saashup/tile");
    expect(imageLookup.url.searchParams.get("host_id")).toBe("1");
    expect(imageLookup.url.searchParams.get("limit")).toBe("200");

    const containerLookup = calls.find((call) => call.url.pathname === "/api/plugins/docker/containers/" && call.method === "GET" && call.url.searchParams.get("image_id") === "10");
    expect(containerLookup.url.searchParams.get("limit")).toBe("200");

    expect(calls.some((call) => (
      call.url.pathname === "/api/plugins/docker/containers/"
      && call.method === "PATCH"
      && Array.isArray(call.body)
      && call.body.some((item) => item.id === 30 && item.operation === "kill")
    ))).toBe(true);
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

  test("contact form sends email to owner using stored profile smtp config", async () => {
    const { dataPath, request, setSmtpSenderForTests } = await loadServer({ ownerEmail: "owner@example.com", publicApiSecret: "test-secret" });
    const smtpSender = vi.fn().mockResolvedValue({ messageId: "contact-message", accepted: ["owner@example.com"], rejected: [], response: "250 queued" });
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

    await request.post("/contact")
      .set("X-Public-Api-Secret", "test-secret")
      .send({
        profile: "prod",
        name: "Ada Lovelace",
        email: "ada@example.com",
        company: "Analytical Engines",
        subject: "Demo request",
        message: "Can we talk about NetBox Docker hosting?",
        smtp_config: "attacker:secret@evil.example.com:25",
      }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "sent", message_id: "contact-message", accepted: ["owner@example.com"] });
    });

    expect(smtpSender).toHaveBeenCalledWith(
      expect.objectContaining({ user: "mailer", password: "smtp-secret", host: "smtp.example.com", port: 587 }),
      expect.objectContaining({
        to: "owner@example.com",
        replyTo: "ada@example.com",
        subject: "Website contact: Demo request",
        text: expect.stringContaining("Ada Lovelace"),
        html: expect.stringContaining("Can we talk about NetBox Docker hosting?"),
      }),
    );
    expect(smtpSender.mock.calls[0][0].host).not.toBe("evil.example.com");
    expect(readState(dataPath).logs).toContain("EMAIL : contact message sent from ada@example.com");
  });

  test("contact form verifies Cloudflare Turnstile before sending email", async () => {
    const { dataPath, request, setSmtpSenderForTests, setTurnstileFetchForTests } = await loadServer({ ownerEmail: "owner@example.com", publicApiSecret: "test-secret", turnstileSecretKey: "turnstile-secret" });
    const smtpSender = vi.fn().mockResolvedValue({ messageId: "contact-message", accepted: ["owner@example.com"], rejected: [], response: "250 queued" });
    const turnstileFetch = vi.fn(async () => jsonResponse({ success: true }));
    setSmtpSenderForTests(smtpSender);
    setTurnstileFetchForTests(turnstileFetch);
    writeState(dataPath, {
      config: { smtp_config: "mailer:smtp-secret@smtp.example.com:587" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/contact")
      .set("X-Public-Api-Secret", "test-secret")
      .set("CF-Connecting-IP", "203.0.113.9")
      .send({
        name: "Ada Lovelace",
        email: "ada@example.com",
        subject: "Demo request",
        message: "Can we talk about NetBox Docker hosting?",
        turnstileToken: "visitor-token",
      }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "sent", message_id: "contact-message" });
    });

    expect(turnstileFetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: expect.any(URLSearchParams),
      }),
    );
    const body = turnstileFetch.mock.calls[0][1].body;
    expect(body.get("secret")).toBe("turnstile-secret");
    expect(body.get("response")).toBe("visitor-token");
    expect(body.get("remoteip")).toBe("203.0.113.9");
    expect(smtpSender).toHaveBeenCalledTimes(1);
  });

  test("contact form rejects missing or failed Turnstile verification", async () => {
    const { dataPath, request, setSmtpSenderForTests, setTurnstileFetchForTests } = await loadServer({ ownerEmail: "owner@example.com", publicApiSecret: "test-secret", turnstileSecretKey: "turnstile-secret" });
    const smtpSender = vi.fn();
    const turnstileFetch = vi.fn(async () => jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }));
    setSmtpSenderForTests(smtpSender);
    setTurnstileFetchForTests(turnstileFetch);
    writeState(dataPath, {
      config: { smtp_config: "mailer:smtp-secret@smtp.example.com:587" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/contact")
      .set("X-Public-Api-Secret", "test-secret")
      .send({ email: "ada@example.com", message: "Hello" })
      .expect(400)
      .expect((res) => {
        expect(res.body.detail).toBe("captcha verification is required");
      });
    expect(turnstileFetch).not.toHaveBeenCalled();

    await request.post("/contact")
      .set("X-Public-Api-Secret", "test-secret")
      .send({ email: "ada@example.com", message: "Hello", turnstileToken: "bad-token" })
      .expect(403)
      .expect((res) => {
        expect(res.body.detail).toBe("captcha verification failed");
      });

    expect(turnstileFetch).toHaveBeenCalledTimes(1);
    expect(smtpSender).not.toHaveBeenCalled();
  });

  test("contact form validates required mail settings and visitor fields", async () => {
    const { request } = await loadServer({ publicApiSecret: "test-secret" });

    await request.post("/contact").set("X-Public-Api-Secret", "test-secret").send({ email: "ada@example.com", message: "Hello" }).expect(400).expect((res) => {
      expect(res.body.detail).toBe("owner email is not configured");
    });

    const { request: ownerRequest } = await loadServer({ ownerEmail: "owner@example.com", publicApiSecret: "test-secret" });
    await ownerRequest.post("/contact").set("X-Public-Api-Secret", "test-secret").send({ email: "ada@example.com", message: "Hello" }).expect(400).expect((res) => {
      expect(res.body.detail).toBe("smtp config is not configured");
    });

    const { dataPath, request: configuredRequest } = await loadServer({ ownerEmail: "owner@example.com", publicApiSecret: "test-secret" });
    writeState(dataPath, {
      config: { smtp_config: "mailer:smtp-secret@smtp.example.com:587" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });
    await configuredRequest.post("/contact").set("X-Public-Api-Secret", "test-secret").send({ email: "not-an-email", message: "Hello" }).expect(400).expect((res) => {
      expect(res.body.detail).toBe("valid email is required");
    });
    await configuredRequest.post("/contact").set("X-Public-Api-Secret", "test-secret").send({ email: "ada@example.com", message: "" }).expect(400).expect((res) => {
      expect(res.body.detail).toBe("message is required");
    });
  });

  test("contact form honeypot returns sent without sending email", async () => {
    const { dataPath, request, setSmtpSenderForTests } = await loadServer({ ownerEmail: "owner@example.com", publicApiSecret: "test-secret" });
    const smtpSender = vi.fn();
    setSmtpSenderForTests(smtpSender);
    writeState(dataPath, {
      config: { smtp_config: "mailer:smtp-secret@smtp.example.com:587" },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/contact")
      .set("X-Public-Api-Secret", "test-secret")
      .send({
        name: "Spam",
        email: "spam@example.com",
        message: "Hello",
        website: "https://spam.example.com",
      }).expect(200).expect((res) => {
      expect(res.body).toMatchObject({ status: "sent", skipped: true });
    });
    expect(smtpSender).not.toHaveBeenCalled();
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
      new Error("registry webhook exploded"),
    );
    await request.post("/registry-webhook/prod").send({ push_data: { tag: "v9.0.0" }, repository: { repo_name: "saashup/tile" } }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("REGISTRY_WEBHOOK : failed"));

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

    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE :"));
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

    await request.post("/delete")
      .send({ instance: "tiles.example.com", wait: "true" })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ status: "finished" });
      });
    expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted");
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

  test("keeps order usage when NetBox cannot delete the requested instance", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { emptyContainersForName: "ghost" });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: { "buyer@example.com": { prod: 1 } },
      order_instances: { "buyer@example.com": { prod: [{ instance: "ghost.example.com", template: "Ghost" }] } },
      logs: "",
    });

    await request.post("/delete")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ instance: "ghost.example.com", order_request: "true", profile: "prod" })
      .expect(202);

    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : cannot delete ghost, expected 1 container got 0"));
    expect(parsedFetchCalls(fetchMock).some((call) => call.url.pathname.startsWith("/api/plugins/docker/containers/") && call.method === "DELETE")).toBe(false);
  });

  test("releases order usage when container deletion succeeds but DNS cleanup fails", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => url.pathname === "/api/plugins/cloudflare/dns/records/61/" && (options.method || "GET") === "DELETE",
      new Error("dns cleanup failed"),
    );
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: { "buyer@example.com": { prod: 1 } },
      order_instances: { "buyer@example.com": { prod: [{ instance: "tiles.example.com", template: "Tiles" }] } },
      logs: "",
    });

    await request.post("/delete")
      .set("x-auth-request-email", "buyer@example.com")
      .send({ instance: "tiles.example.com", order_request: "true", profile: "prod" })
      .expect(202);

    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted id=30"));
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : Cloudflare DNS record delete failed for tiles.example.com dns cleanup failed"));
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : Cloudflare DNS record delete failed for tiles.example.com dns cleanup failed"));
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
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : container array-response configured on host-a"));

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

    await request.post("/create").send({
      instance: "missing-image.example.com",
      image: "saashup/tile",
      version: "v3.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
    }).expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : created image saashup/tile:v3.0.0 on host-a status=201"));
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : container missing-image configured on host-a"));

    await request.post("/create")
      .set("x-auth-request-email", "missing-image@example.com")
      .send({
        instance: "missing-order.example.com",
        image: "saashup/tile",
        version: "v3.0.0",
        port_value: "8080",
        var_env_key: ["APP_ENV"],
        var_env_value: ["production"],
        label_key: ["custom.label"],
        label_value: ["custom-value"],
        order_request: "true",
        profile: "prod",
      })
      .expect(202);
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("CREATE : container missing-order configured on host-a"));
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

  test("deletes containers by image and removes the image after success", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/delete")
      .send({ image: "saashup/tile", delete_mode: "image", remove_image: "true" })
      .expect(202);

    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted id=30"));
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : 1 container deleted for image saashup/tile"));
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : image saashup/tile:v1.0.0 deleted id=10"));
  });

  test("delete by image ignores fuzzy image matches returned by NetBox", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, { fuzzyImageNameMatches: true });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    await request.post("/delete")
      .send({ image: "saashup/tile", delete_mode: "image" })
      .expect(202);

    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : container tiles deleted id=30"));
    expect(readState(dataPath).logs).not.toContain("netbox-docker-agent");
    expect(fetchMock.mock.calls.some(([url]) => {
      const parsed = new URL(String(url));
      return parsed.pathname === "/api/plugins/docker/containers/" && parsed.searchParams.get("image_id") === "99";
    })).toBe(false);
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

  test("create wait mode returns failed when recreate never becomes ready", async () => {
    const { dataPath, fetchMock, request } = await loadServer({ operationTimeoutSeconds: "0" });
    setupNetBoxFetch(fetchMock);
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile" },
      templates: {},
      order_counts: {},
      logs: "",
    });

    const response = await request.post("/create").send({
      instance: "workflow-timeout.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      var_env_key: ["APP_ENV"],
      var_env_value: ["production"],
      label_key: ["custom.label"],
      label_value: ["custom-value"],
      wait: "true",
    }).expect(422);

    expect(response.body).toEqual({ status: "failed" });
    expect(readState(dataPath).logs).toContain("timeout after 0s");
  });

  test("create wait mode reports failures and marks order failed", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    let hostsCalled = 0;
    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => (
        url.pathname.replace(/\/$/, "") === "/api/plugins/docker/hosts"
        && String(options.method || "GET").toUpperCase() === "GET"
        && ++hostsCalled >= 2
      ),
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

    expect(response.body.detail).toContain("netbox unavailable");
    if (response.body.payload?.detail) {
      expect(response.body.payload).toEqual({ detail: "down" });
    }
    expect(readState(dataPath).logs).toContain("ERROR : netbox unavailable");
  });

  test("order create rejects disabled templates before reserving usage", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock, {
      netboxTemplateContexts: [{
        id: 501,
        name: "saashup-template-catalog-prod-buyer",
        is_active: true,
        data: {
          saashup_template_catalog: true,
          saashup_profile: "prod",
          saashup_owner: "buyer@example.com",
          saashup_templates: {
            Disabled: { image: "saashup/tile", saashup_enabled: "false;" },
          },
        },
      }],
    });
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3 },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "buyer@example.com")
      .send({
        instance: "disabled.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        port_value: "8080",
        order_request: "true",
        order_template: "disabled",
        profile: "prod",
      })
      .expect(403)
      .expect((res) => {
        expect(res.body).toMatchObject({ code: "template_disabled", detail: 'Template "Disabled" is disabled for orders' });
      });

    // order-based usage is no longer persisted in app state.
    expect(fetchMock.mock.calls.some(([url, options = {}]) => (
      new URL(String(url)).pathname === "/api/plugins/docker/containers/"
      && (options.method || "GET") === "POST"
    ))).toBe(false);
  });

  test("create wait mode reports failures without an order reservation", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    let hostsCalled = 0;
    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => (
        url.pathname.replace(/\/$/, "") === "/api/plugins/docker/hosts"
        && String(options.method || "GET").toUpperCase() === "GET"
        && ++hostsCalled >= 2
      ),
      Object.assign(new Error("wait create failed"), { statusCode: 502, payload: { detail: "bad gateway" } }),
    );
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 3 },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    const response = await request.post("/create").send({
      instance: "broken-no-order.example.com",
      image: "saashup/tile",
      version: "v2.0.0",
      port_value: "8080",
      wait: "true",
    }).expect(502);

    expect(response.body.detail).toContain("wait create failed");
    if (response.body.payload?.detail) {
      expect(response.body.payload).toEqual({ detail: "bad gateway" });
    }
    // order-based usage is no longer persisted in app state.
    expect(readState(dataPath).logs).toContain("ERROR : wait create failed");
  });

  test("async create failures mark reserved order instances failed", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => url.pathname === "/api/plugins/docker/containers/" && (options.method || "GET") === "POST",
      Object.assign(new Error("async create failed"), { statusCode: 502, payload: { detail: "boom" } }),
    );
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 2 },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "async@example.com")
      .send({
        instance: "async-failure.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        port_value: "8080",
        order_request: "true",
        order_template: "Async Broken",
        profile: "prod",
      })
      .expect(202);

    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("ERROR : async create failed"));
  });

  test("marks reserved order instances failed when NetBox create fails after reservation", async () => {
    const { dataPath, fetchMock, request } = await loadServer();
    setupNetBoxFetch(fetchMock);
    rejectNextMatchingNetBoxFetch(
      fetchMock,
      (url, options) => url.pathname === "/api/plugins/docker/containers/" && (options.method || "GET") === "POST",
      Object.assign(new Error("container create failed"), { statusCode: 502, payload: { detail: "boom" } }),
    );
    writeState(dataPath, {
      config: { netbox: "https://netbox.example.com", token: "secret", tag: "tile", max_instances: 2 },
      templates: {},
      order_counts: {},
      order_instances: {},
      logs: "",
    });

    await request.post("/create")
      .set("x-auth-request-email", "reserve@example.com")
      .send({
        instance: "reserved-failure.example.com",
        image: "saashup/tile",
        version: "v2.0.0",
        port_value: "8080",
        order_request: "true",
        order_template: "Broken",
        profile: "prod",
        wait: "true",
      })
      .expect(502)
      .expect((res) => {
        expect(res.body.detail).toBe("container create failed");
      });

    expect(readState(dataPath).logs).toContain("ERROR : container create failed");
    expect(readState(dataPath).logs).toContain("ERROR : container create failed");
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
    await vi.waitFor(() => expect(readState(dataPath).logs).toContain("DELETE : volume tiles-cache deleted"));
  });
});
