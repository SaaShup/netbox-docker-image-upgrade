const { selectImageAwareHost } = require("../lib/host-selection");

function createCreateHelpers({
  containerConfigPayloadFromForm,
  containerCreatePayloadFromForm,
  createConfigureDelayMs,
  createDnsRecord,
  createRecreateDelayMs,
  delay,
  dockerHosts,
  ensureImageOnHost,
  hostName,
  logLine,
  NetBoxClient,
  normalizedSaashupLabelConfig,
  requestContainerOperation,
  sendOrderReadyEmail,
  templateNameFromEnrollmentData,
  traefikEnabled,
  updateEnrollmentInstanceStatus,
  valueText,
  volumePayloadsFromForm,
  waitForContainerConfigured,
}) {
  function logDriverOptionsList(options) {
    if (typeof options === "string") {
      try {
        options = JSON.parse(options);
      } catch {
        return [];
      }
    }
    if (!options || typeof options !== "object") return [];
    if (Array.isArray(options)) {
      return options
        .map((item) => {
          if (item && typeof item === "object") {
            const name = item.option_name || item.name || item.key;
            const value = item.value ?? item.option_value;
            return name ? { option_name: String(name), value: String(value ?? "") } : null;
          }
          const [name, ...valueParts] = String(item || "").split("=");
          return name ? { option_name: name, value: valueParts.join("=") } : null;
        })
        .filter(Boolean);
    }

    return Object.entries(options)
      .map(([name, value]) => {
        if (!name || value === undefined) return null;
        return { option_name: String(name), value: String(value) };
      })
      .filter(Boolean);
  }

  function allHostsEnabled(data) {
    return data.all_hosts === true || data.all_hosts === "true" || data.all_hosts === "on";
  }

  function hostLoadSummary(stats) {
    return stats.map((item) => `${hostName(item.host)}=${item.count}`).join(",");
  }

  function dockerVolumeHostId(volume) {
    const host = volume?.host;
    return String(host?.id || host || "");
  }

  async function existingDockerVolume(client, volume) {
    const volumes = await client.list("/api/plugins/docker/volumes/", { host_id: volume.host, name: volume.name, limit: 10 });
    return volumes.find((item) => (
      String(item?.name || "") === String(volume.name || "")
      && (!volume.host || dockerVolumeHostId(item) === String(volume.host))
    ));
  }

  async function missingDockerVolumes(client, volumes) {
    const missing = [];
    let reused = 0;
    for (const volume of volumes) {
      if (await existingDockerVolume(client, volume)) {
        reused += 1;
      } else {
        missing.push(volume);
      }
    }
    return { missing, reused };
  }

  async function selectCreateHost(client, hosts, existingContainers, data) {
    const selection = await selectImageAwareHost(client, hosts, existingContainers, data);
    const imageScope = selection.imageReadyHosts.length
      ? ` image_hosts=${selection.imageReadyHosts.map(hostName).join(",")}`
      : " image_hosts=none";
    logLine(`CREATE : host selection hosts=${hosts.length} containers=${existingContainers.length} loads=${hostLoadSummary(selection.loadStats)}${imageScope} selected=${hostName(selection.selected)} count=${selection.selectedCount}`);
    return selection.selected;
  }

  async function createInstance(req, data, { isOrderRequest, isEnrollRequest, orderProfile, authUser }) {
    data = normalizedSaashupLabelConfig(data);
    const enrollTemplateName = isEnrollRequest ? templateNameFromEnrollmentData(data) : "";
    const client = new NetBoxClient(data);
    const hosts = await dockerHosts(client, data.tag);
    if (!hosts.length) {
      logLine(`CREATE : no Docker hosts found${data.tag ? ` with tag ${data.tag}` : ""}`);
      if (isEnrollRequest) await updateEnrollmentInstanceStatus(req, orderProfile, enrollTemplateName, "failed");
      return false;
    }
    let targetHosts = hosts;
    if (allHostsEnabled(data)) {
      logLine(`CREATE : host selection all_hosts=true hosts=${hosts.length} selected=${hosts.map(hostName).join(",")}`);
    } else {
      const existingContainers = await client.list("/api/plugins/docker/containers/", { limit: 1000, host_id: hosts.map((host) => host.id) });
      const selected = await selectCreateHost(client, hosts, existingContainers, data);
      targetHosts = [selected].filter(Boolean);
    }
    let readyCount = 0;

    function normalizedContainerConfig(config) {
      if (config.log_driver && config.log_driver_options) {
        const logOptions = logDriverOptionsList(config.log_driver_options);
        if (logOptions.length) {
          config.log_driver_options = logOptions;
        } else {
          delete config.log_driver_options;
        }
      }
      return config;
    }

    for (const [index, selectedHost] of targetHosts.entries()) {
      data.host_id = selectedHost.id;
      const image = await ensureImageOnHost(client, selectedHost, data.image, data.version, "CREATE");
      if (traefikEnabled(data) && index === 0) await createDnsRecord(client, data, selectedHost);
      const volumes = volumePayloadsFromForm(data);
      if (volumes.length) {
        const { missing, reused } = await missingDockerVolumes(client, volumes);
        if (missing.length) {
          await client.request("POST", "/api/plugins/docker/volumes/", { body: missing.length === 1 ? missing[0] : missing, expected: [200, 201, 202] });
        }
        const details = reused ? ` (${reused} reused, ${missing.length} created)` : "";
        logLine(`CREATE : ${volumes.length} volume${volumes.length === 1 ? "" : "s"} prepared on ${hostName(selectedHost)}${details}`);
      }
      const containerConfigPayload = normalizedContainerConfig(containerConfigPayloadFromForm(data));
      const { id: _unusedConfigId, ...containerCreateConfig } = containerConfigPayload;
      const containerPayload = {
        ...containerCreatePayloadFromForm(data, image.id),
        ...containerCreateConfig,
      };
      const { payload } = await client.request("POST", "/api/plugins/docker/containers/", { body: containerPayload, expected: [200, 201, 202] });
      const container = Array.isArray(payload) ? payload[0] : payload;
      logLine(`CREATE : container ${containerPayload.name} created on ${hostName(selectedHost)}`);
      if (createConfigureDelayMs > 0) await delay(createConfigureDelayMs);
      const containerConfig = { ...containerConfigPayload, id: container.id };
      await client.request("PATCH", "/api/plugins/docker/containers/", { body: [containerConfig] });
      logLine(`CREATE : container ${containerPayload.name} configured on ${hostName(selectedHost)} env=${containerConfig.env.length} labels=${containerConfig.labels.length} mounts=${containerConfig.mounts.length}`);
      if (createRecreateDelayMs > 0) await delay(createRecreateDelayMs);
      await waitForContainerConfigured(client, container.id, `${hostName(container)}/${valueText(container.display || container.name)}`);
      const ready = await requestContainerOperation(client, container, "recreate", "CREATE");
      if (ready) readyCount += 1;
    }

    const allReady = readyCount === targetHosts.length;
    if ((isOrderRequest || isEnrollRequest) && allReady) {
      try {
        await sendOrderReadyEmail(data, authUser.email || "");
      } catch (error) {
        logLine(`EMAIL : ready notification failed for ${authUser.email || ""} ${error.message || "smtp error"}`);
      }
    }
    if (isEnrollRequest) {
      await updateEnrollmentInstanceStatus(req, orderProfile, enrollTemplateName, allReady ? "ready" : "failed");
    }
    if (allHostsEnabled(data)) logLine(`CREATE : finished all hosts ready=${readyCount}/${targetHosts.length}`);
    return allReady;
  }

  return {
    createInstance,
  };
}

module.exports = { createCreateHelpers };
