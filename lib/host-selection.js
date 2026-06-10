function hostIdValue(value) {
  return String(value?.id || value || "");
}

function hostLoadStats(hosts, containers) {
  return hosts.map((host) => {
    const hostId = hostIdValue(host.id);
    return {
      host,
      count: containers.filter((container) => hostIdValue(container.host) === hostId).length,
    };
  });
}

function leastLoadedHostFromStats(stats) {
  return [...stats].sort((left, right) => left.count - right.count)[0]?.host;
}

function imageHostId(image) {
  const host = image?.host || "";
  return String(host?.id || host || "");
}

async function hostsWithRequestedImage(client, hosts, data) {
  const image = String(data.image || "").trim();
  const version = String(data.version || "").trim();
  if (!image || !version || !hosts.length) return [];

  const hostIds = new Set(hosts.map((host) => hostIdValue(host.id)));
  const images = await client.list("/api/plugins/docker/images/", {
    name: image,
    version,
    host_id: [...hostIds],
    limit: 1000,
  });
  const readyHostIds = new Set(images
    .filter((item) => String(item?.name || "") === image && String(item?.version || "") === version)
    .map(imageHostId)
    .filter((id) => hostIds.has(id)));
  return hosts.filter((host) => readyHostIds.has(hostIdValue(host.id)));
}

async function selectImageAwareHost(client, hosts, containers, data) {
  const loadStats = hostLoadStats(hosts, containers);
  const imageReadyHosts = await hostsWithRequestedImage(client, hosts, data);
  const candidateHosts = imageReadyHosts.length ? imageReadyHosts : hosts;
  const candidateStats = hostLoadStats(candidateHosts, containers);
  const selected = leastLoadedHostFromStats(candidateStats);
  const selectedStats = candidateStats.find((item) => item.host === selected);

  return {
    candidateStats,
    imageReadyHosts,
    loadStats,
    selected,
    selectedCount: selectedStats?.count ?? 0,
  };
}

module.exports = {
  hostLoadStats,
  selectImageAwareHost,
};
