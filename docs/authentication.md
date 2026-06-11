# Authentication

The app can authenticate directly using OIDC. Configure a confidential oidc client with this redirect URI:

```text
https://your-domain.example/oidc/callback
```

Then start the app with:

```sh
OIDC_ISSUER_URL=https://your-domain.example/auth/realms/paashup
OIDC_CLIENT_ID=saashup
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://your-domain.example/oidc/callback
SAASHUP_SESSION_SECRET=...
ADMIN_ALLOWED_EMAILS=admin@example.com
APP_OWNER_EMAIL=owner@example.com
```

`/admin` and `/order` redirect unauthenticated users to Keycloak. `ADMIN_ALLOWED_EMAILS` still controls who can access admin-only actions.
