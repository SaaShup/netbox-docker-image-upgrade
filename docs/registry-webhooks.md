# Registry Webhooks

Registry webhooks must target a config profile explicitly:

```text
https://your-domain.example/registry-webhook/<config-profile>
```

For example, `/registry-webhook/curioocity-guide` uses the `curioocity-guide` config profile and only processes Docker hosts matching that profile's host tag. The profile-less `/registry-webhook` endpoint is not enabled.

The webhook accepts Docker Hub, GitHub Container Registry package events, Quay tag updates, and GitLab/CNCF distribution notification payloads when the payload includes an image repository and tag.

Set `REGISTRY_WEBHOOK_SECRET` to require a shared secret by default. A saved create template can override this with its own registry webhook password. For template-specific passwords, include the template name in the webhook URL so the password is checked against that template:

```text
https://your-domain.example/registry-webhook/<config-profile>/<template>/<secret>
https://your-domain.example/registry-webhook/<config-profile>?secret=<secret>
```

The explicit template URL still verifies that the named template matches both the config profile and the pushed image repository.
