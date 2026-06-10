function registerNetBoxRoutes(app, {
  checkRegistryImageExists,
  containerNetworkNames,
  hostIdQuery,
  NetBoxClient,
  publicApiGuard,
  reportImages,
  requireAdmin,
  selectedProfileConfig,
  testConnection,
}) {
  app.get("/test", requireAdmin, testConnection);
  app.post("/test", requireAdmin, testConnection);

  app.get("/instances", async (req, res) => {
    try {
      const config = selectedProfileConfig(req.query);
      const client = new NetBoxClient(config);
      const hostFilter = await hostIdQuery(client, req.query.tag || config.tag);
      if (hostFilter.host_id === "__none__") return res.json([]);
      const containers = await client.list("/api/plugins/docker/containers/", { limit: 1000, ...hostFilter });
      res.json(containers.map((item) => ({ ...item, instance: item.display || item.name, networks: containerNetworkNames(item) })));
    } catch (error) {
      res.status(error.statusCode || 502).json({ detail: error.message });
    }
  });

  app.get("/images", async (req, res) => {
    try {
      const config = selectedProfileConfig(req.query);
      const client = new NetBoxClient(config);
      const hostFilter = await hostIdQuery(client, req.query.tag || config.tag);
      if (hostFilter.host_id === "__none__") return res.json([]);
      const images = await client.list("/api/plugins/docker/images/", { limit: 1000, ...hostFilter });
      res.json(images);
    } catch (error) {
      res.status(error.statusCode || 502).json({ detail: error.message });
    }
  });

  app.get("/containers-count", async (req, res) => {
    try {
      const config = selectedProfileConfig(req.query);
      const client = new NetBoxClient(config);
      const hostFilter = await hostIdQuery(client, req.query.tag || config.tag);
      if (hostFilter.host_id === "__none__") return res.json({ count: 0 });
      const images = await client.list("/api/plugins/docker/images/", { limit: 1000, name: req.query.image, version: req.query.version, ...hostFilter });
      if (!images.length) return res.json({ count: 0 });
      const containers = await client.list("/api/plugins/docker/containers/", { limit: 1, image_id: images.map((image) => image.id) });
      res.json({ count: containers.length });
    } catch (error) {
      res.status(error.statusCode || 502).json({ detail: error.message });
    }
  });

  app.options("/registry/check", publicApiGuard);
  app.get("/registry/check", publicApiGuard, async (req, res) => {
    try {
      const result = await checkRegistryImageExists(req.query.image || req.query.ref || "");
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 502).json({ detail: registryCheckErrorMessage(error) });
    }
  });

  app.get("/registry/lookup", async (req, res) => {
    try {
      const result = await checkRegistryImageExists(req.query.image || req.query.ref || "");
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 502).json({ detail: registryCheckErrorMessage(error) });
    }
  });

  app.get("/report/images", requireAdmin, reportImages);
}

function registryCheckErrorMessage(error) {
  if (error?.message === "fetch failed" && error?.cause?.message) {
    return `registry check failed: ${error.cause.message}`;
  }
  return error?.message || "registry check failed";
}

module.exports = { registerNetBoxRoutes };
