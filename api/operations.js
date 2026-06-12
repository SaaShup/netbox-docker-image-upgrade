function registerOperationRoutes(app, {
  asyncOperation,
  authUserFromRequest,
  bindPayloadsFromForm,
  canCreatePublicImage,
  currentEnrollmentUsage,
  currentUsage,
  deleteContainerVolumes,
  deleteDnsRecord,
  deleteVolumesEnabled,
  dockerHosts,
  exactContainerNameMatches,
  hostIdQuery,
  hostName,
  instanceShort,
  isContainerRunning,
  logLine,
  NetBoxClient,
  oidcAuth,
  recordEnrollment,
  recreateContainers,
  requestContainerOperation,
  selectedProfileConfig,
  updateEnrollmentInstanceStatus,
  validateEnrollmentTemplate,
  validateOrderTemplate,
  valueText,
  waitForContainerStopped,
  waitForHostReady,
  waitForRequest,
  createInstance,
}) {
  function removeImageEnabled(data) {
    return data.remove_image === true || data.remove_image === "true" || data.remove_image === "on";
  }

  function imageNameFromRef(ref) {
    const text = String(ref || "");
    if (!text) return "";
    const slash = text.lastIndexOf("/");
    const colon = text.lastIndexOf(":");
    return colon > slash ? text.slice(0, colon) : text;
  }

  function imageRecordMatchesName(image, requestedName) {
    const requested = imageNameFromRef(requestedName).toLowerCase();
    return [image?.name, image?.display]
      .map(valueText)
      .map(imageNameFromRef)
      .some((name) => name.toLowerCase() === requested);
  }

  async function deleteOneContainer(client, data, container, instanceName = "") {
    const name = instanceName || valueText(container.display || container.name);
    if (isContainerRunning(container)) {
      await client.request("PATCH", "/api/plugins/docker/containers/", { body: [{ id: container.id, operation: "stop" }] });
      logLine(`DELETE : container ${instanceShort(name)} stop requested id=${container.id}`);
      await waitForContainerStopped(client, container.id, `${hostName(container)}/${valueText(container.display || container.name)}`);
    }
    await client.request("DELETE", `/api/plugins/docker/containers/${container.id}/`, { expected: [200, 202, 204] });
    logLine(`DELETE : container ${instanceShort(name)} deleted id=${container.id}`);
    if (deleteVolumesEnabled(data)) await deleteContainerVolumes(client, container);
    await deleteDnsRecord(client, { ...data, instance: name });
  }

  async function deleteByImage(client, data) {
    const hostFilter = await hostIdQuery(client, data.tag);
    const images = (await client.list("/api/plugins/docker/images/", { name: data.image, limit: 200, ...hostFilter }))
      .filter((image) => imageRecordMatchesName(image, data.image));
    if (!images.length) {
      logLine(`DELETE : cannot delete image ${data.image || ""}, expected at least 1 image got 0`);
      return;
    }

    const containersById = new Map();
    for (const image of images) {
      const containers = await client.list("/api/plugins/docker/containers/", { image_id: image.id, limit: 200 });
      containers.forEach((container) => containersById.set(container.id, container));
    }

    if (!containersById.size) {
      logLine(`DELETE : no containers found for image ${data.image}`);
      return;
    }

    for (const container of containersById.values()) {
      await deleteOneContainer(client, data, container);
    }

    logLine(`DELETE : ${containersById.size} container${containersById.size === 1 ? "" : "s"} deleted for image ${data.image}`);
    if (!removeImageEnabled(data)) return;

    for (const image of images) {
      await client.request("DELETE", `/api/plugins/docker/images/${image.id}/`, { expected: [200, 202, 204] });
      logLine(`DELETE : image ${valueText(image.name) || data.image}:${valueText(image.version) || ""} deleted id=${image.id}`);
    }
  }

  async function runDeleteOperation(req, data) {
    const client = new NetBoxClient(data);
    if (data.delete_mode === "image") {
      await deleteByImage(client, data);
      return;
    }
    const hostFilter = await hostIdQuery(client, data.tag);
    const matches = exactContainerNameMatches(await client.list("/api/plugins/docker/containers/", { name: instanceShort(data.instance), ...hostFilter }), data.instance);
    if (matches.length !== 1) return logLine(`DELETE : cannot delete ${instanceShort(data.instance)}, expected 1 container got ${matches.length}`);
    await deleteOneContainer(client, data, matches[0], data.instance);
  }

  app.post("/create", oidcAuth.loginRequired, async (req, res) => {
    const data = selectedProfileConfig(req.body);
    const authUser = authUserFromRequest(req);
    data.saashup_owner = authUser.email || "";
    const orderProfile = data.profile || data.config_profile || "";
    const usage = await currentUsage(req, orderProfile);
    const isOrderRequest = req.body.order_request === "true";
    const isEnrollRequest = req.body.enroll_request === "true";
    if (isEnrollRequest && canCreatePublicImage && !canCreatePublicImage(req)) {
      return res.status(403).json({
        code: "public_image_disabled",
        detail: "Only administrators can create or enroll images.",
      });
    }
    if (isEnrollRequest && bindPayloadsFromForm(data).length) {
      return res.status(400).json({
        code: "bind_mount_not_allowed",
        detail: "Bind mounts are not allowed for enrollment. Use a named Docker volume like flowg-data:/data.",
      });
    }
    const enrollUsage = isEnrollRequest ? await currentEnrollmentUsage(req, orderProfile) : { reached: false };
    if (isOrderRequest && !await validateOrderTemplate(req, res, orderProfile)) return;
    if (isOrderRequest && usage.reached) {
      return res.status(429).json({ code: "max_instances_reached", detail: `You have reached your maximum of ${usage.max} instance${usage.max === 1 ? "" : "s"} for this config.`, max_instances: usage.max, used_instances: usage.used });
    }
    if (isEnrollRequest && enrollUsage.reached) {
      return res.status(429).json({ code: "enrollment_limit_reached", detail: `You have reached your maximum of ${enrollUsage.max} enrolled image${enrollUsage.max === 1 ? "" : "s"} for this config.`, enrollment_limit: enrollUsage.max, used_enrollments: enrollUsage.used });
    }
    if (isEnrollRequest && !await validateEnrollmentTemplate(req, res, orderProfile, data)) return;
    if (isEnrollRequest) {
      try {
        await recordEnrollment(req, orderProfile, data);
      } catch (error) {
        return res.status(502).json({ code: "template_catalog_sync_failed", detail: error.message || "Template catalog sync failed." });
      }
    }

    const operationContext = { isOrderRequest, isEnrollRequest, orderProfile, authUser };
    if (waitForRequest(data)) {
      try {
        const ready = await createInstance(req, data, operationContext);
        return res.status(ready ? 200 : 422).json({ status: ready ? "finished" : "failed" });
      } catch (error) {
        if (isEnrollRequest) updateEnrollmentInstanceStatus(req, orderProfile, data.template_name || data.order_template || data.instance || "", "failed");
        logLine(`ERROR : ${error.message || "operation failed"} payload=${JSON.stringify(error.payload || {}).slice(0, 240)}`);
        return res.status(error.statusCode || 502).json({ detail: error.message || "operation failed", payload: error.payload });
      }
    }

    asyncOperation(res, async () => {
      try {
        await createInstance(req, data, operationContext);
      } catch (error) {
        if (isEnrollRequest) updateEnrollmentInstanceStatus(req, orderProfile, data.template_name || data.order_template || data.instance || "", "failed");
        throw error;
      }
    });
  });

  app.post("/recreate", (req, res) => {
    const data = selectedProfileConfig(req.body);
    asyncOperation(res, () => recreateContainers(data));
  });

  app.post("/restart", (req, res) => {
    const data = selectedProfileConfig(req.body);
    asyncOperation(res, async () => {
      const operation = ["start", "stop", "restart", "kill"].includes(data.operate_action) ? data.operate_action : "restart";
      const logPrefix = operation.toUpperCase();
      const client = new NetBoxClient(data);
      const hostFilter = await hostIdQuery(client, data.tag);
      if (hostFilter.host_id === "__none__") return logLine(`${logPrefix} : no Docker hosts found with tag ${data.tag}`);
      let containers = [];
      if (data.restart_mode === "instance") {
        containers = exactContainerNameMatches(await client.list("/api/plugins/docker/containers/", { name: instanceShort(data.instance), ...hostFilter }), data.instance);
      } else {
        const images = await client.list("/api/plugins/docker/images/", { name: data.image, version: data.restart_version, limit: 200, ...hostFilter });
        for (const image of images) containers.push(...await client.list("/api/plugins/docker/containers/", { image_id: image.id, limit: 200 }));
      }
      for (const container of containers) await requestContainerOperation(client, container, operation, logPrefix);
      logLine(`${logPrefix} : finished ${operation} loop`);
    });
  });

  app.post("/delete", async (req, res) => {
    const data = selectedProfileConfig(req.body);
    if (waitForRequest(data)) {
      try {
        await runDeleteOperation(req, data);
        return res.status(200).json({ status: "finished" });
      } catch (error) {
        logLine(`ERROR : ${error.message || "operation failed"} payload=${JSON.stringify(error.payload || {}).slice(0, 240)}`);
        return res.status(error.statusCode || 502).json({ detail: error.message || "operation failed", payload: error.payload });
      }
    }
    asyncOperation(res, () => runDeleteOperation(req, data));
  });

  app.post("/refresh-hosts", (req, res) => {
    const data = selectedProfileConfig(req.body);
    asyncOperation(res, async () => {
      const client = new NetBoxClient(data);
      const hosts = await dockerHosts(client, data.tag);
      for (const host of hosts) {
        await client.request("PATCH", `/api/plugins/docker/hosts/${host.id}/`, { body: { operation: "refresh" } });
        logLine(`REFRESH_HOST : ${valueText(host.display || host.name)} refresh requested`);
        await waitForHostReady(client, host.id, valueText(host.display || host.name));
      }
      logLine("REFRESH_HOST : finished host refresh loop");
    });
  });
}

module.exports = { registerOperationRoutes };
