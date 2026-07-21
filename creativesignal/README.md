# Creator Signal Strapi distribution

This directory owns the Creator Signal Community-compatible Strapi distribution. It is kept
separate from upstream Strapi source so the fork can be refreshed without mixing deployment
code into upstream packages.

The published image is:

```text
ghcr.io/creator-signal/strapi:5.50.2-cs.1
```

The image contains the normal upstream Community runtime plus the standalone Creator Signal
ZITADEL integration under the existing `creativesignal/` namespaces. Enterprise files are left
exactly as upstream ships them and Enterprise features are disabled at runtime.

## OIDC configuration

Set `CREATOR_SIGNAL_ADMIN_OIDC_ENABLED=true` and provide:

- `ZITADEL_ISSUER`
- `STRAPI_ADMIN_SSO_CLIENT_ID`
- `STRAPI_ADMIN_SSO_CLIENT_SECRET`
- `STRAPI_ADMIN_OIDC_CALLBACK_URL`
- `STRAPI_ADMIN_OIDC_PROJECT_ID`
- `STRAPI_ADMIN_OIDC_REQUIRED_ROLE` (defaults to `content:editor`)

The callback must use `/admin/creativesignal/oidc/callback`. Loopback HTTP is accepted only when
`STRAPI_ADMIN_OIDC_ALLOW_INSECURE_HTTP=true` and `NODE_ENV` is not `production`.

The distribution blocks first-admin registration while OIDC is enabled, disables public
users-permissions registration, and provisions only the configured non-Super-Admin Strapi role.

## Image lifecycle

`creativesignal/container/version.json` is the single image-version source. Every change to the
published distribution must increment `distributionRevision` (or update `upstreamVersion` after
an upstream refresh). Pull requests build and smoke-test an AMD64 image. A merge to `develop`
publishes AMD64 and ARM64 manifests to GHCR.

Consumers must pin the resulting manifest digest, not only the mutable human-readable tag.
