function createReportHandlers({
  containerEnvValue,
  dockerHosts,
  imageNameFromRef,
  logLine,
  NetBoxClient,
  ownerEnvVarName,
  parseProfiles,
  plainObject,
  readState,
  selectedProfileConfig,
  valueText,
}) {
  function reportProfiles(source) {
    const state = readState();
    const config = plainObject(state.config);
    const profiles = parseProfiles(config.profiles);
    const requested = source.profile || source.config_profile || "";
    const profileConfig = (name) => ({
      ...config,
      ...plainObject(profiles[name]),
      ...plainObject(source),
      profile: name,
      config_profile: name,
    });

    if (requested && requested !== "all") {
      return [{ name: requested, config: profileConfig(requested) }];
    }

    const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
    if (requested === "all" && names.length) {
      return names.map((name) => ({ name, config: profileConfig(name) }));
    }

    const selected = config.profile || config.config_profile || names[0] || "";
    if (selected) {
      return [{ name: selected, config: profileConfig(selected) }];
    }

    return [{ name: "", config: selectedProfileConfig(source) }];
  }

  function localOrderReportUsers() {
    return [];
  }

  async function imageReportForProfile(name, config) {
    const label = name || "default";
    if (!config.netbox || !config.token) {
      logLine(`REPORT_IMAGE : ${label} skipped missing NetBox config`);
      return { hosts: 0, rows: [] };
    }

    const client = new NetBoxClient(config);
    const hosts = await dockerHosts(client, config.tag);
    if (!hosts.length) {
      logLine(`REPORT_IMAGE : ${label} no Docker hosts found${config.tag ? ` with tag ${config.tag}` : ""}`);
      return { hosts: 0, rows: [] };
    }

    logLine(`REPORT_IMAGE : ${label} scanning ${hosts.length} host${hosts.length === 1 ? "" : "s"}${config.tag ? ` tag=${config.tag}` : ""}`);
    const images = await client.list("/api/plugins/docker/images/", { limit: 1000, host_id: hosts.map((host) => host.id) });
    logLine(`REPORT_IMAGE : ${label} found ${images.length} image record${images.length === 1 ? "" : "s"}`);
    const groups = new Map();
    const ownerEnvName = ownerEnvVarName(config);
    const owners = new Set();
    const usersByOwner = new Map();

    for (const image of images) {
      const imageName = imageNameFromRef(image.name || image.display || "");
      const version = valueText(image.version || image.tag);
      if (!imageName || !version || !image.id) continue;

      const key = `${imageName}\u0000${version}`;
      if (!groups.has(key)) {
        groups.set(key, {
          profile: name,
          image: imageName,
          version,
          image_ids: [],
          containers: 0,
        });
      }
      groups.get(key).image_ids.push(image.id);
    }

    for (const row of groups.values()) {
      const containers = await client.list("/api/plugins/docker/containers/", { limit: 1000, image_id: row.image_ids });
      row.containers = containers.length;
      containers.forEach((container) => {
        const owner = containerEnvValue(container, ownerEnvName);
        if (!owner) return;

        owners.add(owner);
        if (!usersByOwner.has(owner)) {
          usersByOwner.set(owner, {
            user: owner,
            profiles: new Set(),
            items: [],
            imageKeys: new Set(),
          });
        }

        const user = usersByOwner.get(owner);
        user.profiles.add(name || "default");
        user.imageKeys.add(`${row.image}\u0000${row.version}`);
        user.items.push({
          profile: name || "default",
          container: valueText(container.display || container.name || container.id),
          image: row.image,
          version: row.version,
        });
      });
      logLine(`REPORT_IMAGE : ${label} ${row.image}:${row.version} containers=${row.containers}`);
    }

    const rows = Array.from(groups.values())
      .map(({ image_ids, ...row }) => row)
      .sort((left, right) => left.profile.localeCompare(right.profile) || left.image.localeCompare(right.image) || left.version.localeCompare(right.version, undefined, { numeric: true, sensitivity: "base" }));

    const users = Array.from(usersByOwner.values())
      .map((user) => ({
        user: user.user,
        profiles: [...user.profiles],
        containers: user.items.length,
        images: user.imageKeys.size,
        items: user.items.sort((left, right) => left.profile.localeCompare(right.profile) || left.container.localeCompare(right.container) || left.image.localeCompare(right.image)),
      }))
      .sort((left, right) => left.user.localeCompare(right.user));

    logLine(`REPORT_IMAGE : ${label} found ${owners.size} owner${owners.size === 1 ? "" : "s"} from ${ownerEnvName}`);
    return { hosts: hosts.length, rows, owners: [...owners], users };
  }

  async function reportImages(req, res) {
    try {
      const profiles = reportProfiles(req.query);
      const requestedProfile = req.query.profile || req.query.config_profile || "";
      const profileNames = profiles.map((item) => item.name || "default").join(",");
      logLine(`REPORT_IMAGE : starting profile=${requestedProfile || "selected"} profiles=${profileNames}`);
      const results = [];
      const owners = new Set();
      const usersByOwner = new Map();
      let totalHosts = 0;

      for (const item of profiles) {
        const report = await imageReportForProfile(item.name, item.config);
        totalHosts += report.hosts;
        results.push(...report.rows);
        (report.owners || []).forEach((owner) => owners.add(owner));
        (report.users || []).forEach((user) => {
          if (!usersByOwner.has(user.user)) {
            usersByOwner.set(user.user, {
              user: user.user,
              profiles: new Set(),
              items: [],
              imageKeys: new Set(),
            });
          }

          const target = usersByOwner.get(user.user);
          (user.profiles || []).forEach((profile) => target.profiles.add(profile));
          for (const owned of user.items || []) {
            target.items.push(owned);
            target.imageKeys.add(`${owned.image}\u0000${owned.version}`);
          }
        });
      }

      const netboxUsers = Array.from(usersByOwner.values())
        .map((user) => ({
          user: user.user,
          profiles: [...user.profiles].sort((left, right) => left.localeCompare(right)),
          containers: user.items.length,
          images: user.imageKeys.size,
          items: user.items.sort((left, right) => left.profile.localeCompare(right.profile) || left.container.localeCompare(right.container) || left.image.localeCompare(right.image)),
        }))
        .sort((left, right) => left.user.localeCompare(right.user));
      const users = netboxUsers.length ? netboxUsers : localOrderReportUsers(requestedProfile, profiles);

      const payload = {
        profile: requestedProfile,
        rows: results,
        users,
        total_hosts: totalHosts,
        total_images: results.length,
        total_containers: results.reduce((total, row) => total + Number(row.containers || 0), 0),
        total_users: users.length,
      };
      logLine(`REPORT_IMAGE : finished profile=${requestedProfile || "selected"} hosts=${payload.total_hosts} images=${payload.total_images} containers=${payload.total_containers} users=${payload.total_users}`);
      res.json(payload);
    } catch (error) {
      logLine(`REPORT_IMAGE : failed ${error.message || "report error"}`);
      res.status(error.statusCode || 502).json({ detail: error.message, payload: error.payload });
    }
  }

  return { reportImages };
}

module.exports = { createReportHandlers };
