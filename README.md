# SaaShup

Self-service platform to deploy, upgrade and run Docker applications on hosts managed through NetBox.

SaaShup sits on top of NetBox with the [netbox-docker-plugin](https://github.com/SaaShup/netbox-docker-plugin) or [Passhup](https://github.com/SaaShup/paashup) and an [agent](https://github.com/SaaShup/agent) on each Docker host. Admins describe applications as templates. Users order instances of them, or enroll their own images. SaaShup creates the containers, wires the DNS and reverse proxy, keeps them up to date when new image versions are pushed, and notifies the people concerned.

![Version](https://img.shields.io/github/package-json/v/SaaShup/saashup)
![Node](https://img.shields.io/badge/node-24--alpine-green)
![License](https://img.shields.io/github/license/SaaShup/saashup)
![Last Commit](https://img.shields.io/github/last-commit/SaaShup/saashup)
![Repo Size](https://img.shields.io/github/repo-size/SaaShup/saashup)
![Top Language](https://img.shields.io/github/languages/top/SaaShup/saashup)
![CI](https://github.com/SaaShup/saashup/actions/workflows/ci.yml/badge.svg)

## Run

```sh
docker run -d -v saashup:/data \
 -p 1880:1880 --name saashup \
 ghcr.io/saashup/saashup
```

Set `PUBLIC_IMAGE=true` or `PUBLIC_IMAGE=1` to allow any signed-in user to order or enroll images. When `PUBLIC_IMAGE` is unset, `false`, or `0`, only emails listed in `ADMIN_ALLOWED_EMAILS` can order or enroll images.

## Documentation

- [Authentication](docs/authentication.md)
- [Config profiles](docs/config-profiles.md)
- [Public website APIs](docs/public-website-apis.md)
- [Registry webhooks](docs/registry-webhooks.md)
- [Operations](docs/operations.md)
- [Testing](TESTING.md)
- [Contributing](docs/contributing.md)

## Development

```sh
npm ci
npm run dev
```

## Test

```sh
npm test
```
