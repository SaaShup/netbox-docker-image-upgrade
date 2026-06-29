function registerRegistryWebhookRoutes(app, {
  logLine,
  recreateContainers,
  registryWebhookAllowed,
  registryWebhookEvents,
  registryWebhookTemplates,
  sendOrderReadyEmail,
  selectedProfileConfig,
}) {
  async function sendWebhookReadyNotifications(config, profile, event) {
    const templates = registryWebhookTemplates(profile, event.image);
    for (const { name, template } of templates) {
      const recipient = String(template.creator_email || "").trim();
      if (!recipient) continue;
      try {
        await sendOrderReadyEmail({
          ...config,
          image: event.image,
          version: event.tag,
          instance: template.instance || template.dns_name || name,
        }, recipient);
      } catch (error) {
        logLine(`EMAIL : ready notification failed for ${recipient} ${error.message || "smtp error"}`);
      }
    }
  }

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
          const ready = await recreateContainers({ ...config, image: event.image, version: event.tag, clean_name: false });
          if (ready) await sendWebhookReadyNotifications(config, req.params.profile, event);
        }
      })
      .catch((error) => logLine(`REGISTRY_WEBHOOK : failed ${error.message}`));
  });
}

module.exports = { registerRegistryWebhookRoutes };
