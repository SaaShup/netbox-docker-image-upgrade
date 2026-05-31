const {
  asArray,
  authUserFromRequest,
  containerConfigPayloadFromForm,
  containerCreatePayloadFromForm,
  hostMatchesTag,
  imageNameFromRef,
  instanceShort,
  instanceZone,
  isContainerRunning,
  isContainerStopped,
  isOperationDone,
  isReadyContainer,
  maxInstancesValue,
  metricLabel,
  metricLine,
  operationLabel,
  parseProfiles,
  parseSmtpConfig,
  plainObject,
  routeLabel,
  sendSmtpMail,
  smtpMessage,
  smtpSenderAddress,
  smtpTransportOptions,
  statusClass,
  valueText,
  volumePayloadsFromForm,
} = require("../../server");
const nodemailer = require("nodemailer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAuthHelpers, firstHeader } = require("../../lib/auth");
const {
  cloudflareFilterEnabled,
  containerNetworkNames,
  formData,
  hostName,
  normalizedStatus,
  ownerEnvVarName,
} = require("../../lib/docker");
const { createMetrics } = require("../../lib/metrics");
const { NetBoxClient, dockerHosts, hostIdQuery, netboxAuthHeader, setNetBoxFetchForTests } = require("../../lib/netbox");
const { cookie, createOidcAuth, parseCookies, setOidcFetchForTests, userFromClaims } = require("../../lib/oidc");
const { createOperationHelpers } = require("../../lib/operations");
const { createStateStore, defaultState, readJson, writeJson } = require("../../lib/state");

function jsonResponse(payload, status = 200) {
  return {
    status,
    text: async () => JSON.stringify(payload),
  };
}

describe("server helpers", () => {
  function mockResponse() {
    const headers = {};
    return {
      body: undefined,
      headers,
      redirectUrl: "",
      statusCode: 200,
      getHeader: (name) => headers[name.toLowerCase()],
      setHeader: (name, value) => {
        headers[name.toLowerCase()] = value;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
      redirect(url) {
        this.redirectUrl = url;
        return this;
      },
      send(payload) {
        this.body = payload;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
    };
  }

  function headerValues(value) {
    return Array.isArray(value) ? value : [value];
  }

  test("normalizes profile JSON safely", () => {
    expect(parseProfiles("")).toEqual({});
    expect(parseProfiles('{"prod":{"tag":"PROD"}}')).toEqual({ prod: { tag: "PROD" } });
    expect(parseProfiles({ dev: { tag: "DEV" } })).toEqual({ dev: { tag: "DEV" } });
    expect(parseProfiles("[1,2,3]")).toEqual({});
    expect(parseProfiles("not json")).toEqual({});
  });

  test("clamps max instance values to the supported range", () => {
    expect(maxInstancesValue(undefined)).toBe(1);
    expect(maxInstancesValue("-3")).toBe(0);
    expect(maxInstancesValue("4.9")).toBe(4);
    expect(maxInstancesValue("99")).toBe(10);
  });

  test("parses simple smtp config strings", () => {
    const config = parseSmtpConfig("mailer:smtp-secret@smtp.example.com:587");
    expect(parseSmtpConfig("mailer:smtp-secret@smtp.example.com:587")).toEqual({
      user: "mailer",
      password: "smtp-secret",
      host: "smtp.example.com",
      port: 587,
      secure: false,
    });
    expect(parseSmtpConfig("mailer:smtp-secret@smtp.example.com:465")).toMatchObject({ port: 465, secure: true });
    expect(parseSmtpConfig("smtp.example.com:25")).toMatchObject({ user: "", password: "", host: "smtp.example.com", port: 25 });
    expect(parseSmtpConfig("broken")).toBeNull();
    expect(parseSmtpConfig(":587")).toBeNull();
    expect(parseSmtpConfig("smtp.example.com:not-a-port")).toBeNull();
    expect(parseSmtpConfig("smtp.example.com:70000")).toBeNull();
    expect(parseSmtpConfig("mailer@smtp.example.com:25")).toMatchObject({ user: "mailer", password: "", host: "smtp.example.com", port: 25 });
    expect(parseSmtpConfig(":secret@smtp.example.com:25")).toMatchObject({ user: "", password: "secret", host: "smtp.example.com", port: 25 });
    expect(smtpSenderAddress({ user: "mailer@example.com", host: "smtp.example.com" })).toBe("mailer@example.com");
    expect(smtpSenderAddress({ user: "mailer", host: "smtp.example.com" }, "owner@example.com")).toBe("owner@example.com");
    expect(smtpSenderAddress({ user: "mailer", host: "smtp.example.com" })).toBe("no-reply@example.com");
    expect(smtpSenderAddress({})).toBe("no-reply@localhost");
    expect(smtpSenderAddress({ host: "" })).toBe("no-reply@localhost");
    expect(smtpSenderAddress({ host: "smtp." })).toBe("no-reply@localhost");
    expect(smtpTransportOptions(config, 1234)).toMatchObject({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "mailer", pass: "smtp-secret" },
      connectionTimeout: 1234,
    });
    expect(smtpTransportOptions(parseSmtpConfig("smtp.example.com:25"), 1234)).not.toHaveProperty("auth");
    expect(smtpTransportOptions(parseSmtpConfig("mailer@smtp.example.com:25"), 1234)).toMatchObject({ auth: { user: "mailer", pass: "" } });
    expect(smtpTransportOptions(parseSmtpConfig(":secret@smtp.example.com:25"), 1234)).toMatchObject({ auth: { user: "", pass: "secret" } });
    expect(smtpMessage({
      from: "from@example.com",
      to: "to@example.com",
      cc: ["owner@example.com"],
      subject: "Subject",
      text: "Text",
      html: "<p>Text</p>",
      inlineImages: [{ cid: "logo", filename: "logo.png", contentType: "image/png", content: "abc" }],
    })).toMatchObject({
      from: "from@example.com",
      to: "to@example.com",
      cc: ["owner@example.com"],
      subject: "Subject",
      attachments: [{ cid: "logo", filename: "logo.png", contentType: "image/png", content: "abc", encoding: "base64" }],
    });
    expect(smtpMessage({
      inlineImages: [{ cid: "fallback", content: "abc" }],
    }).attachments[0]).toMatchObject({
      cid: "fallback",
      filename: "image",
      contentType: "application/octet-stream",
    });
    expect(smtpMessage({ inlineImages: null }).attachments).toEqual([]);
  });

  test("sends smtp mail through nodemailer transport", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "queued" });
    const createTransport = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail });

    await expect(sendSmtpMail(
      parseSmtpConfig("mailer:smtp-secret@smtp.example.com:587"),
      {
        to: "to@example.com",
        subject: "Subject",
        text: "Text",
        inlineImages: [{ cid: "logo", filename: "logo.png", contentType: "image/png", content: "abc" }],
      },
    )).resolves.toEqual({ messageId: "queued" });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.example.com",
      port: 587,
      requireTLS: true,
      auth: { user: "mailer", pass: "smtp-secret" },
      connectionTimeout: 10000,
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "no-reply@example.com",
      to: "to@example.com",
      subject: "Subject",
      attachments: [expect.objectContaining({ cid: "logo", encoding: "base64" })],
    }));

    createTransport.mockRestore();
  });

  test("matches docker host tags from NetBox and custom field fallbacks", () => {
    expect(hostMatchesTag({ tags: [{ name: "TILE" }] }, "tile")).toBe(true);
    expect(hostMatchesTag({ tags: [{ display: "TILE" }] }, "tile")).toBe(true);
    expect(hostMatchesTag({ tags: ["tile"] }, "tile")).toBe(true);
    expect(hostMatchesTag({ tags: [{ slug: "guide" }] }, "tile")).toBe(false);
    expect(hostMatchesTag({ tag: "tile" }, "TILE")).toBe(true);
    expect(hostMatchesTag({ role: "tile" }, "TILE")).toBe(true);
    expect(hostMatchesTag({ custom_fields: { role: "tile" } }, "TILE")).toBe(true);
    expect(hostMatchesTag({ cf: { role: "tile" } }, "TILE")).toBe(true);
    expect(hostMatchesTag({ tags: [] }, "")).toBe(true);
  });

  test("extracts image names without stripping registry ports", () => {
    expect(imageNameFromRef()).toBe("");
    expect(imageNameFromRef("registry.example.com:5000/saashup/tile-api:v2.4.1")).toBe("registry.example.com:5000/saashup/tile-api");
    expect(imageNameFromRef("saashup/tile-api")).toBe("saashup/tile-api");
  });

  test("builds create and configure container payloads from repeatable form fields", () => {
    const data = {
      instance: "tiles.example.com",
      host_id: 42,
      network: "traefik-public",
      var_env_key: ["NODE_ENV", ""],
      var_env_value: ["production", ""],
      label_key: ["traefik.http.routers.tiles.middlewares"],
      label_value: ["true"],
      port_value: ["8080"],
      volume_source: ["/app/data", ""],
      volume_name: ["tiles-data", ""],
    };

    expect(volumePayloadsFromForm(data)).toEqual([{ host: 42, name: "tiles-data" }]);
    expect(containerCreatePayloadFromForm(data, 12)).toEqual({
      host: 42,
      name: "tiles",
      image: 12,
      restart_policy: "unless-stopped",
    });
    expect(containerConfigPayloadFromForm(data, 31)).toEqual({
      id: 31,
      host: 42,
      network_settings: [{ network: { host: 42, name: "traefik-public" } }],
      ports: [{ public_port: -1, private_port: 8080, type: "tcp" }],
      env: [{ var_name: "NODE_ENV", value: "production" }],
      labels: [
        { key: "traefik.enable", value: "true" },
        { key: "traefik.http.routers.tiles.rule", value: "Host(`tiles.example.com`)" },
        { key: "traefik.http.routers.tiles.entrypoints", value: "http" },
        { key: "traefik.http.services.tiles.loadbalancer.server.port", value: "8080" },
        { key: "traefik.http.middlewares.force-https-header.headers.customrequestheaders.X-Forwarded-Proto", value: "https" },
        {
          key: "traefik.http.middlewares.tiles.ipallowlist.sourcerange",
          value: "173.245.48.0/20, 103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22, 141.101.64.0/18, 108.162.192.0/18, 190.93.240.0/20, 188.114.96.0/20, 197.234.240.0/22, 198.41.128.0/17, 162.158.0.0/15, 104.16.0.0/13, 104.24.0.0/14, 172.64.0.0/13, 131.0.72.0/22, 2400:cb00::/32, 2606:4700::/32, 2803:f800::/32, 2405:b500::/32, 2405:8100::/32, 2a06:98c0::/29, 2c0f:f248::/32",
        },
        { key: "traefik.http.routers.tiles.middlewares", value: "force-https-header" },
        { key: "traefik.http.routers.tiles.middlewares", value: "true" },
      ],
      mounts: [
        {
          source: "/app/data",
          volume: { name: "tiles-data" },
          read_only: false,
        },
      ],
    });

    expect(containerConfigPayloadFromForm({
      instance: "api.example.com",
      host_id: 7,
      label_key: ["empty.value"],
      volume_source: ["/cache"],
    }, 9)).toMatchObject({
      network_settings: [],
      ports: [],
      env: [],
      labels: expect.arrayContaining([{ key: "empty.value", value: "" }]),
      mounts: [{ source: "/cache", volume: { name: "api-data-1" }, read_only: false }],
    });

    expect(containerConfigPayloadFromForm({
      instance: "owned.example.com",
      host_id: 7,
      var_env_key: ["SAASHUP_OWNER", "APP_ENV"],
      var_env_value: ["spoofed@example.com", "production"],
      saashup_owner: "owner@example.com",
    }, 10).env).toEqual([
      { var_name: "APP_ENV", value: "production" },
      { var_name: "SAASHUP_OWNER", value: "owner@example.com" },
    ]);

    expect(ownerEnvVarName({})).toBe("SAASHUP_OWNER");
    expect(ownerEnvVarName({ owner_env_var: "OWNER" })).toBe("OWNER");
    expect(ownerEnvVarName({ owner_env_var: "   " })).toBe("SAASHUP_OWNER");
    expect(containerConfigPayloadFromForm({
      instance: "custom-owned.example.com",
      host_id: 7,
      var_env_key: ["OWNER", "SAASHUP_OWNER"],
      var_env_value: ["spoofed@example.com", "manual@example.com"],
      owner_env_var: "OWNER",
      saashup_owner: "owner@example.com",
    }, 11).env).toEqual([
      { var_name: "SAASHUP_OWNER", value: "manual@example.com" },
      { var_name: "OWNER", value: "owner@example.com" },
    ]);

    expect(cloudflareFilterEnabled({})).toBe(true);
    expect(cloudflareFilterEnabled({ cloudflare_filter: "false" })).toBe(false);
    expect(cloudflareFilterEnabled({ cloudflare_filter: ["true", "false"] })).toBe(false);
    expect(containerConfigPayloadFromForm({
      instance: "open.example.com",
      port_value: ["8080"],
      cloudflare_filter: "false",
    }, 32).labels.some((label) => label.key.endsWith(".ipallowlist.sourcerange"))).toBe(false);
  });

  test("derives route, operation, and status metric labels", () => {
    const metrics = createMetrics();
    expect(routeLabel({ originalUrl: "" })).toBe("/");
    expect(routeLabel({ originalUrl: "/admin.html?x=1" })).toBe("/admin");
    expect(routeLabel({ originalUrl: "/order.html" }, metrics)).toBe("/order");
    expect(routeLabel({ originalUrl: "/missing" })).toBe("other");
    expect(routeLabel({ originalUrl: "/dockerhub/prod" }, metrics)).toBe("/dockerhub");
    expect(operationLabel({ originalUrl: "/dockerhub/prod" }, metrics)).toBe("upgrade");
    expect(operationLabel({ originalUrl: "/missing" })).toBe("");
    expect(statusClass(201)).toBe("2xx");
    expect(statusClass("oops")).toBe("other");
  });

  test("escapes metric labels and renders metric lines", () => {
    expect(metricLabel('a"b\\c\n')).toBe('a\\"b\\\\c\\n');
    expect(metricLine("app_info", 1, { version: "1.0.0" })).toBe('app_info{version="1.0.0"} 1');
    expect(metricLine("app_info", 1)).toBe("app_info 1");
  });

  test("normalizes status and operation values from NetBox objects", () => {
    expect(valueText({ display: "Running" })).toBe("Running");
    expect(valueText({ name: "named" })).toBe("named");
    expect(valueText({ label: "labeled" })).toBe("labeled");
    expect(valueText({ value: "valued" })).toBe("valued");
    expect(valueText({})).toBe("");
    expect(valueText(null)).toBe("");
    expect(normalizedStatus(undefined, "status")).toBe("");
    expect(isContainerRunning({ state: "created", status: "created" })).toBe(false);
    expect(isContainerRunning({ state: "running", status: "created" })).toBe(true);
    expect(isContainerRunning({ state: "created", status: "running" })).toBe(true);
    expect(isContainerStopped({ state: "none", status: "unknown", operation: "none" })).toBe(true);
    expect(isContainerStopped({ state: "unknown", status: "created", operation: "none" })).toBe(true);
    expect(isContainerStopped({ state: "created", status: "created", operation: "none" })).toBe(true);
    expect(isContainerStopped({ state: "unknown", status: "exited", operation: "none" })).toBe(true);
    expect(isContainerStopped({ state: "unknown", status: "stopped", operation: "none" })).toBe(true);
    expect(isContainerStopped({ state: "running", status: "running", operation: "none" })).toBe(false);
    expect(isReadyContainer({ status: { display: "running" }, operation: { display: "none" } })).toBe(true);
    expect(isReadyContainer({ status: "running", operation: "" })).toBe(true);
    expect(isReadyContainer({ status: "running", operation: "null" })).toBe(true);
    expect(isReadyContainer({ status: "exited", operation: "none" })).toBe(false);
    expect(isOperationDone({ operation: { value: "none" } })).toBe(true);
    expect(isOperationDone({ operation: "" })).toBe(true);
    expect(isOperationDone({ operation: "null" })).toBe(true);
  });

  test("reads auth headers with local development fallback", () => {
    expect(authUserFromRequest({
      headers: {
        "x-auth-request-email": "user@example.com",
        "x-auth-request-user": "user",
      },
    })).toEqual({ email: "user@example.com", user: "user", name: "user" });
    expect(firstHeader({ headers: { "x-test": ["first", "ignored"] } }, ["x-test"])).toBe("first");
    expect(firstHeader({ headers: { "x-test": null, "x-next": "next" } }, ["x-test", "x-next"])).toBe("next");
    process.env.ENABLE_EDITOR = "1";
    const oldUser = process.env.USER;
    const oldLogname = process.env.LOGNAME;
    const oldLocalDevEmail = process.env.LOCAL_DEV_EMAIL;
    delete process.env.USER;
    delete process.env.LOGNAME;
    expect(authUserFromRequest({ headers: {} })).toEqual({ email: "", user: "Local dev", name: "Local dev" });
    process.env.LOCAL_DEV_EMAIL = "dev@example.com";
    expect(authUserFromRequest({ headers: {} })).toEqual({ email: "dev@example.com", user: "dev@example.com", name: "dev@example.com" });
    if (oldUser === undefined) delete process.env.USER;
    else process.env.USER = oldUser;
    if (oldLogname === undefined) delete process.env.LOGNAME;
    else process.env.LOGNAME = oldLogname;
    if (oldLocalDevEmail === undefined) delete process.env.LOCAL_DEV_EMAIL;
    else process.env.LOCAL_DEV_EMAIL = oldLocalDevEmail;
    delete process.env.ENABLE_EDITOR;
  });

  test("oidc helper handles disabled, json, id-token, and error branches", async () => {
    vi.useFakeTimers();
    const disabled = createOidcAuth({ enabled: false });
    const disabledRes = mockResponse();
    await disabled.login({ query: { rd: "https://evil.example.com/path" } }, disabledRes);
    expect(disabledRes.redirectUrl).toBe("/");
    const disabledDefaultRes = mockResponse();
    await disabled.login({ query: {} }, disabledDefaultRes);
    expect(disabledDefaultRes.redirectUrl).toBe("/");

    const auth = createOidcAuth({
      clientId: "saashup",
      clientSecret: "secret",
      enabled: true,
      issuerUrl: "https://id.example.com/realms/paashup/",
      redirectUri: "http://app.example.com/oidc/callback",
      secureCookies: false,
      sessionSecret: "session-secret",
    });

    const jsonRes = mockResponse();
    auth.loginRequired({ accepts: () => false, headers: {}, originalUrl: "/config" }, jsonRes, () => {});
    expect(jsonRes.statusCode).toBe(401);
    expect(jsonRes.body.login_url).toBe("/login?rd=%2Fconfig");
    const jsonDefaultRes = mockResponse();
    auth.loginRequired({ accepts: () => false, headers: {}, originalUrl: "" }, jsonDefaultRes, () => {});
    expect(jsonDefaultRes.body.login_url).toBe("/login?rd=%2F");
    const htmlRes = mockResponse();
    auth.loginRequired({ accepts: () => true, headers: {}, originalUrl: "" }, htmlRes, () => {});
    expect(htmlRes.redirectUrl).toBe("/login?rd=%2F");

    const claims = { email: "id@example.com", preferred_username: "iduser" };
    const idToken = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
    setOidcFetchForTests(vi.fn(async (url, options = {}) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/.well-known/openid-configuration")) {
        return jsonResponse({
          authorization_endpoint: "https://id.example.com/auth",
          token_endpoint: "https://id.example.com/token",
        });
      }
      if (pathname === "/token") {
        expect(options.method).toBe("POST");
        return jsonResponse({ id_token: idToken });
      }
      return jsonResponse({}, 404);
    }));

    const loginRes = mockResponse();
    await auth.login({ query: { rd: "/order" } }, loginRes);
    const state = new URL(loginRes.redirectUrl).searchParams.get("state");
    const stateCookie = headerValues(loginRes.headers["set-cookie"]).find((value) => value.startsWith("saashup_oidc_state=")).split(";")[0];
    const callbackRes = mockResponse();
    await auth.callback({ headers: { cookie: stateCookie }, query: { code: "abc", state } }, callbackRes, (error) => {
      throw error;
    });
    expect(callbackRes.redirectUrl).toBe("/order");
    const sessionCookie = headerValues(callbackRes.headers["set-cookie"]).find((value) => value.startsWith("saashup_session=")).split(";")[0];
    expect(auth.sessionUser({ headers: { cookie: sessionCookie } })).toEqual({ email: "id@example.com", user: "iduser", name: "iduser" });
    const logoutRes = mockResponse();
    auth.logout({ headers: { cookie: sessionCookie }, query: { rd: "/signed-out" } }, logoutRes);
    expect(logoutRes.redirectUrl).toBe("/signed-out");
    expect(auth.sessionUser({ headers: { cookie: sessionCookie } })).toBeNull();
    const logoutNoSessionRes = mockResponse();
    logoutNoSessionRes.headers["set-cookie"] = ["existing=1"];
    auth.logout({ headers: { cookie: "" }, query: { rd: "//evil.example.com" } }, logoutNoSessionRes);
    expect(logoutNoSessionRes.redirectUrl).toBe("/");
    expect(logoutNoSessionRes.headers["set-cookie"][0]).toBe("existing=1");

    const loginAgainRes = mockResponse();
    await auth.login({ query: { rd: "/order" } }, loginAgainRes);
    const stateAgain = new URL(loginAgainRes.redirectUrl).searchParams.get("state");
    const stateAgainCookie = headerValues(loginAgainRes.headers["set-cookie"]).find((value) => value.startsWith("saashup_oidc_state=")).split(";")[0];
    const callbackAgainRes = mockResponse();
    await auth.callback({ headers: { cookie: stateAgainCookie }, query: { code: "abc", state: stateAgain } }, callbackAgainRes, (error) => {
      throw error;
    });
    const expiringSessionCookie = headerValues(callbackAgainRes.headers["set-cookie"]).find((value) => value.startsWith("saashup_session=")).split(";")[0];
    vi.advanceTimersByTime(13 * 60 * 60 * 1000);
    expect(auth.sessionUser({ headers: { cookie: expiringSessionCookie } })).toBeNull();

    const next = vi.fn();
    await auth.callback({ headers: { cookie: stateCookie }, query: { code: "abc", state } }, mockResponse(), next);
    expect(next).not.toHaveBeenCalled();

    const invalidRes = mockResponse();
    await auth.callback({ headers: { cookie: "" }, query: {} }, invalidRes, () => {});
    expect(invalidRes.statusCode).toBe(400);

    expect(cookie("plain", "value", { httpOnly: false })).toBe("plain=value; Path=/; SameSite=Lax");
    expect(cookie("secure", "value", { maxAge: 3, secure: true })).toContain("Secure");
    expect(parseCookies("a=1; invalid; b=two")).toEqual({ a: "1", b: "two" });
    expect(userFromClaims({ email: "email@example.com" })).toEqual({ email: "email@example.com", user: "email@example.com", name: "email@example.com" });
    expect(userFromClaims({ username: "legacy" })).toEqual({ email: "", user: "legacy", name: "legacy" });
    expect(userFromClaims({ name: "Full Name", email: "named@example.com" })).toEqual({ email: "named@example.com", user: "named@example.com", name: "Full Name" });
    expect(userFromClaims({ sub: "subject" })).toEqual({ email: "", user: "subject", name: "subject" });
    setOidcFetchForTests();
    vi.useRealTimers();
  });

  test("oidc helper forwards token exchange and callback errors", async () => {
    const auth = createOidcAuth({
      clientId: "saashup",
      clientSecret: "secret",
      enabled: true,
      issuerUrl: "https://id.example.com/realms/paashup",
      redirectUri: "http://app.example.com/oidc/callback",
      secureCookies: false,
      sessionSecret: "session-secret",
    });

    setOidcFetchForTests(vi.fn(async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/.well-known/openid-configuration")) {
        return jsonResponse({
          authorization_endpoint: "https://id.example.com/auth",
          token_endpoint: "https://id.example.com/token",
        });
      }
      if (pathname === "/token") return jsonResponse({ error_description: "bad code" }, 400);
      return jsonResponse({}, 404);
    }));

    const loginRes = mockResponse();
    await auth.login({ query: { rd: "/admin" } }, loginRes);
    const state = new URL(loginRes.redirectUrl).searchParams.get("state");
    const stateCookie = headerValues(loginRes.headers["set-cookie"]).find((value) => value.startsWith("saashup_oidc_state=")).split(";")[0];
    const next = vi.fn();
    await auth.callback({ headers: { cookie: stateCookie }, query: { code: "bad", state } }, mockResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "bad code", statusCode: 400 }));

    const errorFallbackAuth = createOidcAuth({
      clientId: "saashup",
      clientSecret: "secret",
      enabled: true,
      issuerUrl: "https://id2.example.com/realms/paashup",
      redirectUri: "http://app.example.com/oidc/callback",
      secureCookies: false,
      sessionSecret: "session-secret",
    });
    setOidcFetchForTests(vi.fn(async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/.well-known/openid-configuration")) return jsonResponse({ authorization_endpoint: "https://id2.example.com/auth", token_endpoint: "https://id2.example.com/token" });
      if (pathname === "/token") return jsonResponse({ error: "invalid_grant" }, 400);
      return jsonResponse({}, 404);
    }));
    const fallbackLogin = mockResponse();
    await errorFallbackAuth.login({ query: { rd: "/admin" } }, fallbackLogin);
    const fallbackState = new URL(fallbackLogin.redirectUrl).searchParams.get("state");
    const fallbackCookie = headerValues(fallbackLogin.headers["set-cookie"]).find((value) => value.startsWith("saashup_oidc_state=")).split(";")[0];
    const fallbackNext = vi.fn();
    await errorFallbackAuth.callback({ headers: { cookie: fallbackCookie }, query: { code: "bad", state: fallbackState } }, mockResponse(), fallbackNext);
    expect(fallbackNext).toHaveBeenCalledWith(expect.objectContaining({ message: "invalid_grant", statusCode: 400 }));

    const genericErrorAuth = createOidcAuth({
      clientId: "saashup",
      clientSecret: "secret",
      enabled: true,
      issuerUrl: "https://id3.example.com/realms/paashup",
      redirectUri: "http://app.example.com/oidc/callback",
      secureCookies: false,
      sessionSecret: "session-secret",
    });
    setOidcFetchForTests(vi.fn(async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/.well-known/openid-configuration")) return jsonResponse({ authorization_endpoint: "https://id3.example.com/auth", token_endpoint: "https://id3.example.com/token" });
      if (pathname === "/token") return jsonResponse({}, 500);
      return jsonResponse({}, 404);
    }));
    const genericLogin = mockResponse();
    await genericErrorAuth.login({ query: { rd: "/admin" } }, genericLogin);
    const genericState = new URL(genericLogin.redirectUrl).searchParams.get("state");
    const genericCookie = headerValues(genericLogin.headers["set-cookie"]).find((value) => value.startsWith("saashup_oidc_state=")).split(";")[0];
    const genericNext = vi.fn();
    await genericErrorAuth.callback({ headers: { cookie: genericCookie }, query: { code: "bad", state: genericState } }, mockResponse(), genericNext);
    expect(genericNext).toHaveBeenCalledWith(expect.objectContaining({ message: "OIDC token exchange failed", statusCode: 500 }));

    const emptyClaimsAuth = createOidcAuth({
      clientId: "saashup",
      clientSecret: "secret",
      enabled: true,
      issuerUrl: "https://id4.example.com/realms/paashup",
      redirectUri: "http://app.example.com/oidc/callback",
      secureCookies: false,
      sessionSecret: "session-secret",
    });
    setOidcFetchForTests(vi.fn(async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/.well-known/openid-configuration")) return jsonResponse({ authorization_endpoint: "https://id4.example.com/auth", token_endpoint: "https://id4.example.com/token" });
      if (pathname === "/token") return jsonResponse({});
      return jsonResponse({}, 404);
    }));
    const emptyLogin = mockResponse();
    await emptyClaimsAuth.login({ query: { rd: "/admin" } }, emptyLogin);
    const emptyState = new URL(emptyLogin.redirectUrl).searchParams.get("state");
    const emptyCookie = headerValues(emptyLogin.headers["set-cookie"]).find((value) => value.startsWith("saashup_oidc_state=")).split(";")[0];
    const emptyCallback = mockResponse();
    await emptyClaimsAuth.callback({ headers: { cookie: emptyCookie }, query: { code: "ok", state: emptyState } }, emptyCallback, (error) => {
      throw error;
    });
    const emptySession = headerValues(emptyCallback.headers["set-cookie"]).find((value) => value.startsWith("saashup_session=")).split(";")[0];
    expect(emptyClaimsAuth.sessionUser({ headers: { cookie: emptySession } })).toEqual({ email: "", user: "", name: "" });

    const brokenAuth = createOidcAuth({
      clientId: "saashup",
      clientSecret: "secret",
      enabled: true,
      issuerUrl: "https://broken.example.com/realms/paashup",
      redirectUri: "http://app.example.com/oidc/callback",
      secureCookies: false,
      sessionSecret: "session-secret",
    });
    setOidcFetchForTests(vi.fn(async () => {
      throw new Error("discovery down");
    }));
    const brokenLogin = mockResponse();
    await expect(brokenAuth.login({ query: { rd: "/admin" } }, brokenLogin)).rejects.toThrow("discovery down");
    setOidcFetchForTests();
  });

  test("small value helpers keep request parsing predictable", () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
    expect(asArray("")).toEqual([]);
    expect(asArray("one")).toEqual(["one"]);
    expect(plainObject([])).toEqual({});
    expect(hostName({ host: { name: "host-a" } })).toBe("host-a");
    expect(hostName({ display: "direct-host" })).toBe("direct-host");
    expect(containerNetworkNames({ network_settings: [{ network: { name: "bridge" } }, { network: "" }, {}] })).toEqual(["bridge"]);
    expect(containerNetworkNames({ network_settings: null })).toEqual([]);
    expect(formData({ method: "GET", query: { a: 1 }, body: { a: 2 } })).toEqual({ a: 1 });
    expect(formData({ method: "POST", query: { a: 1 }, body: { a: 2 } })).toEqual({ a: 2 });
    expect(instanceShort("tiles.example.com")).toBe("tiles");
    expect(instanceShort()).toBe("");
    expect(instanceZone("tiles.example.com")).toBe("example.com");
    expect(instanceZone("tiles")).toBe("");
    expect(instanceZone()).toBe("");
  });

  test("auth helpers enforce admin lists and resolve selected profiles", () => {
    const helpers = createAuthHelpers({
      adminAllowedEmails: ["allowed@example.com"],
      readState: () => ({
        config: {
          profile: "prod",
          profiles: JSON.stringify({ prod: { tag: "prod-tag", token: "profile-token" } }),
          token: "base-token",
        },
      }),
    });

    expect(helpers.isAdminAllowed({ headers: { "x-auth-request-email": "allowed@example.com" } })).toBe(true);
    expect(helpers.isAdminAllowed({ headers: { "x-auth-request-email": "denied@example.com" } })).toBe(false);
    expect(helpers.userOrderKey({ headers: { "x-auth-request-user": "Alice" } })).toBe("alice");
    expect(helpers.userOrderKey({ headers: {}, ip: "127.0.0.1" })).toBe("127.0.0.1");
    expect(helpers.userOrderKey({ headers: {} })).toBe("anonymous");
    expect(helpers.selectedProfileConfig({ image: "app" })).toMatchObject({ profile: "prod", config_profile: "prod", tag: "prod-tag", token: "profile-token", image: "app" });
    expect(helpers.selectedProfileConfig({ profile: "missing" })).toMatchObject({ profile: "missing", config_profile: "missing", token: "base-token" });
  });

  test("state store reads, writes, migrates legacy state, and falls back safely", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "state-test-"));
    const store = createStateStore(dataPath);
    writeJson(store.legacyContextFile, {
      config: { netbox: "https://netbox.example.com" },
      templates: { app: { image: "app" } },
      order_counts: { user: { prod: 1 } },
      logs: "legacy log",
    });
    expect(store.readState()).toMatchObject({ config: { netbox: "https://netbox.example.com" }, templates: { app: { image: "app" } }, logs: "legacy log" });
    store.writeState((state) => {
      state.config = { saved: true };
    });
    expect(store.readState().config).toEqual({ saved: true });
    store.writeState({ templates: { direct: true } });
    expect(store.readState().templates).toEqual({ direct: true });
    store.logLine("hello");
    expect(store.readState().logs).toContain("hello<br>");

    const invalidPath = fs.mkdtempSync(path.join(os.tmpdir(), "state-invalid-"));
    const invalidStore = createStateStore(invalidPath);
    writeJson(invalidStore.legacyContextFile, []);
    expect(invalidStore.readState()).toEqual(defaultState());
    expect(readJson(path.join(invalidPath, "missing.json"), { fallback: true })).toEqual({ fallback: true });
  });

  test("NetBox client handles query params, payload shapes, and errors", async () => {
    const calls = [];
    setNetBoxFetchForTests(async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/text")) return { status: 200, text: async () => "plain text" };
      if (String(url).includes("/bad")) return { status: 500, text: async () => '{"detail":"bad"}' };
      if (String(url).includes("/array")) return { status: 200, text: async () => '[{"id":1}]' };
      if (String(url).includes("/empty")) return { status: 200, text: async () => "" };
      return { status: 200, text: async () => '{"results":[{"id":2}]}' };
    });

    await expect(new NetBoxClient({}).request("GET", "/api/status/")).rejects.toMatchObject({ statusCode: 400 });
    const client = new NetBoxClient({ netbox: "https://netbox.example.com/", token: "secret" });
    await expect(client.list("/api/items/", { id: [1, "", null, 2] })).resolves.toEqual([{ id: 2 }]);
    expect(calls.at(-1).url).toContain("id=1");
    expect(calls.at(-1).url).toContain("id=2");
    expect(calls.at(-1).options.headers.Authorization).toBe("Token secret");
    await expect(client.request("POST", "/api/empty", { body: { ok: true }, expected: [200] })).resolves.toMatchObject({ payload: {} });
    expect(calls.at(-1).options.headers["Content-Type"]).toBe("application/json");
    expect(netboxAuthHeader()).toBe("Token ");
    expect(netboxAuthHeader(" nbt_key ")).toBe("Token nbt_key");
    expect(netboxAuthHeader(" nbt_key.plaintext ")).toBe("Bearer nbt_key.plaintext");
    const v2Client = new NetBoxClient({ netbox: "https://netbox.example.com/", token: " nbt_key.plaintext " });
    await expect(v2Client.request("GET", "/api/items/")).resolves.toMatchObject({ statusCode: 200 });
    expect(calls.at(-1).options.headers.Authorization).toBe("Bearer nbt_key.plaintext");
    await expect(client.request("GET", "/api/text")).resolves.toMatchObject({ payload: "plain text" });
    await expect(client.request("GET", "/api/bad")).rejects.toMatchObject({ statusCode: 500, payload: { detail: "bad" } });
    await expect(client.list("/api/array")).resolves.toEqual([{ id: 1 }]);
    await expect(client.list("/api/empty")).resolves.toEqual([]);

    const proxyClient = new NetBoxClient({ netbox: "https://netbox.example.com", token: "secret", proxy: "http://127.0.0.1:3128" });
    await expect(proxyClient.request("GET", "/api/items/")).resolves.toMatchObject({ statusCode: 200 });
    expect(calls.at(-1).options.dispatcher).toBeTruthy();

    setNetBoxFetchForTests(async () => ({ status: 200, text: async () => '{"results":[{"id":1,"tags":[{"slug":"prod"}]}]}' }));
    await expect(dockerHosts(client, "prod")).resolves.toEqual([{ id: 1, tags: [{ slug: "prod" }] }]);
    await expect(hostIdQuery(client, "")).resolves.toEqual({});
    await expect(hostIdQuery(client, "prod")).resolves.toEqual({ host_id: [1] });
    await expect(hostIdQuery(client, "missing")).resolves.toEqual({ host_id: "__none__" });
    setNetBoxFetchForTests();
  });

  test("operation helpers cover wait, image, and DNS branches", async () => {
    vi.useFakeTimers();
    const logs = [];
    const helpers = createOperationHelpers({
      logLine: (line) => logs.push(line),
      operationPollMs: 5,
      operationTimeoutSeconds: 0.01,
    });

    const readyClient = {
      request: vi.fn(async (method, apiPath, options = {}) => {
        if (apiPath.includes("/containers/1/")) return { payload: { status: "running", operation: "none" }, statusCode: 200 };
        if (apiPath.includes("/containers/2/")) return { payload: { state: "created", status: "created", operation: "none" }, statusCode: 200 };
        if (apiPath.includes("/containers/3/")) return { payload: { state: "exited", status: "exited", operation: "none" }, statusCode: 200 };
        if (apiPath.includes("/containers/4/")) return { payload: { state: "created", operation: "none" }, statusCode: 200 };
        if (apiPath.includes("/hosts/7/")) return { payload: { operation: "none", state: "active" }, statusCode: 200 };
        if (method === "PATCH") return { payload: {}, statusCode: 202 };
        return { payload: {}, statusCode: 200 };
      }),
      list: vi.fn(async (apiPath, query) => {
        if (apiPath.includes("/images/") && query.version === "v2") return [{ id: 22, host: { id: query.host_id } }];
        if (apiPath.includes("/cloudflare/dns/accounts/")) return [{ id: 51 }];
        if (apiPath.includes("/cloudflare/dns/records/")) return [{ id: 61 }];
        return [];
      }),
    };

    await expect(helpers.waitForContainerConfigured(readyClient, 2, "host/container")).resolves.toBe(true);
    await expect(helpers.waitForContainerConfigured(readyClient, 4, "host/no-status")).resolves.toBe(true);
    await expect(helpers.waitForContainerStopped(readyClient, 3, "host/container")).resolves.toBe(true);
    await expect(helpers.waitForHostReady(readyClient, 7, "host")).resolves.toBe(true);
    await expect(helpers.requestContainerOperation(readyClient, { id: 1, host: { name: "host" }, name: "container" }, "restart", "RESTART")).resolves.toBe(true);
    await expect(helpers.ensureImageOnHost(readyClient, { host: { id: 7, display: "host" } }, "app", "v2")).resolves.toEqual({ id: 22, host: { id: 7 } });
    await expect(helpers.createDnsRecord(readyClient, { instance: "app.example.com" }, { name: "host" })).resolves.toBeUndefined();
    await expect(helpers.deleteDnsRecord(readyClient, { instance: "app.example.com" })).resolves.toBeUndefined();

    const timeoutClient = {
      request: vi.fn(async (method, apiPath) => {
        if (apiPath.includes("/containers/")) return { payload: { state: "none", status: "none", operation: "pull" }, statusCode: 200 };
        if (apiPath.includes("/hosts/")) return { payload: { operation: "refresh", state: "active" }, statusCode: 200 };
        return { payload: {}, statusCode: 200 };
      }),
    };
    const configured = helpers.waitForContainerConfigured(timeoutClient, 9, "host/pending");
    const stopped = helpers.waitForContainerStopped(timeoutClient, 9, "host/pending");
    const hostReady = helpers.waitForHostReady(timeoutClient, 9, "host");
    const operationReady = helpers.requestContainerOperation(timeoutClient, { id: 9, host: { name: "host" }, name: "pending" }, "restart", "RESTART");
    const stopOperation = helpers.requestContainerOperation(timeoutClient, { id: 9, host: { name: "host" }, name: "pending" }, "stop", "STOP");
    await vi.advanceTimersByTimeAsync(20);
    await expect(configured).resolves.toBe(false);
    await expect(stopped).resolves.toBe(false);
    await expect(hostReady).resolves.toBe(false);
    await expect(operationReady).resolves.toBe(false);
    await expect(stopOperation).resolves.toBe(false);

    const createImageClient = {
      list: vi.fn(async () => []),
      request: vi.fn(async (method, apiPath) => {
        if (method === "GET" && apiPath === "/api/plugins/docker/images/99/") return { payload: { id: 99, Digest: "sha256:abc" }, statusCode: 200 };
        return { payload: [{ id: 99 }], statusCode: 201 };
      }),
    };
    await expect(helpers.ensureImageOnHost(createImageClient, { host: 8, registry: 4 }, "app", "v3")).resolves.toEqual({ id: 99, Digest: "sha256:abc" });
    expect(helpers.imagePullIdentifier({ imageID: "sha256:id" })).toBe("sha256:id");
    expect(helpers.imagePullIdentifier({ repoDigest: ["app@sha256:def"] })).toEqual(["app@sha256:def"]);
    await expect(helpers.waitForImagePulled({ request: vi.fn() }, { id: 101, imageID: "sha256:ready" }, "app:v5 on host-c")).resolves.toEqual({ id: 101, imageID: "sha256:ready" });
    await expect(helpers.waitForImagePulled({ request: vi.fn() }, {}, "app:v6 on host-c")).rejects.toThrow("created without an id");
    await expect(helpers.waitForImagePulled({
      request: vi.fn(async () => ({ payload: { id: 102, repoDigest: ["app@sha256:def"] }, statusCode: 200 })),
    }, { id: 102 }, "app:v7 on host-d")).resolves.toEqual({ id: 102, repoDigest: ["app@sha256:def"] });

    const pendingImageClient = {
      list: vi.fn(async () => []),
      request: vi.fn(async (method, apiPath) => {
        if (method === "GET" && apiPath === "/api/plugins/docker/images/100/") return { payload: { id: 100, Digest: "" }, statusCode: 200 };
        return { payload: { id: 100 }, statusCode: 202 };
      }),
    };
    const pendingImage = helpers.ensureImageOnHost(pendingImageClient, { host: { id: 8, name: "host-b" } }, "app", "v4");
    const pendingImageExpectation = expect(pendingImage).rejects.toThrow("image app:v4 on host-b was not pulled after 0.01s");
    await vi.advanceTimersByTimeAsync(20);
    await pendingImageExpectation;

    await expect(helpers.createDnsRecord(readyClient, { instance: "shortname" }, { name: "host" })).resolves.toBeUndefined();
    await expect(helpers.createDnsRecord(readyClient, { instance: "primitive.example.com" }, "primitive-host")).resolves.toBeUndefined();
    await expect(helpers.createDnsRecord({ list: vi.fn(async () => []) }, { instance: "app.missing" }, { name: "host" })).resolves.toBeUndefined();
    await expect(helpers.createDnsRecord({ list: vi.fn(async () => { throw new Error("zone down"); }) }, { instance: "app.example.com" }, { name: "host" })).resolves.toBeUndefined();
    await expect(helpers.createDnsRecord({ list: vi.fn(async () => { throw {}; }) }, { instance: "app.example.com" }, { name: "host" })).resolves.toBeUndefined();
    await expect(helpers.createDnsRecord({ list: vi.fn(async () => { throw { message: "" }; }) }, { instance: "" }, { name: "host" })).resolves.toBeUndefined();
    await expect(helpers.deleteDnsRecord({ list: vi.fn(async () => []) }, { instance: "app.example.com" })).resolves.toBeUndefined();
    await expect(helpers.deleteDnsRecord({ list: vi.fn(async () => { throw new Error("record down"); }) }, { instance: "app.example.com" })).resolves.toBeUndefined();
    await expect(helpers.deleteDnsRecord({ list: vi.fn(async () => { throw {}; }) }, { instance: "app.example.com" })).resolves.toBeUndefined();
    await expect(helpers.deleteDnsRecord({ list: vi.fn(async () => { throw { message: "" }; }) }, { instance: "" })).resolves.toBeUndefined();

    expect(logs.join("\n")).toContain("ready status=running");
    expect(logs.join("\n")).toContain("still has state=none");
    expect(logs.join("\n")).toContain("stop timeout");
    expect(logs.join("\n")).toContain("STOP : host/pending timeout");
    expect(logs.join("\n")).toContain("Cloudflare DNS record failed");
    expect(logs.join("\n")).toContain("Cloudflare DNS record delete failed");
    vi.useRealTimers();
  });
});
