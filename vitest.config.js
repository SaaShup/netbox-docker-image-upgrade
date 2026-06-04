const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globals: true,
    include: ["tests/unit/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json"],
      reportsDirectory: "coverage",
      include: ["server.js", "lib/**/*.js"],
      exclude: ["tests/**"],
    },
  },
});
