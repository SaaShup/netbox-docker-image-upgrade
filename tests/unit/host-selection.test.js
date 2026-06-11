const { hostLoadStats, selectImageAwareHost } = require("../../lib/host-selection");

describe("host selection helpers", () => {
  test("hostLoadStats normalizes object and scalar host ids", () => {
    const hostWithoutId = { display: "Host C" };
    const hosts = [{ id: { id: "host-a" }, display: "Host A" }, { id: "host-b", display: "Host B" }, hostWithoutId];
    const containers = [
      { host: { id: "host-a" } },
      { host: "host-a" },
      { host: { id: "host-b" } },
      { host: "host-c" },
      { host: hostWithoutId },
    ];

    expect(hostLoadStats(hosts, containers)).toEqual([
      { host: hosts[0], count: 2 },
      { host: hosts[1], count: 1 },
      { host: hosts[2], count: 0 },
    ]);
  });

  test("selectImageAwareHost prefers the least loaded host with the requested image", async () => {
    const hosts = [{ id: "host-a", name: "A" }, { id: "host-b", name: "B" }, { id: "host-c", name: "C" }];
    const list = vi.fn().mockResolvedValue([
      { name: "repo/app", version: "1.0", host: { id: "host-a" } },
      { name: "repo/app", version: "1.0", host: "host-b" },
      { name: "repo/app", version: "1.0", host: "host-z" },
      { name: "repo/app", version: "1.0" },
      { name: "repo/app", version: "2.0", host: "host-c" },
      { name: "repo/other", version: "1.0", host: "host-c" },
      { host: "host-c" },
      { name: "repo/app", host: "host-c" },
    ]);

    const selection = await selectImageAwareHost({ list }, hosts, [
      { host: "host-a" },
      { host: "host-a" },
      { host: "host-b" },
    ], { image: "repo/app", version: "1.0" });

    expect(list).toHaveBeenCalledWith("/api/plugins/docker/images/", {
      name: "repo/app",
      version: "1.0",
      host_id: ["host-a", "host-b", "host-c"],
      limit: 1000,
    });
    expect(selection.imageReadyHosts).toEqual([hosts[0], hosts[1]]);
    expect(selection.selected).toBe(hosts[1]);
    expect(selection.selectedCount).toBe(1);
  });

  test("selectImageAwareHost falls back to all hosts when image lookup has no candidates", async () => {
    const hosts = [{ id: "host-a" }, { id: "host-b" }];
    const list = vi.fn().mockResolvedValue([]);

    const selection = await selectImageAwareHost({ list }, hosts, [{ host: "host-a" }], { image: "repo/app", version: "1.0" });

    expect(selection.imageReadyHosts).toEqual([]);
    expect(selection.selected).toBe(hosts[1]);
    expect(selection.selectedCount).toBe(0);
  });

  test("selectImageAwareHost skips image lookup when image, version, or hosts are missing", async () => {
    const list = vi.fn();

    await expect(selectImageAwareHost({ list }, [], [], { image: "repo/app", version: "1.0" })).resolves.toMatchObject({ selected: undefined, selectedCount: 0 });
    await expect(selectImageAwareHost({ list }, [{ id: "host-a" }], [], { image: "", version: "1.0" })).resolves.toMatchObject({ imageReadyHosts: [] });
    await expect(selectImageAwareHost({ list }, [{ id: "host-a" }], [], { image: "repo/app", version: "" })).resolves.toMatchObject({ imageReadyHosts: [] });
    expect(list).not.toHaveBeenCalled();
  });
});
