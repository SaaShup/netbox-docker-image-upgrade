function registerOperationRoutes(app, {
  asyncOperation,
  authUserFromRequest,
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
  recordOrderInstance,
  recreateContainers,
  removeOrderInstance,
  requestContainerOperation,
  selectedProfileConfig,
  updateEnrollmentInstanceStatus,
  updateOrderInstanceStatus,
  validateOrderTemplate,
  valueText,
  waitForContainerStopped,
  waitForHostReady,
  waitForRequest,
  createInstance,
}) {
  app.post("/create", oidcAuth.loginRequired, async (req, res) => {
    const data = { ...selectedProfileConfig(req.body), ...req.body };
    const authUser = authUserFromRequest(req);
    data.saashup_owner = authUser.email || "";
    const orderProfile = data.profile || data.config_profile || "";
    const usage = currentUsage(req, orderProfile);
    const isOrderRequest = req.body.order_request === "true";
    const enrollUsage = currentEnrollmentUsage(req, orderProfile);
    const isEnrollRequest = req.body.enroll_request === "true";
    if (isOrderRequest && !validateOrderTemplate(req, res)) return;
    if (isOrderRequest && usage.reached) {
      return res.status(429).json({ code: "max_instances_reached", detail: `You have reached your maximum of ${usage.max} instance${usage.max === 1 ? "" : "s"} for this config.`, max_instances: usage.max, used_instances: usage.used });
    }
    if (isEnrollRequest && enrollUsage.reached) {
      return res.status(429).json({ code: "max_templates_reached", detail: `You have reached your maximum of ${enrollUsage.max} template${enrollUsage.max === 1 ? "" : "s"} for this config.`, max_templates: enrollUsage.max, used_templates: enrollUsage.used });
    }
    if (isOrderRequest) recordOrderInstance(req, orderProfile, data);
    if (isEnrollRequest) recordEnrollment(req, orderProfile, data);

    const operationContext = { isOrderRequest, isEnrollRequest, orderProfile, authUser };
    if (waitForRequest(data)) {
      try {
        const ready = await createInstance(req, data, operationContext);
        return res.status(ready ? 200 : 422).json({ status: ready ? "finished" : "failed" });
      } catch (error) {
        if (isOrderRequest) updateOrderInstanceStatus(req, orderProfile, data.instance || "", "failed");
        if (isEnrollRequest) updateEnrollmentInstanceStatus(req, orderProfile, data.instance || "", "failed");
        logLine(`ERROR : ${error.message || "operation failed"} payload=${JSON.stringify(error.payload || {}).slice(0, 240)}`);
        return res.status(error.statusCode || 502).json({ detail: error.message || "operation failed", payload: error.payload });
      }
    }

    asyncOperation(res, async () => {
      try {
        await createInstance(req, data, operationContext);
      } catch (error) {
        if (isOrderRequest) updateOrderInstanceStatus(req, orderProfile, data.instance || "", "failed");
        if (isEnrollRequest) updateEnrollmentInstanceStatus(req, orderProfile, data.instance || "", "failed");
        throw error;
      }
    });
  });

  app.post("/recreate", (req, res) => {
    const data = { ...selectedProfileConfig(req.body), ...req.body };
    asyncOperation(res, () => recreateContainers(data));
  });

  app.post("/restart", (req, res) => {
    const data = { ...selectedProfileConfig(req.body), ...req.body };
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

  app.post("/delete", (req, res) => {
    const data = { ...selectedProfileConfig(req.body), ...req.body };
    asyncOperation(res, async () => {
      const client = new NetBoxClient(data);
      const hostFilter = await hostIdQuery(client, data.tag);
      const matches = exactContainerNameMatches(await client.list("/api/plugins/docker/containers/", { name: instanceShort(data.instance), ...hostFilter }), data.instance);
      if (matches.length !== 1) return logLine(`DELETE : cannot delete ${instanceShort(data.instance)}, expected 1 container got ${matches.length}`);
      const container = matches[0];
      if (isContainerRunning(container)) {
        await client.request("PATCH", "/api/plugins/docker/containers/", { body: [{ id: container.id, operation: "stop" }] });
        logLine(`DELETE : container ${instanceShort(data.instance)} stop requested id=${container.id}`);
        await waitForContainerStopped(client, container.id, `${hostName(container)}/${valueText(container.display || container.name)}`);
      }
      await client.request("DELETE", `/api/plugins/docker/containers/${container.id}/`, { expected: [200, 202, 204] });
      logLine(`DELETE : container ${instanceShort(data.instance)} deleted id=${container.id}`);
      if (deleteVolumesEnabled(data)) await deleteContainerVolumes(client, container);
      await deleteDnsRecord(client, data);
      if (req.body.order_request === "true") removeOrderInstance(req, data.profile || data.config_profile || "", data.instance || "");
    });
  });

  app.post("/refresh-hosts", (req, res) => {
    const data = { ...selectedProfileConfig(req.body), ...req.body };
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
