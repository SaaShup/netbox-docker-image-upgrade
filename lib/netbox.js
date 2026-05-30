const { ProxyAgent, fetch } = require("undici");
const { asArray, hostMatchesTag } = require("./docker");

let netboxFetch = fetch;

class NetBoxClient {
  constructor(config) {
    this.base = String(config.netbox || "").replace(/\/+$/, "");
    this.token = config.token || "";
    this.proxy = config.proxy || "";
  }

  async request(method, apiPath, { query = {}, body, expected = [200, 201, 202, 204] } = {}) {
    if (!this.base || !this.token) {
      const error = new Error("NetBox URL and token are required");
      error.statusCode = 400;
      throw error;
    }

    const url = new URL(apiPath, this.base);
    Object.entries(query).forEach(([key, value]) => {
      for (const item of asArray(value)) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(key, item);
      }
    });
    const options = {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Token ${this.token}`,
      },
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    if (this.proxy) options.dispatcher = new ProxyAgent(this.proxy);

    const response = await netboxFetch(url, options);
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = text;
    }
    if (!expected.includes(response.status)) {
      const error = new Error(`NetBox request failed ${response.status}`);
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }
    return { statusCode: response.status, payload };
  }

  async list(apiPath, query = {}) {
    const { payload } = await this.request("GET", apiPath, { query });
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
  }
}

function setNetBoxFetchForTests(fetchImpl) {
  netboxFetch = fetchImpl || fetch;
}

async function dockerHosts(client, tag = "") {
  const hosts = await client.list("/api/plugins/docker/hosts/", { limit: 1000 });
  return hosts.filter((host) => hostMatchesTag(host, tag));
}

async function hostIdQuery(client, tag = "") {
  if (!tag) return {};
  const hosts = await dockerHosts(client, tag);
  return hosts.length ? { host_id: hosts.map((host) => host.id) } : { host_id: "__none__" };
}

module.exports = {
  NetBoxClient,
  dockerHosts,
  hostIdQuery,
  setNetBoxFetchForTests,
};
