# Creator Signal Strapi extensions

Creator Signal-owned Community features live under this namespace. They are intentionally kept out
of Strapi's upstream `ee/` directories and do not import, copy, patch, remove, or require Enterprise
implementation code.

## ZITADEL Admin OIDC

`admin-oidc/` provides a standalone ZITADEL login for the Community Admin panel:

- Authorization Code flow with PKCE, signed state transactions and nonce validation;
- exact issuer, audience, RS256 signature, expiry and verified-email checks;
- exact ZITADEL project-role claim enforcement;
- idempotent first-login provisioning into a non-Super-Admin Strapi role;
- standard Strapi Community Admin refresh and access sessions;
- disabled Admin self-registration and users-permissions public registration;
- a Community login-page entrypoint while retaining separately provisioned local break-glass login.

The feature is disabled by default. Configure it in the application's `config/admin.ts`:

```ts
export default ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  creativesignal: {
    adminOidc: {
      enabled: env.bool('STRAPI_CREATORSIGNAL_OIDC_ENABLED', false),
      issuer: env('ZITADEL_ISSUER'),
      clientId: env('STRAPI_CREATORSIGNAL_OIDC_CLIENT_ID'),
      clientSecret: env('STRAPI_CREATORSIGNAL_OIDC_CLIENT_SECRET'),
      callbackUrl: env('STRAPI_CREATORSIGNAL_OIDC_CALLBACK_URL'),
      projectId: env('STRAPI_CREATORSIGNAL_OIDC_PROJECT_ID'),
      requiredProjectRole: env('STRAPI_CREATORSIGNAL_OIDC_REQUIRED_ROLE', 'content:editor'),
      strapiRoleCode: env('STRAPI_CREATORSIGNAL_OIDC_STRAPI_ROLE', 'strapi-editor'),
      allowInsecureDevelopmentHttp: env.bool(
        'STRAPI_CREATORSIGNAL_OIDC_ALLOW_INSECURE_DEVELOPMENT_HTTP',
        false
      ),
    },
  },
});
```

Register this exact ZITADEL redirect URI:

```text
https://<strapi-host>/admin/creativesignal/oidc/callback
```

The ZITADEL Web application must use code flow, client-secret Basic authentication and PKCE. Enable
role assertion and user roles in the ID token. The integration requests
`urn:zitadel:iam:org:projects:roles` and the configured project's audience scope, then accepts only
`urn:zitadel:iam:org:project:<projectId>:roles` for authorisation.

ZITADEL self-registration is an identity-provider policy and must also remain disabled there. This
module disables Strapi signup surfaces, but it cannot change ZITADEL instance policy.

Provision the local break-glass Super Admin through deployment automation before enabling OIDC. The
OIDC path will never create, update, or sign in a Strapi Super Admin. Removing a ZITADEL role blocks
new SSO sessions; revoke existing Strapi Admin sessions when immediate termination is required.

Loopback HTTP is accepted only when `NODE_ENV` is not `production`, the issuer and callback hosts are
loopback names, and `allowInsecureDevelopmentHttp` is explicitly true.
