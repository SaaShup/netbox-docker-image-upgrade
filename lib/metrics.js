const routeNames = ["/", "/admin", "/config", "/create", "/delete", "/dockerhub", "/images", "/instances", "/logs", "/metrics", "/order", "/portable-config", "/recreate", "/refresh-hosts", "/report/images", "/restart", "/session/user", "/templates", "/test", "/version", "/webhook", "other"];
const operationNames = ["config", "create", "delete", "refresh", "restart", "upgrade"];

function createMetrics() {
  return {
    adminForbidden: 0,
    httpRequests: Object.fromEntries(routeNames.map((route) => [route, 0])),
    operationRequests: Object.fromEntries(operationNames.map((name) => [name, { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 }])),
  };
}

function routeLabel(req, metrics) {
  const requestPath = String(req.originalUrl || req.url || "").split("?")[0].replace(/\/+$/, "") || "/";
  if (requestPath === "/admin.html") return "/admin";
  if (requestPath === "/order.html") return "/order";
  if (requestPath.startsWith("/dockerhub/")) return "/dockerhub";
  if (metrics.httpRequests[requestPath] !== undefined) return requestPath;
  return "other";
}

function operationLabel(req, metrics) {
  return {
    "/config": "config",
    "/webhook": "config",
    "/create": "create",
    "/delete": "delete",
    "/refresh-hosts": "refresh",
    "/restart": "restart",
    "/recreate": "upgrade",
    "/dockerhub": "upgrade",
  }[routeLabel(req, metrics)] || "";
}

function statusClass(statusCode) {
  const code = Number(statusCode);
  if (code >= 100 && code < 600) return `${Math.floor(code / 100)}xx`;
  return "other";
}

function metricLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function metricLine(name, value, labels = {}) {
  const entries = Object.entries(labels);
  const labelText = entries.length ? `{${entries.map(([key, val]) => `${key}="${metricLabel(val)}"`).join(",")}}` : "";
  return `${name}${labelText} ${value}`;
}

module.exports = {
  createMetrics,
  metricLabel,
  metricLine,
  operationLabel,
  routeLabel,
  statusClass,
};
