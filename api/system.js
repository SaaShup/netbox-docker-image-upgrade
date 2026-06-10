const path = require("path");

function sendNoCachePage(publicPath, res, fileName) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(path.join(publicPath, fileName));
}

function registerSystemRoutes(app, {
  authUserFromRequest,
  oidcAuth,
  packageJson,
  publicPath,
  requireAdmin,
}) {
  app.use(oidcAuth.attachUser);

  app.get("/session/user", (req, res) => res.json(authUserFromRequest(req)));
  app.get("/login", (req, res, next) => Promise.resolve(oidcAuth.login(req, res)).catch(next));
  app.get("/oidc/callback", oidcAuth.callback);
  app.get("/logout", oidcAuth.logout);
  app.get("/version", (req, res) => res.json({ name: packageJson.name, version: packageJson.version }));

  app.get("/admin", oidcAuth.loginRequired, requireAdmin, (req, res) => res.sendFile(path.join(publicPath, "admin.html")));
  app.get("/admin.html", oidcAuth.loginRequired, requireAdmin, (req, res) => res.sendFile(path.join(publicPath, "admin.html")));
  app.get("/order", oidcAuth.loginRequired, (req, res) => res.sendFile(path.join(publicPath, "order.html")));
  app.get("/enroll", oidcAuth.loginRequired, (req, res) => sendNoCachePage(publicPath, res, "enroll.html"));
  app.get("/enroll.html", oidcAuth.loginRequired, (req, res) => sendNoCachePage(publicPath, res, "enroll.html"));
  app.get("/catalog", oidcAuth.loginRequired, (req, res) => sendNoCachePage(publicPath, res, "catalog.html"));
  app.get("/catalog.html", oidcAuth.loginRequired, (req, res) => sendNoCachePage(publicPath, res, "catalog.html"));
}

module.exports = { registerSystemRoutes };
