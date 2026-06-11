# Config Profiles

The admin UI supports multiple named NetBox configs. In the Config menu, choose or enter a profile name, fill the NetBox URL, token, optional proxy URL, optional domain, optional host tag slug and optional SMTP config in `user:pwd@host:port` format, then save.

NetBox v1 tokens and v2 tokens are both supported: v1 tokens are sent as `Authorization: Token <token>`, while tokens starting with `nbt_` and containing a dot are sent as `Authorization: Bearer <token>`.

Create, Upgrade, Operate, Delete, host refresh, instance refresh and image refresh all use the selected profile. When a domain is set, Create turns a short instance name into an FQDN by appending that domain. When a tag is set, Create, Upgrade, Operate and refresh lists first load hosts with that tag. Create selects the matching host with the fewest containers.

Each config also has a `Max instances` value from 0 to 10, defaulting to 1. Orders are limited per signed-in user and config profile. The limit and usage counters are persisted in `app-state.json` under `DATAPATH` (`/data` in the Docker image). When a profile has SMTP config and `APP_OWNER_EMAIL` is set, ready emails are sent to the requester with the owner address copied.

Enroll requests reject duplicate image names for the same user and config profile. To block specific images from `/enroll`, set `SAASHUP_ENROLL_BLOCKED_IMAGES` to a comma-separated list, for example `traefik,netbox-docker-agent`.

Use the Config page export/import buttons to move saved config profiles, create templates and order counters from one container to another. Export downloads a JSON file, and import replaces those persisted values in the target container.
