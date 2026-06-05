const {
  hostName,
  dnsHostNameFromData,
  dnsNameFromData,
  dnsPartsFromName,
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

  function imagePullIdentifier(image) {
    const values = [
      image?.imageID,
      image?.imageId,
      image?.image_id,
      image?.digest,
      image?.Digest,
      image?.repo_digest,
      image?.repoDigest,
    ];
    return values.find((value) => Array.isArray(value) ? value.length : String(value || "").trim()) || "";
  }

  async function waitForImagePulled(client, image, displayName, prefix = "RECREATE") {
    const identifier = imagePullIdentifier(image);
    if (identifier) return image;
    if (!image?.id) throw new Error(`image ${displayName} was created without an id`);

    const deadline = Date.now() + operationTimeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const { payload } = await client.request("GET", `/api/plugins/docker/images/${image.id}/`);
      const pulledIdentifier = imagePullIdentifier(payload);
      if (pulledIdentifier) {
        const identifierText = Array.isArray(pulledIdentifier) ? pulledIdentifier.join(",") : pulledIdentifier;
        logLine(`${prefix} : image ${displayName} pulled identifier=${identifierText}`);
        return payload;
      }
      await delay(operationPollMs);
    }
    logLine(`${prefix} : image ${displayName} pull timeout after ${operationTimeoutSeconds}s`);
    throw new Error(`image ${displayName} was not pulled after ${operationTimeoutSeconds}s`);
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

  function imageRegistryId(image) {
    return image?.registry?.id || image?.registry || "";
  }

  async function registryForImage(client, target, image) {
    const directRegistry = imageRegistryId(target);
    if (directRegistry) return directRegistry;

    const host = target?.host || target;
    const hostId = host?.id || host;
    const hostMatches = hostId ? await client.list("/api/plugins/docker/images/", { name: image, host_id: hostId, limit: 1 }) : [];
    const hostRegistry = imageRegistryId(hostMatches[0]);
    if (hostRegistry) return hostRegistry;

    const globalMatches = await client.list("/api/plugins/docker/images/", { name: image, limit: 1 });
    return imageRegistryId(globalMatches[0]);
  }

  async function ensureImageOnHost(client, target, image, version, prefix = "RECREATE") {
    const host = target?.host || target;
    const hostId = host?.id || host;
    const matches = await client.list("/api/plugins/docker/images/", { name: image, version, host_id: hostId });
    if (matches[0]) return matches[0];

    const registry = await registryForImage(client, target, image);
    if (!registry) throw new Error(`registry not found for image ${image}`);

    const { payload, statusCode } = await client.request("POST", "/api/plugins/docker/images/", {
      body: {
        host: hostId,
        name: image,
        version,
        registry,
      },
      expected: [200, 201, 202],
    });
    const created = Array.isArray(payload) ? payload[0] : payload;
    const displayName = `${image}:${version} on ${hostName(host)}`;
    logLine(`${prefix} : created image ${displayName} status=${statusCode}`);
    return waitForImagePulled(client, created, displayName, prefix);
  }

  async function createDnsRecord(client, data, host) {
    const dnsName = dnsNameFromData(data);
    const dnsParts = dnsPartsFromName(dnsName);
    if (dnsParts.path) {
      logLine(`CREATE : Cloudflare DNS record skipped for ${dnsName} because it includes path info`);
      return;
    }
    const dnsHostName = dnsHostNameFromData(data);
    const zoneName = instanceZone(dnsHostName);
    if (!zoneName) {
      logLine(`CREATE : DNS zone not found in DNS name ${dnsName || ""}`);
      return;
    }

    try {
      const zones = await client.list("/api/plugins/cloudflare/dns/accounts/", { name: zoneName });
      if (!zones.length) {
        logLine(`CREATE : Cloudflare zone not found for ${zoneName} while creating ${dnsName} count=0`);
        return;
      }

      const hostname = valueText(host.display || host.name || host);
      const { statusCode } = await client.request("POST", "/api/plugins/cloudflare/dns/records/", {
        body: {
          zone: zones[0].id,
          name: dnsHostName,
          type: "CNAME",
          content: `${hostname}.${zoneName}`,
          ttl: 60,
          proxied: true,
        },
      });
      logLine(`CREATE : Cloudflare DNS record requested for ${dnsHostName} -> ${hostname}.${zoneName} status=${statusCode}`);
    } catch (error) {
      logLine(`CREATE : Cloudflare DNS record failed for ${dnsName} ${error.message || "unknown error"}`);
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
    imagePullIdentifier,
    requestContainerOperation,
    waitForImagePulled,
    waitForContainerConfigured,
    waitForContainerStopped,
    waitForHostReady,
  };
}

module.exports = {
  createOperationHelpers,
  delay,
};
