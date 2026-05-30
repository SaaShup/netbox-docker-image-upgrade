const data = require("./package.json")
const proxyEnv = {};

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

function authUserMiddleware(req, res, next) {
    const requestPath = String(req.url || "").split("?")[0];

    if (requestPath === "/auth/user") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(authUserFromRequest(req)));
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
