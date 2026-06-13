# Testing Plan

This project uses three complementary test layers: fast unit tests for server logic,
browser e2e tests for user workflows, and a Docker smoke test in CI for packaging.

## Local Commands

- `npm run test:unit` runs the Vitest unit suite.
- `npm run coverage:text` runs unit tests with a terminal coverage summary.
- `npm run test:e2e` runs Playwright against the local app.
- `npm test` runs unit tests first, then e2e tests.
- `npm run integration:up`, `INTEGRATION_NETBOX_TOKEN=<token> npm run test:integration`, and `npm run integration:down` run the optional local Docker integration suite.

## Unit Test Strategy

Unit tests cover server routes, API modules, registry behavior, template catalog
logic, host selection, config handling, create/enroll/order flows, and operational
actions. Add or update unit tests whenever a backend branch, parser, validation
rule, error response, or helper changes.

Coverage is enforced globally in `vitest.config.js`:

- Statements: 95%
- Branches: 90%
- Functions: 95%
- Lines: 95%

If coverage drops, prefer adding focused tests for the changed behavior instead of
lowering the threshold.

## E2E Test Strategy

Playwright tests are split by product area:

- `tests/e2e/admin.spec.js` for admin shell, config, reporting, and app metadata.
- `tests/e2e/create-template.spec.js` for create form, imports, templates, and workflows.
- `tests/e2e/catalog-enroll.spec.js` for catalog and enrollment experiences.
- `tests/e2e/order.spec.js` for public order flows.
- `tests/e2e/operations-logs.spec.js` for upgrade, refresh, delete, restart, and logs.
- `tests/e2e/fixtures.js` for shared browser setup and route helpers.

Add e2e coverage for user-visible workflows, navigation, browser storage behavior,
responsive layout risks, and interactions that cross multiple client-side modules.
Keep API edge cases in unit tests unless the browser behavior itself is important.

## CI Gates

CI should keep these gates green before merging:

- JavaScript syntax checks for main browser/server entry points.
- Unit tests with coverage thresholds.
- Playwright e2e tests.
- Docker image build and smoke checks for `/version`, `/`, `/session/user`,
  `/metrics`, and `/admin`.

Upload coverage and Playwright artifacts on every CI run so failures can be
debugged from reports instead of rerunning blindly.

## Local Integration Strategy

The optional integration suite in `tests/integration` starts the app, Paasbox,
and the SaaShup Docker agent with Docker Compose. It saves a real config profile,
enrolls a real image, creates a real instance, then checks the catalog and order
pages through Playwright. Keep this suite local unless the CI runner has a Docker
socket and an isolated environment suitable for creating containers.

## Release Confidence Checklist

Before a release or risky change:

- Run `npm test` locally.
- Run `npm run coverage:text` and check that new or changed branches are covered.
- Review Playwright coverage for the affected user path.
- Confirm the Docker smoke test still covers any changed runtime environment
  variables, ports, or startup behavior.
