# Public Website APIs

Static Hugo pages can call the app for server-side checks and email delivery.

These routes are disabled by default and return `401` until either an allowed origin or a shared secret is configured.

Set `PUBLIC_API_ALLOWED_ORIGINS` to a comma-separated list of Hugo site origins to allow browser calls, for example:

```sh
PUBLIC_API_ALLOWED_ORIGINS=https://www.saashup.com,https://saashup.com
```

This is an Origin/Referer allowlist and CORS policy for browsers. If you proxy these calls through a server that can keep secrets, also set `PUBLIC_API_SECRET` and send it as `X-Public-Api-Secret`. Do not put that secret in Hugo frontend JavaScript.

Check whether a public image tag exists on Docker Hub, GitHub Container Registry, Quay, or GitLab Container Registry:

```http
GET /registry/check?image=saashup/netbox-docker-agent:v1.24.0
GET /registry/check?image=ghcr.io/owner/image:v1.0.0
GET /registry/check?image=quay.io/owner/image:v1.0.0
GET /registry/check?image=registry.gitlab.com/group/project/image:v1.0.0
```

Send a contact form email to `APP_OWNER_EMAIL` using the saved SMTP config:

```http
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

```sh
TURNSTILE_SECRET_KEY=0x...
```

When `TURNSTILE_SECRET_KEY` is set, `/contact` requires `turnstileToken` (or `cf-turnstile-response`) and verifies it with Cloudflare Siteverify before sending email.
