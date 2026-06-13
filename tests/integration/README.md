# Local Integration Tests

This suite runs the app against a local Docker integration stack:

- `integration-agent`: SaaShup Docker agent with access to the local Docker socket.
- `integration-paasbox`: Paasbox/NetBox.
- `integration-app`: this app, built from the current working tree.

It is intentionally separate from the normal unit/e2e/CI tests because it pulls
real images and creates real Docker containers on the local machine.

## Run

Create or choose a Paasbox/NetBox API token, then run:

```sh
npm run integration:up
INTEGRATION_NETBOX_TOKEN=<token> npm run test:integration
npm run integration:down
```

The app is exposed at `http://127.0.0.1:3000` by default.

## Optional Settings

- `INTEGRATION_APP_PORT`: host port for the app, default `3000`.
- `INTEGRATION_APP_URL`: Playwright base URL, default `http://127.0.0.1:3000`.
- `INTEGRATION_AGENT_PORT`: host port for the agent, default `1881`.
- `INTEGRATION_PAASBOX_PORT`: host port for Paasbox, default `8001`.
- `INTEGRATION_NETBOX_URL`: URL used by the app container to reach Paasbox, default `http://paasbox:8000`.
- `INTEGRATION_NETBOX_TOKEN`: required API token for Paasbox/NetBox.
- `INTEGRATION_IMAGE`: image to enroll/order, default `traefik/whoami`.
- `INTEGRATION_IMAGE_VERSION`: image tag, default `v1.10.3`.
- `INTEGRATION_IMAGE_PORT`: private container port, default `80`.

## What It Checks

The first integration test:

1. Saves an integration config profile through the real admin config endpoint.
2. Checks NetBox/Paasbox connectivity.
3. Enrolls an image with `/create?wait=true`.
4. Verifies `/enroll/limit` returns the enrolled image.
5. Creates an order instance from that enrolled image.
6. Verifies `/order/limit` returns the created instance.
7. Opens `/catalog` and `/order?template=...` in Chromium to confirm the UI sees the data.

The test tries to delete created containers at the end, but if a run is interrupted
you may need to clean up `it-enroll-*` or `it-order-*` containers manually.
