function registerLimitRoutes(app, {
  currentEnrollmentUsage,
  currentUsage,
}) {
  app.get("/order/limit", (req, res) => res.json(currentUsage(req, req.query.profile || "")));
  app.get("/enroll/limit", (req, res) => res.json(currentEnrollmentUsage(req, req.query.profile || "")));
}

module.exports = { registerLimitRoutes };
