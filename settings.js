const fs = require("fs");
const path = require("path");
const data = require("./package.json")
const proxyEnv = {};
const adminAllowedEmails = String(process.env.ADMIN_ALLOWED_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
const dataPath = path.resolve(process.env.DATAPATH || "/data");
const globalContextFile = path.join(dataPath, "context", "global", "global.json");
const forbiddenPage = fs.readFileSync(path.join(__dirname, "public", "forbidden.html"), "utf8");
const startedAt = Date.now();
const metrics = {
    httpRequests: {
        "/": 0,
        "/admin": 0,
        "/config": 0,
        "/create": 0,
        "/delete": 0,
        "/metrics": 0,
        "/order": 0,
        "/nodered": 0,
        "/recreate": 0,
        "/refresh-hosts": 0,
        "/restart": 0,
        "/session/user": 0,
        "/version": 0,
        "/webhook": 0,
        other: 0,
    },
    operationRequests: {
        config: {},
        create: {},
        delete: {},
        refresh: {},
        restart: {},
        upgrade: {},
    },
    adminForbidden: 0,
};
const statusClasses = ["1xx", "2xx", "3xx", "4xx", "5xx", "other"];

Object.values(metrics.operationRequests).forEach((operation) => {
    statusClasses.forEach((statusClass) => {
        operation[statusClass] = 0;
    });
});

function prometheusLabel(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function metricLine(name, value, labels = {}) {
    const labelEntries = Object.entries(labels);
    const labelText = labelEntries.length
        ? `{${labelEntries.map(([key, label]) => `${key}="${prometheusLabel(label)}"`).join(",")}}`
        : "";

    return `${name}${labelText} ${value}`;
}

function routeLabel(req) {
    const requestPath = String(req.originalUrl || req.url || "").split("?")[0].replace(/\/+$/, "") || "/";

    if (requestPath === "/") return "/";
    if (requestPath === "/admin" || requestPath === "/admin.html") return "/admin";
    if (requestPath === "/config") return "/config";
    if (requestPath === "/create") return "/create";
    if (requestPath === "/delete") return "/delete";
    if (requestPath === "/metrics") return "/metrics";
    if (requestPath === "/order" || requestPath === "/order.html") return "/order";
    if (requestPath.startsWith("/nodered")) return "/nodered";
    if (requestPath === "/recreate") return "/recreate";
    if (requestPath === "/refresh-hosts") return "/refresh-hosts";
    if (requestPath === "/restart") return "/restart";
    if (requestPath === "/session/user") return "/session/user";
    if (requestPath === "/version") return "/version";
    if (requestPath === "/webhook") return "/webhook";

    return "other";
}

function incrementRequestMetric(req) {
    const label = routeLabel(req);
    metrics.httpRequests[label] = (metrics.httpRequests[label] || 0) + 1;
}

function operationLabel(req) {
    const label = routeLabel(req);
    const operations = {
        "/config": "config",
        "/create": "create",
        "/delete": "delete",
        "/recreate": "upgrade",
        "/refresh-hosts": "refresh",
        "/restart": "restart",
        "/webhook": "config",
    };

    return operations[label] || "";
}

function statusClass(statusCode) {
    const code = Number(statusCode);
    if (code >= 100 && code < 600) return `${Math.floor(code / 100)}xx`;
    return "other";
}

function trackOperationMetric(req, res) {
    const operation = operationLabel(req);
    if (!operation) return;

    res.once("finish", () => {
        const bucket = statusClass(res.statusCode);
        metrics.operationRequests[operation][bucket] = (metrics.operationRequests[operation][bucket] || 0) + 1;
    });
}

function readJsonFile(filePath, fallback = {}) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function maxInstancesValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;

    return Math.min(10, Math.max(0, Math.floor(number)));
}

function userOrderKey(req) {
    const { email, user } = authUserFromRequest(req);
    return String(email || user || req.ip || "anonymous").trim().toLowerCase();
}

function formBodyFromParams(params) {
    const body = {};

    for (const [key, value] of params.entries()) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
            body[key] = Array.isArray(body[key]) ? [...body[key], value] : [body[key], value];
        } else {
            body[key] = value;
        }
    }

    return body;
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > 1024 * 1024) {
                reject(new Error("Request body too large"));
                req.destroy();
                return;
            }

            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

function parseProfilesValue(value) {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function savedConfig() {
    const context = readJsonFile(globalContextFile, {});
    return context && typeof context.config === "object" && context.config ? context.config : {};
}

function savedGlobalContext() {
    const context = readJsonFile(globalContextFile, {});
    return context && typeof context === "object" && !Array.isArray(context) ? context : {};
}

function orderCounts() {
    const counts = savedGlobalContext().order_counts;
    return counts && typeof counts === "object" && !Array.isArray(counts) ? counts : {};
}

function writeOrderCounts(counts) {
    const context = savedGlobalContext();
    context.order_counts = counts && typeof counts === "object" && !Array.isArray(counts) ? counts : {};
    writeJsonFile(globalContextFile, context);
}

function plainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function portableConfigPayload() {
    const context = savedGlobalContext();
    const config = plainObject(context.config);
    const profiles = parseProfilesValue(config.profiles);

    return {
        type: "saashup-config-export",
        version: 1,
        app_version: data.version,
        exported_at: new Date().toISOString(),
        config: {
            ...config,
            profiles,
        },
        templates: plainObject(context.templates),
        order_counts: plainObject(context.order_counts),
    };
}

function normalizeImportedConfig(input) {
    const config = { ...plainObject(input.config) };
    const profiles = parseProfilesValue(input.profiles || config.profiles);
    const profileNames = Object.keys(profiles).sort((a, b) => a.localeCompare(b));

    if (profileNames.length) {
        config.profiles = JSON.stringify(profiles);

        if (!config.profile || !profiles[config.profile]) {
            config.profile = profileNames[0];
        }

        if (!config.config_profile || !profiles[config.config_profile]) {
            config.config_profile = config.profile;
        }

        const selectedProfile = profiles[config.profile] || {};
        ["netbox", "token", "proxy", "domain", "tag", "max_instances"].forEach((key) => {
            if (config[key] === undefined && selectedProfile[key] !== undefined) {
                config[key] = selectedProfile[key];
            }
        });
    }

    return config;
}

function handlePortableConfigExport(res) {
    const payload = portableConfigPayload();
    const date = new Date().toISOString().slice(0, 10);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="saashup-config-${date}.json"`);
    res.end(JSON.stringify(payload, null, 2));
}

function handlePortableConfigImport(req, res) {
    readRequestBody(req)
        .then((rawBody) => {
            const payload = JSON.parse(rawBody || "{}");
            const context = savedGlobalContext();

            context.config = normalizeImportedConfig(payload);
            context.templates = plainObject(payload.templates);
            context.order_counts = plainObject(payload.order_counts);

            writeJsonFile(globalContextFile, context);

            sendJson(res, 200, {
                status: "imported",
                profiles: Object.keys(parseProfilesValue(context.config.profiles)).length,
                templates: Object.keys(context.templates).length,
            });
        })
        .catch(() => {
            sendJson(res, 400, {
                code: "invalid_config_import",
                detail: "Unable to import config export.",
            });
        });
}

function maxInstancesForProfile(profile) {
    const profileName = String(profile || "").trim();
    const config = savedConfig();
    const profiles = parseProfilesValue(config.profiles);

    if (profileName && Object.prototype.hasOwnProperty.call(profiles, profileName)) {
        return maxInstancesValue(profiles[profileName]?.max_instances);
    }

    if (!profileName || profileName === config.profile || profileName === config.config_profile) {
        return maxInstancesValue(config.max_instances);
    }

    return 1;
}

function orderUsage(req, profile) {
    const profileName = String(profile || "").trim();
    const counts = orderCounts();
    const userKey = userOrderKey(req);
    const used = Number(counts[userKey]?.[profileName] || 0);
    const max = maxInstancesForProfile(profileName);

    return {
        max,
        profile: profileName,
        remaining: Math.max(0, max - used),
        reached: used >= max,
        used,
    };
}

function incrementOrderUsage(req, profile) {
    const profileName = String(profile || "").trim();
    const userKey = userOrderKey(req);
    const counts = orderCounts();

    if (!counts[userKey]) counts[userKey] = {};
    counts[userKey][profileName] = Number(counts[userKey][profileName] || 0) + 1;
    writeOrderCounts(counts);
}

function sendJson(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
}

function handleOrderLimitStatus(req, res) {
    const url = new URL(req.originalUrl || req.url || "", "http://localhost");
    sendJson(res, 200, orderUsage(req, url.searchParams.get("profile")));
}

function handleCreateOrderLimit(req, res, next) {
    readRequestBody(req)
        .then((rawBody) => {
            const params = new URLSearchParams(rawBody);
            req.body = formBodyFromParams(params);
            req._body = true;

            if (params.get("order_request") !== "true") {
                next();
                return;
            }

            const profile = params.get("profile") || params.get("config_profile") || "";
            const usage = orderUsage(req, profile);

            if (usage.reached) {
                sendJson(res, 429, {
                    code: "max_instances_reached",
                    detail: `You have reached your maximum of ${usage.max} instance${usage.max === 1 ? "" : "s"} for this config.`,
                    max_instances: usage.max,
                    used_instances: usage.used,
                });
                return;
            }

            res.once("finish", () => {
                if (res.statusCode === 202) {
                    incrementOrderUsage(req, profile);
                }
            });

            next();
        })
        .catch(() => {
            sendJson(res, 400, {
                code: "invalid_order_request",
                detail: "Unable to read order request.",
            });
        });
}

function metricsPayload() {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const activeHandles = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : 0;
    const lines = [
        "# HELP saashup_app_info Application build information.",
        "# TYPE saashup_app_info gauge",
        metricLine("saashup_app_info", 1, {
            name: data.name,
            version: data.version,
            node_version: process.version,
        }),
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
        "# HELP saashup_nodejs_active_handles Active Node.js handles.",
        "# TYPE saashup_nodejs_active_handles gauge",
        metricLine("saashup_nodejs_active_handles", activeHandles),
        "# HELP saashup_admin_allowed_emails Configured admin allowlist email count.",
        "# TYPE saashup_admin_allowed_emails gauge",
        metricLine("saashup_admin_allowed_emails", adminAllowedEmails.length),
        "# HELP saashup_admin_forbidden_total Total denied admin requests.",
        "# TYPE saashup_admin_forbidden_total counter",
        metricLine("saashup_admin_forbidden_total", metrics.adminForbidden),
        "# HELP saashup_http_requests_total Total HTTP requests seen by the app middleware.",
        "# TYPE saashup_http_requests_total counter",
        ...Object.entries(metrics.httpRequests).map(([route, value]) => metricLine("saashup_http_requests_total", value, { route })),
        "# HELP saashup_operation_requests_total Total operation requests by operation and response status class.",
        "# TYPE saashup_operation_requests_total counter",
        ...Object.entries(metrics.operationRequests).flatMap(([operation, values]) => (
            Object.entries(values).map(([status_class, value]) => metricLine("saashup_operation_requests_total", value, { operation, status_class }))
        )),
        "",
    ];

    return lines.join("\n");
}

function firstHeader(req, names) {
    for (const name of names) {
        const value = req.headers?.[name];
        if (Array.isArray(value) && value[0]) return value[0];
        if (value) return value;
    }

    return "";
}

function authUserFromRequest(req) {
    const email = firstHeader(req, [
        "x-auth-request-email",
        "x-forwarded-email",
        "x-auth-request-user-email",
    ]);
    const user = firstHeader(req, [
        "x-auth-request-user",
        "x-forwarded-user",
        "x-auth-request-preferred-username",
        "x-forwarded-preferred-username",
    ]);
    const name = firstHeader(req, [
        "x-auth-request-preferred-username",
        "x-forwarded-preferred-username",
        "x-auth-request-user",
        "x-forwarded-user",
        "x-auth-request-email",
        "x-forwarded-email",
    ]);

    if (name || user || email || !("ENABLE_EDITOR" in process.env)) {
        return { user, email, name };
    }

    const devUser = process.env.USER || process.env.LOGNAME || "Local dev";
    return { user: devUser, email: "", name: devUser };
}

function isAdminRequest(req) {
    const requestPath = String(req.originalUrl || req.url || "").split("?")[0].replace(/\/+$/, "") || "/";

    return requestPath === "/admin" || requestPath === "/admin.html" || requestPath.startsWith("/nodered");
}

function isAdminAllowed(req) {
    if (!adminAllowedEmails.length) return true;

    const { email } = authUserFromRequest(req);
    return Boolean(email && adminAllowedEmails.includes(String(email).toLowerCase()));
}

function denyAdmin(res) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(forbiddenPage);
}

function authUserMiddleware(req, res, next) {
    const requestPath = String(req.url || "").split("?")[0];
    const method = String(req.method || "").toUpperCase();
    incrementRequestMetric(req);
    trackOperationMetric(req, res);

    if (requestPath === "/metrics") {
        res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.end(metricsPayload());
        return;
    }

    if (requestPath === "/version") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
            name: data.name,
            version: data.version,
        }));
        return;
    }

    if (requestPath === "/session/user") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(authUserFromRequest(req)));
        return;
    }

    if (requestPath === "/order/limit") {
        handleOrderLimitStatus(req, res);
        return;
    }

    if (requestPath === "/portable-config") {
        if (!isAdminAllowed(req)) {
            metrics.adminForbidden += 1;
            denyAdmin(res);
            return;
        }

        if (method === "GET") {
            handlePortableConfigExport(res);
            return;
        }

        if (method === "POST") {
            handlePortableConfigImport(req, res);
            return;
        }

        sendJson(res, 405, { code: "method_not_allowed" });
        return;
    }

    if (isAdminRequest(req) && !isAdminAllowed(req)) {
        metrics.adminForbidden += 1;
        denyAdmin(res);
        return;
    }

    if (requestPath === "/create" && method === "POST") {
        handleCreateOrderLimit(req, res, next);
        return;
    }

    next();
}

module.exports = {
    credentialSecret: "saashup",
    flowFile: "flows.json",
    flowFilePretty: true,
    adminAuth: {
        type: "credentials",
        users: [{
            username: process.env.ADMIN_USERNAME || "admin",
            password: process.env.ADMIN_PASSWORD || "$2a$08$s.NFdSn4Gm4d7gHErya//e6O8RO1/3f7TZ7zflXJ9jfFV0cI6jGwK",
            permissions: "*"
        }]
    },
    uiPort: process.env.PORT || 1880,
    disableEditor: !('ENABLE_EDITOR' in process.env),
    httpStatic: [
        { path: 'public', root: '/', middleware: authUserMiddleware },
    ],
    httpAdminRoot: '/nodered',
    httpAdminMiddleware: authUserMiddleware,
    httpNodeRoot: "/",
    httpNodeMiddleware: authUserMiddleware,
    diagnostics: {
        enabled: true,
        ui: true,
    },
    runtimeState: {
        enabled: false,
        ui: false,
    },
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false,
            handler: function(settings) {
                return function(msg) {
                    const level = {
                        20: 'error',
                        30: 'warn',
                        40: 'info'
                    };
                    const lvl = "level" in msg ? msg.level : "40";

                    delete msg.type;
                    delete msg.z;
                    delete msg.path;
                    delete msg.name;
                    delete msg.id;

                    let line = `${data.name} level=${level[lvl]} version=${data.version}`;

                    if (typeof msg.msg === 'object') {
                        for (const key of Object.keys(msg.msg)) {
                            line += ` ${key}=${JSON.stringify(msg.msg[key])}`;
                        }
                    } else {
                        line += ` msg=` + JSON.stringify(msg.msg);
                    }

                    if (lvl <= 20) {
                        return console.error(line);
                    }

                    return console.log(line);
                }
            }
        }
    },
    contextStorage: {
        default: {
            module: "localfilesystem"
        }
    },
    exportGlobalContextKeys: false,
    externalModules: {
    },
    editorTheme: {
        tours: false,
        palette: {
        },
        projects: {
            enabled: false,
            workflow: {
                mode: "manual"
            }
        },
        codeEditor: {
            lib: "monaco",
            options: {
            }
        },
        markdownEditor: {
            mermaid: {
                enabled: true
            }
        },
    },
    functionExternalModules: true,
    functionTimeout: 0,
    proxyOptions: {
        env: proxyEnv,
    },
    functionGlobalContext: {
        proxyEnv,
        operationTimeoutSeconds: Number(process.env.OPERATION_TIMEOUT_SECONDS || 30),
    },
    debugMaxLength: 1000,
    mqttReconnectTime: 15000,
    serialReconnectTime: 15000
}
