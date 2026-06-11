const { fetch } = require("undici");

let registryFetch = fetch;

const manifestAccept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(",");

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function registryError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const supportedRegistries = {
  "docker.io": { manifestHost: "registry-1.docker.io" },
  "index.docker.io": { registry: "docker.io", manifestHost: "registry-1.docker.io" },
  "registry-1.docker.io": { registry: "docker.io", manifestHost: "registry-1.docker.io" },
  "ghcr.io": { manifestHost: "ghcr.io" },
  "quay.io": { manifestHost: "quay.io" },
  "registry.gitlab.com": { manifestHost: "registry.gitlab.com" },
};

function parseRegistryImageRef(ref) {
  const text = String(ref || "").trim();
  if (!text) throw badRequest("image is required");
  if (text.includes("@")) throw badRequest("image digests are not supported");

  const slash = text.indexOf("/");
  const firstPart = slash >= 0 ? text.slice(0, slash) : "";
  const hasRegistryHost = firstPart && (firstPart.includes(".") || firstPart.includes(":") || firstPart === "localhost");
  const registryHost = hasRegistryHost ? firstPart.toLowerCase() : "docker.io";
  const registryConfig = supportedRegistries[registryHost];
  if (!registryConfig) {
    throw badRequest("unsupported registry host");
  }
  let image = hasRegistryHost ? text.slice(slash + 1) : text;

  const registry = registryConfig.registry || registryHost;
  const manifestHost = registryConfig.manifestHost;

  const lastSlash = image.lastIndexOf("/");
  const lastColon = image.lastIndexOf(":");
  const name = lastColon > lastSlash ? image.slice(0, lastColon) : image;
  const tag = lastColon > lastSlash ? image.slice(lastColon + 1) : "latest";
  if (!name || !tag) throw badRequest("image must include a repository and tag");
  if (!/^[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*(\/[a-z0-9]+(?:(?:[._-]|__|[-]*)[a-z0-9]+)*)*$/.test(name)) {
    throw badRequest("image repository is invalid");
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw badRequest("image tag is invalid");

  const repository = registry === "docker.io" && !name.includes("/") ? `library/${name}` : name;
  return {
    registry,
    manifestHost,
    name: repository,
    tag,
  };
}

function bearerChallengeParams(header) {
  const text = String(header || "");
  const match = text.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const params = {};
  for (const part of match[1].matchAll(/([a-zA-Z_][a-zA-Z0-9_-]*)="([^"]*)"/g)) {
    params[part[1]] = part[2];
  }
  return params.realm ? params : null;
}

async function bearerTokenFromChallenge(challenge) {
  const url = new URL(challenge.realm);
  if (challenge.service) url.searchParams.set("service", challenge.service);
  if (challenge.scope) url.searchParams.set("scope", challenge.scope);
  const response = await registryFetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  const token = payload.token || payload.access_token;
  if (!response.ok || !token) throw registryError(`registry token request failed ${response.status}`);
  return token;
}

async function manifestRequest(image, token = "") {
  const url = new URL(`https://${image.manifestHost}/v2/${image.name}/manifests/${encodeURIComponent(image.tag)}`);
  return registryFetch(url, {
    method: "GET",
    headers: {
      Accept: manifestAccept,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function checkRegistryImageExists(ref) {
  const image = parseRegistryImageRef(ref);
  let response = await manifestRequest(image);
  if (response.status === 401) {
    const challenge = bearerChallengeParams(response.headers?.get?.("www-authenticate"));
    if (challenge) response = await manifestRequest(image, await bearerTokenFromChallenge(challenge));
  }

  if (response.status === 200) {
    return { registry: image.registry, name: image.name, tag: image.tag, image: `${image.name}:${image.tag}`, exists: true, status: response.status };
  }
  if ([401, 403, 404].includes(response.status)) {
    return { registry: image.registry, name: image.name, tag: image.tag, image: `${image.name}:${image.tag}`, exists: false, status: response.status };
  }
  throw registryError(`registry manifest request failed ${response.status}`, response.status === 429 ? 429 : 502);
}

function setRegistryFetchForTests(fetchImpl) {
  registryFetch = fetchImpl || fetch;
}

module.exports = {
  checkRegistryImageExists,
  parseRegistryImageRef,
  setRegistryFetchForTests,
};
