# SaaShup

App to deploy new image versions to Docker containers managed through NetBox.

![Version](https://img.shields.io/github/package-json/v/SaaShup/netbox-docker-image-upgrade)
![Node](https://img.shields.io/badge/node-24--alpine-green)
![License](https://img.shields.io/github/license/SaaShup/netbox-docker-image-upgrade)
![Last Commit](https://img.shields.io/github/last-commit/SaaShup/netbox-docker-image-upgrade)
![Repo Size](https://img.shields.io/github/repo-size/SaaShup/netbox-docker-image-upgrade)
![Top Language](https://img.shields.io/github/languages/top/SaaShup/netbox-docker-image-upgrade)
![CI](https://github.com/SaaShup/netbox-docker-image-upgrade/actions/workflows/ci.yml/badge.svg)

## Run

```sh
docker run -d -v netbox-docker-image-upgrade:/data \
 -p 1880:1880 --name netbox-docker-image-upgrade \
 saashup/netbox-docker-image-upgrade
```

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
