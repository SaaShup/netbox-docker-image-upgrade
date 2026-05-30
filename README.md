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
docker run -d -v netbox-docker-image-upgrade:/data -p 1880:1880 --name netbox-docker-image-upgrade saashup/netbox-docker-image-upgrade
```

# Keycloak

The app can authenticate directly with Keycloak using OIDC, so an external oauth2-proxy container is not required. Configure a confidential Keycloak client with this redirect URI:

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
```

`/admin` and `/order` redirect unauthenticated users to Keycloak. `ADMIN_ALLOWED_EMAILS` still controls who can access admin-only actions.

# Config profiles

The admin UI supports multiple named NetBox configs. In the Config menu, choose or enter a profile name, fill the NetBox URL, token, optional proxy URL, optional domain and optional host tag slug, then save. Create, Upgrade, Operate, Delete, host refresh, instance refresh and image refresh all use the selected profile. When a domain is set, Create turns a short instance name into an FQDN by appending that domain. When a tag is set, Create, Upgrade, Operate and refresh lists first load hosts with that tag. Create selects the matching host with the fewest containers.

Each config also has a `Max instances` value from 0 to 10, defaulting to 1. Orders are limited per signed-in user and config profile. The limit and usage counters are persisted in `app-state.json` under `DATAPATH` (`/data` in the Docker image).

Use the Config page export/import buttons to move saved config profiles, create templates and order counters from one container to another. Export downloads a JSON file, and import replaces those persisted values in the target container.

# Refresh hosts

The Refresh hosts menu entry uses the selected config, lists Docker hosts from NetBox, and requests a refresh operation for each host one by one. Each host is polled until its operation is back to `none`; `OPERATION_TIMEOUT_SECONDS` controls the timeout and defaults to 30 seconds.

# Recreate

Before recreating containers, the app checks whether the target versioned image exists on each host. If it does not, it creates the versioned image through the normal image API, waits briefly for the agent pull, then continues. It does not call the `force_pull` endpoint.

Upgrade, Operate and Refresh process one item at a time. After each operation request, the app polls the container or host until it is ready before starting the next item. Containers must return to `running` with `operation` set to `none`; hosts must return to `operation` set to `none`. `OPERATION_TIMEOUT_SECONDS` defaults to 30 seconds, and a timeout stops the remaining loop.

# Contribute 

```
npm run dev
```
