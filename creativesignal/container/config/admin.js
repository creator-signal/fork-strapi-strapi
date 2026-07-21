'use strict';

module.exports = ({ env }) => {
  const oidcEnabled = env.bool('CREATOR_SIGNAL_ADMIN_OIDC_ENABLED', false);

  return {
    url: '/admin',
    auth: {
      secret: env('ADMIN_JWT_SECRET'),
      options: { expiresIn: '8h' },
    },
    apiToken: { salt: env('API_TOKEN_SALT') },
    transfer: { token: { salt: env('TRANSFER_TOKEN_SALT') } },
    secrets: { encryptionKey: env('ENCRYPTION_KEY') },
    flags: {
      nps: false,
      promoteEE: false,
    },
    creativesignal: {
      adminOidc: {
        enabled: oidcEnabled,
        issuer: env('ZITADEL_ISSUER'),
        clientId: env('STRAPI_ADMIN_SSO_CLIENT_ID'),
        clientSecret: env('STRAPI_ADMIN_SSO_CLIENT_SECRET'),
        callbackUrl: env('STRAPI_ADMIN_OIDC_CALLBACK_URL'),
        projectId: env('STRAPI_ADMIN_OIDC_PROJECT_ID'),
        requiredProjectRole: env('STRAPI_ADMIN_OIDC_REQUIRED_ROLE', 'content:editor'),
        strapiRoleCode: env('STRAPI_ADMIN_ROLE_CODE', 'strapi-editor'),
        allowInsecureDevelopmentHttp: env.bool('STRAPI_ADMIN_OIDC_ALLOW_INSECURE_HTTP', false),
      },
    },
  };
};
