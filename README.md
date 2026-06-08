# SaaShup
App to deploy new image to all containers

![Version](https://img.shields.io/github/package-json/v/SaaShup/netbox-docker-image-upgrade)
![Node](https://img.shields.io/badge/node-24--alpine-green)
![License](https://img.shields.io/github/license/SaaShup/netbox-docker-image-upgrade)
![Last Commit](https://img.shields.io/github/last-commit/SaaShup/netbox-docker-image-upgrade)
![Repo Size](https://img.shields.io/github/repo-size/SaaShup/netbox-docker-image-upgrade)
![Top Language](https://img.shields.io/github/languages/top/SaaShup/netbox-docker-image-upgrade)
![CI](https://github.com/SaaShup/netbox-docker-image-upgrade/actions/workflows/tests.yml/badge.svg)

# Run

```
docker run -d -v netbox-docker-image-upgrade:/data \
 -p 1880:1880 --name netbox-docker-image-upgrade \
 saashup/netbox-docker-image-upgrade
```

# Authentication

The app can authenticate directly using OIDC. Configure a confidential oidc client with this redirect URI:

```
https://your-domain.example/oidc/callback
```

Then start the app with:

```
OIDC_ISSUER_URL=https://your-domain.example/auth/realms/paashup
OIDC_CLIENT_ID=saashup
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://your-domain.example/oidc/callback
SAASHUP_SESSION_SECRET=...
ADMIN_ALLOWED_EMAILS=admin@example.com
APP_OWNER_EMAIL=owner@example.com
```

`/admin` and `/order` redirect unauthenticated users to Keycloak. `ADMIN_ALLOWED_EMAILS` still controls who can access admin-only actions.

# Config profiles

The admin UI supports multiple named NetBox configs. In the Config menu, choose or enter a profile name, fill the NetBox URL, token, optional proxy URL, optional domain, optional host tag slug and optional SMTP config in `user:pwd@host:port` format, then save. NetBox v1 tokens and v2 tokens are both supported: v1 tokens are sent as `Authorization: Token <token>`, while tokens starting with `nbt_` and containing a dot are sent as `Authorization: Bearer <token>`. Create, Upgrade, Operate, Delete, host refresh, instance refresh and image refresh all use the selected profile. When a domain is set, Create turns a short instance name into an FQDN by appending that domain. When a tag is set, Create, Upgrade, Operate and refresh lists first load hosts with that tag. Create selects the matching host with the fewest containers.

Each config also has a `Max instances` value from 0 to 10, defaulting to 1. Orders are limited per signed-in user and config profile. The limit and usage counters are persisted in `app-state.json` under `DATAPATH` (`/data` in the Docker image). When a profile has SMTP config and `APP_OWNER_EMAIL` is set, ready emails are sent to the requester with the owner address copied.

Enroll requests reject duplicate image names for the same user and config profile. To block specific images from `/enroll`, set `SAASHUP_ENROLL_BLOCKED_IMAGES` to a comma-separated list, for example `traefik,netbox-docker-agent`.

Use the Config page export/import buttons to move saved config profiles, create templates and order counters from one container to another. Export downloads a JSON file, and import replaces those persisted values in the target container.

# Public website APIs

Static Hugo pages can call the app for server-side checks and email delivery.

These routes are disabled by default and return `401` until either an allowed origin or a shared secret is configured.

Set `PUBLIC_API_ALLOWED_ORIGINS` to a comma-separated list of Hugo site origins to allow browser calls, for example:

```
PUBLIC_API_ALLOWED_ORIGINS=https://www.saashup.com,https://saashup.com
```

This is an Origin/Referer allowlist and CORS policy for browsers. If you proxy these calls through a server that can keep secrets, also set `PUBLIC_API_SECRET` and send it as `X-Public-Api-Secret`. Do not put that secret in Hugo frontend JavaScript.

Check whether a public image tag exists on Docker Hub, GitHub Container Registry, Quay, or GitLab Container Registry:

```
GET /registry/check?image=saashup/netbox-docker-agent:v1.24.0
GET /registry/check?image=ghcr.io/owner/image:v1.0.0
GET /registry/check?image=quay.io/owner/image:v1.0.0
GET /registry/check?image=registry.gitlab.com/group/project/image:v1.0.0
```

Send a contact form email to `APP_OWNER_EMAIL` using the saved SMTP config:

```
POST /contact
Content-Type: application/json

{
  "profile": "prod",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "subject": "Demo request",
  "message": "Can we talk?",
  "turnstileToken": "cloudflare-turnstile-response-token",
  "website": ""
}
```

`profile` is optional when the default config has `smtp_config`. `website` is a honeypot field; keep it hidden and empty in the Hugo form.

To require Cloudflare Turnstile verification only for this contact endpoint, set:

```
TURNSTILE_SECRET_KEY=0x...
```

When `TURNSTILE_SECRET_KEY` is set, `/contact` requires `turnstileToken` (or `cf-turnstile-response`) and verifies it with Cloudflare Siteverify before sending email.

# Registry webhooks

Registry webhooks must target a config profile explicitly:

```
https://your-domain.example/registry-webhook/<config-profile>
```

For example, `/registry-webhook/curioocity-guide` uses the `curioocity-guide` config profile and only processes Docker hosts matching that profile's host tag. The profile-less `/registry-webhook` endpoint is not enabled.

The webhook accepts Docker Hub, GitHub Container Registry package events, Quay tag updates, and GitLab/CNCF distribution notification payloads when the payload includes an image repository and tag.

Set `REGISTRY_WEBHOOK_SECRET` to require a shared secret by default. A saved create template can override this with its own registry webhook password. For template-specific passwords, include the template name in the webhook URL so the password is checked against that template:

```
https://your-domain.example/registry-webhook/<config-profile>/<template>/<secret>
https://your-domain.example/registry-webhook/<config-profile>?secret=<secret>
```

The explicit template URL still verifies that the named template matches both the config profile and the pushed image repository.

# Refresh hosts

The Refresh hosts menu entry uses the selected config, lists Docker hosts from NetBox, and requests a refresh operation for each host one by one. Each host is polled until its operation is back to `none`; `OPERATION_TIMEOUT_SECONDS` controls the timeout and defaults to 30 seconds.

# Recreate

Before recreating containers, the app checks whether the target versioned image exists on each host. If it does not, it creates the versioned image through the normal image API, waits briefly for the agent pull, then continues. It does not call the `force_pull` endpoint.

Upgrade, Operate and Refresh process one item at a time. After each operation request, the app polls the container or host until it is ready before starting the next item. Containers must return to `running` with `operation` set to `none`; hosts must return to `operation` set to `none`. `OPERATION_TIMEOUT_SECONDS` defaults to 30 seconds, and a timeout stops the remaining loop.

# Contribute 

```
npm ci
npm run dev
```

# Test

```
npm run test
```
