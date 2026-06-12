function createRegistryWebhookHelpers({
  imageNameFromRef,
  orderTemplateEntry,
  plainObject,
  readState,
  registryWebhookEvents,
  registryWebhookSecret,
  timingSafeStringEqual,
}) {
  function templateMatchesRegistryWebhook(template, profile, image) {
    const entry = plainObject(template);
    const templateProfile = String(entry.config_profile || entry.profile || "").trim();
    const templateImage = imageNameFromRef(entry.image || "");
    return templateImage === image && (!templateProfile || templateProfile === profile);
  }

  function registryWebhookTemplates(profile, image) {
    const templates = plainObject(readState().templates);
    return Object.entries(templates)
      .map(([name, template]) => ({ name, template: plainObject(template) }))
      .filter((entry) => templateMatchesRegistryWebhook(entry.template, profile, image));
  }

  function registryWebhookTemplateSecret(profile, templateName, events = []) {
    const entry = orderTemplateEntry(templateName);
    if (!entry) return "";
    const imageMatches = events.length
      ? events.some((event) => templateMatchesRegistryWebhook(entry.template, profile, event.image))
      : templateMatchesRegistryWebhook(entry.template, profile, "");
    if (!imageMatches) return "";
    return String(entry.template.registry_webhook_secret || entry.template.dockerhub_webhook_secret || "");
  }

  function registrySecretForTemplate(name, image = "") {
    const entry = orderTemplateEntry(name);
    if (!entry) return registryWebhookSecret;
    if (image && !templateMatchesRegistryWebhook(entry.template, String(entry.template.config_profile || entry.template.profile || ""), imageNameFromRef(image))) return registryWebhookSecret;
    return String(entry.template.registry_webhook_secret || entry.template.dockerhub_webhook_secret || registryWebhookSecret || "");
  }

  function registryWebhookAllowed(req, events = registryWebhookEvents(req.body)) {
    const profile = String(req.params.profile || "");
    const template = String(req.params.template || req.query.template || "");
    const matchingSecrets = template
      ? [registryWebhookTemplateSecret(profile, template, events)].filter(Boolean)
      : events.flatMap((event) => registryWebhookTemplates(profile, event.image)
        .map((entry) => String(entry.template.registry_webhook_secret || entry.template.dockerhub_webhook_secret || ""))
        .filter(Boolean));
    const secrets = matchingSecrets.length ? matchingSecrets : [registryWebhookSecret].filter(Boolean);
    if (!secrets.length) return true;
    const provided = req.params.secret || req.query.secret || req.get("x-saashup-webhook-secret") || "";
    return secrets.some((secret) => timingSafeStringEqual(provided, secret));
  }

  return {
    registrySecretForTemplate,
    registryWebhookAllowed,
    registryWebhookTemplateSecret,
    registryWebhookTemplates,
    templateMatchesRegistryWebhook,
  };
}

function addRegistryWebhookEvent(events, image, tag, imageNameFromRef) {
  const eventImage = imageNameFromRef(image || "");
  const eventTag = String(tag || "").trim();
  if (eventImage && eventTag) events.push({ image: eventImage, tag: eventTag });
}

function imageFromDistributionTarget(target, plainObject) {
  const entry = plainObject(target);
  const url = String(entry.url || "");
  if (!url) return entry.repository || "";
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/v2\/(.+)\/manifests\/[^/]+$/);
    return match ? `${parsed.host}/${match[1]}` : entry.repository || "";
  } catch {
    return entry.repository || "";
  }
}

function githubPackageImage(payload, plainObject) {
  const root = plainObject(payload);
  const registryPackage = plainObject(root.registry_package || root.package);
  const packageName = String(registryPackage.name || root.name || "").trim();
  if (!packageName) return "";
  if (packageName.includes("/") || packageName.startsWith("ghcr.io/")) return packageName;
  const owner = plainObject(registryPackage.owner || root.organization || root.repository?.owner || root.sender);
  const login = String(owner.login || owner.name || "").trim();
  return login ? `ghcr.io/${login}/${packageName}` : packageName;
}

function githubPackageTag(payload, plainObject) {
  const root = plainObject(payload);
  const version = plainObject(root.package_version || root.registry_package?.package_version);
  const metadata = plainObject(version.container_metadata);
  const tag = plainObject(metadata.tag);
  return tag.name || version.name || root.package_version_name || "";
}

function createRegistryWebhookEvents({ imageNameFromRef, plainObject }) {
  return function registryWebhookEvents(payload) {
    const body = plainObject(payload);
    const events = [];

    addRegistryWebhookEvent(events, body.repository?.repo_name, body.push_data?.tag, imageNameFromRef);

    const quayTags = Array.isArray(body.updated_tags) ? body.updated_tags : Array.isArray(body.docker_tags) ? body.docker_tags : [];
    quayTags.forEach((tag) => addRegistryWebhookEvent(events, body.docker_url || body.repository, tag, imageNameFromRef));

    const distributionEvents = Array.isArray(body.events) ? body.events : [];
    distributionEvents
      .filter((event) => !event.action || event.action === "push")
      .forEach((event) => {
        const target = plainObject(event.target);
        addRegistryWebhookEvent(events, imageFromDistributionTarget(target, plainObject), target.tag, imageNameFromRef);
      });

    addRegistryWebhookEvent(events, githubPackageImage(body, plainObject), githubPackageTag(body, plainObject), imageNameFromRef);

    return events;
  };
}

module.exports = {
  createRegistryWebhookEvents,
  createRegistryWebhookHelpers,
  githubPackageImage,
  githubPackageTag,
  imageFromDistributionTarget,
};
