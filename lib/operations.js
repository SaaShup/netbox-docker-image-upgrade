const {
  hostName,
  instanceZone,
  isContainerStopped,
  isOperationDone,
  isReadyContainer,
  normalizedStatus,
  valueText,
} = require("./docker");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createOperationHelpers({ logLine, operationPollMs, operationTimeoutSeconds }) {
  async function waitForContainerReady(client, id, displayName, operation) {
    const deadline = Date.now() + operationTimeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const { payload } = await client.request("GET", `/api/plugins/docker/containers/${id}/`);
      if (isReadyContainer(payload)) {
        logLine(`${operation} : ${displayName} ready status=${normalizedStatus(payload, "status")} operation=${normalizedStatus(payload, "operation")}`);
        return true;
      }
      await delay(operationPollMs);
    }
    logLine(`${operation} : ${displayName} timeout after ${operationTimeoutSeconds}s, moving to next item`);
    return false;
  }

  async function waitForContainerConfigured(client, id, displayName) {
    const deadline = Date.now() + operationTimeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const { payload } = await client.request("GET", `/api/plugins/docker/containers/${id}/`);
      const state = normalizedStatus(payload, "state");
      const status = normalizedStatus(payload, "status");
      if ((state && state !== "none" && state !== "null") || (status && status !== "none" && status !== "null")) {
        logLine(`CREATE : ${displayName} configured state=${state || "unknown"} status=${status || "unknown"}`);
        return true;
      }
      await delay(operationPollMs);
    }
    logLine(`CREATE : ${displayName} still has state=none after ${operationTimeoutSeconds}s, requesting recreate anyway`);
    return false;
  }

  async function waitForContainerStopped(client, id, displayName, operation = "DELETE") {
    const deadline = Date.now() + operationTimeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const { payload } = await client.request("GET", `/api/plugins/docker/containers/${id}/`);
      if (isContainerStopped(payload) && isOperationDone(payload)) {
        logLine(`${operation} : ${displayName} stopped status=${normalizedStatus(payload, "status")} state=${normalizedStatus(payload, "state")} operation=${normalizedStatus(payload, "operation")}`);
        return true;
      }
      await delay(operationPollMs);
    }
    if (operation === "DELETE") {
      logLine(`DELETE : ${displayName} stop timeout after ${operationTimeoutSeconds}s, attempting delete`);
    } else {
      logLine(`${operation} : ${displayName} timeout after ${operationTimeoutSeconds}s, moving to next item`);
    }
    return false;
  }

  async function waitForHostReady(client, id, displayName) {
    const deadline = Date.now() + operationTimeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const { payload } = await client.request("GET", `/api/plugins/docker/hosts/${id}/`);
      if (isOperationDone(payload)) {
        logLine(`REFRESH_HOST : ${displayName} refresh complete operation=${normalizedStatus(payload, "operation")} state=${normalizedStatus(payload, "state")}`);
        return true;
      }
      await delay(operationPollMs);
    }
    logLine(`REFRESH_HOST : ${displayName} timeout after ${operationTimeoutSeconds}s, moving to next host`);
    return false;
  }

  async function requestContainerOperation(client, container, operation, prefix) {
    const display = `${hostName(container)}/${valueText(container.display || container.name)}`;
    await client.request("PATCH", "/api/plugins/docker/containers/", { body: [{ id: container.id, operation }] });
    logLine(`${prefix} : ${display} ${operation} requested`);
    if (operation === "stop" || operation === "kill") {
      return waitForContainerStopped(client, container.id, display, prefix);
    }
    return waitForContainerReady(client, container.id, display, prefix);
  }

  async function ensureImageOnHost(client, oldImage, image, version) {
    const hostId = oldImage.host?.id || oldImage.host;
    const matches = await client.list("/api/plugins/docker/images/", { name: image, version, host_id: hostId });
    if (matches[0]) return matches[0];

    const { payload } = await client.request("POST", "/api/plugins/docker/images/", {
      body: {
        host: hostId,
        name: image,
        version,
        registry: oldImage.registry?.id || oldImage.registry,
      },
      expected: [200, 201, 202],
    });
    const created = Array.isArray(payload) ? payload[0] : payload;
    logLine(`RECREATE : created image ${image}:${version} on ${hostName(oldImage)} status=201`);
    await delay(5000);
    return created;
  }

  async function createDnsRecord(client, data, host) {
    const zoneName = instanceZone(data.instance);
    if (!zoneName) {
      logLine(`CREATE : DNS zone not found in instance ${data.instance || ""}`);
      return;
    }

    try {
      const zones = await client.list("/api/plugins/cloudflare/dns/accounts/", { name: zoneName });
      if (!zones.length) {
        logLine(`CREATE : Cloudflare zone not found for ${zoneName} while creating ${data.instance} count=0`);
        return;
      }

      const hostname = valueText(host.display || host.name || host);
      const { statusCode } = await client.request("POST", "/api/plugins/cloudflare/dns/records/", {
        body: {
          zone: zones[0].id,
          name: data.instance,
          type: "CNAME",
          content: `${hostname}.${zoneName}`,
          ttl: 60,
          proxied: true,
        },
      });
      logLine(`CREATE : Cloudflare DNS record requested for ${data.instance} -> ${hostname}.${zoneName} status=${statusCode}`);
    } catch (error) {
      logLine(`CREATE : Cloudflare DNS record failed for ${data.instance || ""} ${error.message || "unknown error"}`);
    }
  }

  async function deleteDnsRecord(client, data) {
    try {
      const records = await client.list("/api/plugins/cloudflare/dns/records/", { name: data.instance });
      if (!records.length) {
        logLine(`DELETE : Cloudflare DNS record not found for ${data.instance} count=0`);
        return;
      }

      const { statusCode } = await client.request("DELETE", `/api/plugins/cloudflare/dns/records/${records[0].id}/`, { expected: [200, 202, 204] });
      logLine(`DELETE : Cloudflare DNS record delete requested for ${data.instance} status=${statusCode}`);
    } catch (error) {
      logLine(`DELETE : Cloudflare DNS record delete failed for ${data.instance || ""} ${error.message || "unknown error"}`);
    }
  }

  return {
    createDnsRecord,
    deleteDnsRecord,
    ensureImageOnHost,
    requestContainerOperation,
    waitForContainerConfigured,
    waitForContainerStopped,
    waitForHostReady,
  };
}

module.exports = {
  createOperationHelpers,
  delay,
};
