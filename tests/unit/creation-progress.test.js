const { setCreationProgress, clearCreationProgress, markCreationFailed, creationProgressFor } = require("../../lib/creation-progress");

describe("creation progress tracker", () => {
  test("stores progress under every provided key, case-insensitively", () => {
    setCreationProgress(["app-1.localhost", "app-1"], 3, "Creating container");

    expect(creationProgressFor("APP-1.LOCALHOST")).toEqual({ step: 3, total: 5, label: "Creating container" });
    expect(creationProgressFor("app-1")).toEqual({ step: 3, total: 5, label: "Creating container" });
    expect(creationProgressFor("other")).toBeNull();

    clearCreationProgress(["app-1.localhost", "app-1"]);
  });

  test("clear removes every provided key and ignores empty names", () => {
    setCreationProgress(["app-2.localhost", "", null], 5, "Starting");
    expect(creationProgressFor("app-2.localhost")).toEqual({ step: 5, total: 5, label: "Starting" });
    expect(creationProgressFor("")).toBeNull();

    clearCreationProgress("app-2.localhost");
    expect(creationProgressFor("app-2.localhost")).toBeNull();
  });

  test("markCreationFailed replaces progress with a failure marker", () => {
    setCreationProgress("app-4.localhost", 2, "Preparing image");
    markCreationFailed("app-4.localhost");
    expect(creationProgressFor("app-4.localhost")).toEqual({ failed: true });
    clearCreationProgress("app-4.localhost");
    expect(creationProgressFor("app-4.localhost")).toBeNull();
  });

  test("entries expire after the TTL", () => {
    const realNow = Date.now;
    try {
      setCreationProgress("app-3.localhost", 2, "Preparing image");
      Date.now = () => realNow() + 16 * 60 * 1000;
      expect(creationProgressFor("app-3.localhost")).toBeNull();
    } finally {
      Date.now = realNow;
      clearCreationProgress("app-3.localhost");
    }
  });
});
