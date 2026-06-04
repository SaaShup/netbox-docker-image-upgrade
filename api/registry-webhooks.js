function registerRegistryWebhookRoutes(app, {
  logLine,
  recreateContainers,
  registryWebhookAllowed,
  registryWebhookEvents,
  selectedProfileConfig,
}) {
  app.post([
    "/registry-webhook/:profile",
    "/registry-webhook/:profile/:secret",
    "/registry-webhook/:profile/:template/:secret",
  ], (req, res) => {
    const events = registryWebhookEvents(req.body);
    if (!registryWebhookAllowed(req, events)) return res.status(403).json({ detail: "invalid webhook secret" });
    res.status(202).json({ status: "accepted" });
    const upgradeEvents = events.filter((event) => event.tag !== "latest");
    if (!upgradeEvents.length) return;
    const config = selectedProfileConfig({ profile: req.params.profile });
    Promise.resolve()
      .then(async () => {
        for (const event of upgradeEvents) {
          await recreateContainers({ ...config, image: event.image, version: event.tag, clean_name: false });
        }
      })
      .catch((error) => logLine(`REGISTRY_WEBHOOK : failed ${error.message}`));
  });
}

module.exports = { registerRegistryWebhookRoutes };
