const crypto = require("crypto");
const { fetch } = require("undici");

let oidcFetch = fetch;

function setOidcFetchForTests(fetchImpl) {
  oidcFetch = fetchImpl || fetch;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function parseCookies(header = "") {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index === -1) return cookies;
      cookies[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
}

function cookie(name, value, {
  httpOnly = true,
  maxAge,
  path = "/",
  sameSite = "Lax",
  secure = false,
} = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

function appendCookie(res, value) {
  const current = res.getHeader("Set-Cookie");
  if (!current) return res.setHeader("Set-Cookie", value);
  res.setHeader("Set-Cookie", Array.isArray(current) ? [...current, value] : [current, value]);
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeReturnTo(value) {
  const text = String(value || "/");
  if (!text.startsWith("/") || text.startsWith("//")) return "/";
  return text;
}

function userFromClaims(claims = {}) {
  const email = claims.email || "";
  const user = claims.preferred_username || claims.username || email || claims.sub || "";
  const name = claims.name || claims.preferred_username || user || email;
  return { user, email, name };
}

function createOidcAuth({
  clientId,
  clientSecret,
  enabled,
  issuerUrl,
  redirectUri,
  sessionSecret,
  secureCookies,
} = {}) {
  const isEnabled = Boolean(enabled && issuerUrl && clientId && clientSecret && redirectUri);
  const sessions = new Map();
  const states = new Map();
  const sessionCookie = "saashup_session";
  const stateCookie = "saashup_oidc_state";
  const secret = sessionSecret || randomToken(32);
  const secure = secureCookies === undefined ? String(redirectUri || "").startsWith("https://") : Boolean(secureCookies);
  let discoveryPromise;

  async function discovery() {
    if (!discoveryPromise) {
      const url = `${String(issuerUrl).replace(/\/+$/, "")}/.well-known/openid-configuration`;
      discoveryPromise = oidcFetch(url).then(async (response) => JSON.parse(await response.text()));
    }
    return discoveryPromise;
  }

  function packSession(id) {
    return `${id}.${sign(id, secret)}`;
  }

  function unpackSession(value) {
    const [id, signature] = String(value || "").split(".");
    if (!id || !signature || sign(id, secret) !== signature) return "";
    return id;
  }

  function clearAuthCookies(res) {
    appendCookie(res, cookie(sessionCookie, "", { maxAge: 0, secure }));
    appendCookie(res, cookie(stateCookie, "", { maxAge: 0, secure }));
  }

  function sessionUser(req) {
    if (!isEnabled) return null;
    const sessionId = unpackSession(parseCookies(req.headers.cookie)[sessionCookie]);
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }
    return session.user;
  }

  function attachUser(req, res, next) {
    const user = sessionUser(req);
    if (user) req.authUser = user;
    next();
  }

  function loginRequired(req, res, next) {
    if (!isEnabled || sessionUser(req)) return next();
    if (req.accepts("html")) return res.redirect(`/login?rd=${encodeURIComponent(req.originalUrl || "/")}`);
    res.status(401).json({ detail: "login required", login_url: `/login?rd=${encodeURIComponent(req.originalUrl || "/")}` });
  }

  async function login(req, res) {
    if (!isEnabled) return res.redirect(safeReturnTo(req.query.rd));
    const state = randomToken(24);
    const codeVerifier = randomToken(48);
    const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
    states.set(state, {
      codeVerifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
      returnTo: safeReturnTo(req.query.rd),
    });
    appendCookie(res, cookie(stateCookie, state, { maxAge: 600, secure }));
    const metadata = await discovery();
    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    res.redirect(authUrl.toString());
  }

  async function callback(req, res, next) {
    try {
      const state = String(req.query.state || "");
      const stored = states.get(state);
      states.delete(state);
      const cookieState = parseCookies(req.headers.cookie)[stateCookie];
      if (!isEnabled || !stored || stored.expiresAt <= Date.now() || cookieState !== state) {
        return res.status(400).send("Invalid login state");
      }
      const metadata = await discovery();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: String(req.query.code || ""),
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: stored.codeVerifier,
      });
      const tokenResponse = await oidcFetch(metadata.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const tokenPayload = JSON.parse(await tokenResponse.text());
      if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
        const error = new Error(tokenPayload.error_description || tokenPayload.error || "OIDC token exchange failed");
        error.statusCode = tokenResponse.status;
        throw error;
      }
      let claims = {};
      if (metadata.userinfo_endpoint && tokenPayload.access_token) {
        const userResponse = await oidcFetch(metadata.userinfo_endpoint, {
          headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
        });
        claims = JSON.parse(await userResponse.text());
      } else if (tokenPayload.id_token) {
        claims = JSON.parse(Buffer.from(String(tokenPayload.id_token).split(".")[1] || "", "base64url").toString("utf8"));
      }
      const sessionId = randomToken(32);
      sessions.set(sessionId, {
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
        user: userFromClaims(claims),
      });
      appendCookie(res, cookie(sessionCookie, packSession(sessionId), { maxAge: 12 * 60 * 60, secure }));
      appendCookie(res, cookie(stateCookie, "", { maxAge: 0, secure }));
      res.redirect(stored.returnTo || "/");
    } catch (error) {
      next(error);
    }
  }

  function logout(req, res) {
    const sessionId = unpackSession(parseCookies(req.headers.cookie)[sessionCookie]);
    if (sessionId) sessions.delete(sessionId);
    clearAuthCookies(res);
    res.redirect(safeReturnTo(req.query.rd));
  }

  return {
    attachUser,
    callback,
    enabled: isEnabled,
    login,
    loginRequired,
    logout,
    sessionUser,
  };
}

module.exports = {
  cookie,
  createOidcAuth,
  parseCookies,
  setOidcFetchForTests,
  userFromClaims,
};
