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
- `INTEGRATION_SMTP_PORT`: host port for the integration SMTP sink, default `587`.
- `INTEGRATION_TRAEFIK_PORT`: host port for the local Traefik HTTP entrypoint, default `80`.
- `INTEGRATION_TRAEFIK_DASHBOARD_PORT`: host port for the local Traefik dashboard, default `8082`.
- `INTEGRATION_TRAEFIK_URL`: URL used by version checks to reach local Traefik, default `http://127.0.0.1:<INTEGRATION_TRAEFIK_PORT>`.
- `INTEGRATION_PAASBOX_URL`: URL used by the tests to verify Paasbox state directly, default `http://localhost:8001`.
- `INTEGRATION_NETBOX_URL`: URL used by the app container to reach Paasbox, default `http://paasbox:8000`.
- `INTEGRATION_NETBOX_TOKEN`: required API token for Paasbox/NetBox.
- `INTEGRATION_DOMAIN`: domain appended to generated integration instances, default `INTEGRATION_CLOUDFLARE_ZONE` when set, otherwise `integration.localhost`.
- `INTEGRATION_CLOUDFLARE_ZONE`: Cloudflare DNS zone to provision in Paasbox and use as the default integration domain.
- `INTEGRATION_CLOUDFLARE_ZONE_ID`: Cloudflare DNS zone ID to provision in Paasbox.
- `INTEGRATION_CLOUDFLARE_API_TOKEN`: Cloudflare API token to provision in Paasbox.
- `INTEGRATION_DELETE_DELAY_MS`: delay before the cleanup test starts deleting instances, default `10000`.
- `RECREATE_OPERATION_SETTLE_DELAY_MS`: delay after each webhook/manual image recreate before moving to the next container; integration compose sets `10000` because Paasbox can report ready before Docker has finished replacing the container.
- `INTEGRATION_IMAGE`: image to enroll/order, default `traefik/whoami`.
- `INTEGRATION_IMAGE_VERSION`: image tag, default `v1.10.3`.
- `INTEGRATION_WEBHOOK_IMAGE_VERSION`: second pullable tag for `INTEGRATION_IMAGE`; default `v2.8.0` when using the default `saashup/curioo-tiles:v2.7.1`. When set to a value different from `INTEGRATION_IMAGE_VERSION`, the suite triggers the registry webhook and verifies that the SMTP sink writes the ready email.
- `INTEGRATION_IMAGE_PORT`: private container port, default `3000` for `saashup/curioo-tiles`, otherwise `80`.
- `INTEGRATION_LOG_DRIVER`: container log driver configured by create/order tests, default `syslog`.
- `INTEGRATION_SYSLOG_ADDRESS`: syslog address used when `INTEGRATION_LOG_DRIVER=syslog`, default `udp://127.0.0.1:5514`.
- `INTEGRATION_SYSLOG_TAG`: syslog tag used when `INTEGRATION_LOG_DRIVER=syslog`, default `{{.Name}}`.
- `INTEGRATION_SMTP_OUTPUT_DIR`: directory where the SMTP sink writes received mail, default `tests/integration/smtp-out`.

## What It Checks

The serial full-flow integration tests:

1. Saves an integration config profile through the real admin config endpoint.
2. Checks NetBox/Paasbox connectivity.
3. Enrolls an image with `/create?wait=true`.
4. Verifies `/enroll/limit` returns the enrolled image.
5. Creates an order instance from that enrolled image.
6. Verifies `/order/limit` returns the created instance.
7. Opens `/catalog` and `/order?template=...` in Chromium to confirm the UI sees the data.
8. When `INTEGRATION_WEBHOOK_IMAGE_VERSION` is set, triggers `/registry-webhook/<profile>/secret` and verifies the ready email is written to `tests/integration/smtp-out/messages.jsonl`.
9. Deletes the ordered instance, deletes the enrolled instance, and removes the enrolled template.
10. Verifies `/order/limit` and `/enroll/limit` no longer return the deleted records.

If a run is interrupted before the delete steps, you may need to clean up
`it-enroll-*`, `it-order-*`, or `it-template-*` records manually.
