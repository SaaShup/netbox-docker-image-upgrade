function registerLimitRoutes(app, {
  currentEnrollmentUsage,
  currentUsage,
}) {
  app.get("/order/limit", async (req, res) => res.json(await currentUsage(req, req.query.profile || "")));
  app.get("/enroll/limit", async (req, res) => res.json(await currentEnrollmentUsage(req, req.query.profile || "")));
}

module.exports = { registerLimitRoutes };
