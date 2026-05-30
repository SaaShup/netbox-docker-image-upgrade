const {
  asArray,
  authUserFromRequest,
  containerPayloadFromForm,
  hostMatchesTag,
  imageNameFromRef,
  instanceShort,
  isOperationDone,
  isReadyContainer,
  maxInstancesValue,
  metricLabel,
  metricLine,
  operationLabel,
  parseProfiles,
  plainObject,
  routeLabel,
  statusClass,
  valueText,
} = require("../../server");

describe("server helpers", () => {
  test("normalizes profile JSON safely", () => {
    expect(parseProfiles('{"prod":{"tag":"PROD"}}')).toEqual({ prod: { tag: "PROD" } });
    expect(parseProfiles({ dev: { tag: "DEV" } })).toEqual({ dev: { tag: "DEV" } });
    expect(parseProfiles("[1,2,3]")).toEqual({});
    expect(parseProfiles("not json")).toEqual({});
  });

  test("clamps max instance values to the supported range", () => {
    expect(maxInstancesValue(undefined)).toBe(1);
    expect(maxInstancesValue("-3")).toBe(0);
    expect(maxInstancesValue("4.9")).toBe(4);
    expect(maxInstancesValue("99")).toBe(10);
  });

  test("matches docker host tags from NetBox and custom field fallbacks", () => {
    expect(hostMatchesTag({ tags: [{ name: "TILE" }] }, "tile")).toBe(true);
    expect(hostMatchesTag({ tags: [{ slug: "guide" }] }, "tile")).toBe(false);
    expect(hostMatchesTag({ custom_fields: { role: "tile" } }, "TILE")).toBe(true);
    expect(hostMatchesTag({ cf: { role: "tile" } }, "TILE")).toBe(true);
    expect(hostMatchesTag({ tags: [] }, "")).toBe(true);
  });

  test("extracts image names without stripping registry ports", () => {
    expect(imageNameFromRef("registry.example.com:5000/saashup/tile-api:v2.4.1")).toBe("registry.example.com:5000/saashup/tile-api");
    expect(imageNameFromRef("saashup/tile-api")).toBe("saashup/tile-api");
  });

  test("builds create container payloads from repeatable form fields", () => {
    expect(containerPayloadFromForm({
      instance: "tiles.example.com",
      host_id: 42,
      var_env_key: ["NODE_ENV", ""],
      var_env_value: ["production", ""],
      label_key: ["traefik.enable"],
      label_value: ["true"],
      port_value: ["8080"],
      volume_source: ["/app/data", ""],
      volume_name: ["tiles-data", ""],
    }, 12)).toEqual({
      name: "tiles",
      host: 42,
      image: 12,
      restart_policy: "unless-stopped",
      environment_variables: [{ key: "NODE_ENV", value: "production" }],
      labels: [
        { key: "traefik.enable", value: "true" },
        { key: "traefik.http.services.tiles.loadbalancer.server.port", value: "8080" },
      ],
      mounts: [
        {
          source: "/app/data",
          volume: { name: "tiles-data" },
          read_only: false,
        },
      ],
    });
  });

  test("derives route, operation, and status metric labels", () => {
    expect(routeLabel({ originalUrl: "/admin.html?x=1" })).toBe("/admin");
    expect(routeLabel({ originalUrl: "/missing" })).toBe("other");
    expect(operationLabel({ originalUrl: "/dockerhub" })).toBe("upgrade");
    expect(statusClass(201)).toBe("2xx");
    expect(statusClass("oops")).toBe("other");
  });

  test("escapes metric labels and renders metric lines", () => {
    expect(metricLabel('a"b\\c\n')).toBe('a\\"b\\\\c\\n');
    expect(metricLine("app_info", 1, { version: "1.0.0" })).toBe('app_info{version="1.0.0"} 1');
  });

  test("normalizes status and operation values from NetBox objects", () => {
    expect(valueText({ display: "Running" })).toBe("Running");
    expect(isReadyContainer({ status: { display: "running" }, operation: { display: "none" } })).toBe(true);
    expect(isReadyContainer({ status: "exited", operation: "none" })).toBe(false);
    expect(isOperationDone({ operation: { value: "none" } })).toBe(true);
  });

  test("reads oauth2-proxy auth headers with local development fallback", () => {
    expect(authUserFromRequest({
      headers: {
        "x-auth-request-email": "user@example.com",
        "x-auth-request-user": "user",
      },
    })).toEqual({ email: "user@example.com", user: "user", name: "user" });
  });

  test("small value helpers keep request parsing predictable", () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray("one")).toEqual(["one"]);
    expect(plainObject([])).toEqual({});
    expect(instanceShort("tiles.example.com")).toBe("tiles");
  });
});
