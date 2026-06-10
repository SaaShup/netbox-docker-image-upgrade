const {
  metricLine,
  operationLabel,
  routeLabel,
  statusClass,
} = require("../lib/metrics");

function registerMetricsMiddleware(app, {
  metrics,
}) {
  app.use((req, res, next) => {
    const label = routeLabel(req, metrics);
    metrics.httpRequests[label] = (metrics.httpRequests[label] || 0) + 1;
    const operation = operationLabel(req, metrics);
    if (operation) {
      res.once("finish", () => {
        const bucket = statusClass(res.statusCode);
        metrics.operationRequests[operation][bucket] = (metrics.operationRequests[operation][bucket] || 0) + 1;
      });
    }
    next();
  });
}

function registerMetricsRoutes(app, {
  metrics,
  packageJson,
  startedAt,
}) {
  app.get("/metrics", (req, res) => {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const lines = [
      "# HELP saashup_app_info Application build information.",
      "# TYPE saashup_app_info gauge",
      metricLine("saashup_app_info", 1, { name: packageJson.name, version: packageJson.version, node_version: process.version }),
      "# HELP saashup_process_start_time_seconds Unix start time of this process.",
      "# TYPE saashup_process_start_time_seconds gauge",
      metricLine("saashup_process_start_time_seconds", Math.floor(startedAt / 1000)),
      "# HELP saashup_process_uptime_seconds Process uptime in seconds.",
      "# TYPE saashup_process_uptime_seconds gauge",
      metricLine("saashup_process_uptime_seconds", process.uptime().toFixed(3)),
      "# HELP saashup_process_memory_bytes Process memory usage by type.",
      "# TYPE saashup_process_memory_bytes gauge",
      ...Object.entries(memory).map(([type, value]) => metricLine("saashup_process_memory_bytes", value, { type })),
      "# HELP saashup_process_cpu_seconds_total Process CPU time in seconds.",
      "# TYPE saashup_process_cpu_seconds_total counter",
      metricLine("saashup_process_cpu_seconds_total", (cpu.user / 1e6).toFixed(6), { mode: "user" }),
      metricLine("saashup_process_cpu_seconds_total", (cpu.system / 1e6).toFixed(6), { mode: "system" }),
      "# HELP saashup_admin_forbidden_total Total denied admin requests.",
      "# TYPE saashup_admin_forbidden_total counter",
      metricLine("saashup_admin_forbidden_total", metrics.adminForbidden),
      "# HELP saashup_http_requests_total Total HTTP requests.",
      "# TYPE saashup_http_requests_total counter",
      ...Object.entries(metrics.httpRequests).map(([route, value]) => metricLine("saashup_http_requests_total", value, { route })),
      "# HELP saashup_operation_requests_total Total operation requests by operation and response status class.",
      "# TYPE saashup_operation_requests_total counter",
      ...Object.entries(metrics.operationRequests).flatMap(([operation, values]) => Object.entries(values).map(([status_class, value]) => metricLine("saashup_operation_requests_total", value, { operation, status_class }))),
      "",
    ];
    res.type("text/plain; version=0.0.4").send(lines.join("\n"));
  });
}

module.exports = {
  registerMetricsMiddleware,
  registerMetricsRoutes,
};
