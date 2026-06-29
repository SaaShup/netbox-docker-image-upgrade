function registerRegistryWebhookRoutes(app, {
  logLine,
  recreateContainers,
  registryWebhookAllowed,
  registryWebhookEvents,
  registryWebhookTemplates,
  imageNameFromRef,
  sendImageUpgradeEmail,
  sendOrderReadyEmail,
  selectedProfileConfig,
  templatesForRequest,
}) {
  function templateMatchesRegistryWebhook(template, profile, image) {
    const templateProfile = String(template.config_profile || template.profile || profile || "").trim();
    const templateImage = imageNameFromRef(String(template.image || ""));
    const normalizedImage = String(image || "").trim().toLowerCase();
    return templateImage === normalizedImage && (!templateProfile || templateProfile === profile);
  }

  async function notificationTemplates(req, profile, image) {
    if (typeof templatesForRequest !== "function") return registryWebhookTemplates(profile, image);
    const templates = await templatesForRequest(req, profile, { ownerOnly: false });
    return Object.entries(templates)
      .map(([name, template]) => ({ name, template }))
      .filter((entry) => templateMatchesRegistryWebhook(entry.template, profile, image));
  }

  async function sendWebhookReadyNotifications(req, config, profile, event) {
    const templates = await notificationTemplates(req, profile, event.image);
    for (const { name, template } of templates) {
      const recipient = String(template.creator_email || "").trim();
      if (!recipient) continue;
      try {
        const sender = typeof sendImageUpgradeEmail === "function" ? sendImageUpgradeEmail : sendOrderReadyEmail;
        await sender({
          ...config,
          image: event.image,
          from_version: template.version || "",
          to_version: event.tag,
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
          if (ready) await sendWebhookReadyNotifications(req, config, req.params.profile, event);
        }
      })
      .catch((error) => logLine(`REGISTRY_WEBHOOK : failed ${error.message}`));
  });
}

module.exports = { registerRegistryWebhookRoutes };
