import type { Core } from '@strapi/types';

import { getCreatorSignalAdminOidcConfig } from '../config';

const createStrapi = (adminOidc: Record<string, unknown> | undefined) =>
  ({
    config: {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'admin.creativesignal' ? { adminOidc } : fallback
      ),
    },
  }) as unknown as Core.Strapi;

describe('Creator Signal Admin OIDC configuration', () => {
  test('is disabled unless explicitly enabled', () => {
    expect(getCreatorSignalAdminOidcConfig(createStrapi(undefined))).toBeNull();
    expect(getCreatorSignalAdminOidcConfig(createStrapi({ enabled: false }))).toBeNull();
  });

  test('normalizes a complete HTTPS configuration', () => {
    const config = getCreatorSignalAdminOidcConfig(
      createStrapi({
        enabled: true,
        issuer: 'https://auth.creatorsignal.me/',
        clientId: 'strapi-client',
        clientSecret: 'secret',
        callbackUrl: 'https://content.creatorsignal.me/admin/creativesignal/oidc/callback',
        projectId: 'project-1',
      })
    );

    expect(config).toEqual(
      expect.objectContaining({
        issuer: 'https://auth.creatorsignal.me',
        requiredProjectRole: 'content:editor',
        strapiRoleCode: 'strapi-editor',
      })
    );
  });

  test.each([
    ['wrong callback', { callbackUrl: 'https://content.creatorsignal.me/admin/connect/zitadel' }],
    ['issuer path', { issuer: 'https://auth.creatorsignal.me/tenant' }],
    ['Super Admin mapping', { strapiRoleCode: 'strapi-super-admin' }],
  ])('rejects %s', (_name, override) => {
    expect(() =>
      getCreatorSignalAdminOidcConfig(
        createStrapi({
          enabled: true,
          issuer: 'https://auth.creatorsignal.me',
          clientId: 'strapi-client',
          clientSecret: 'secret',
          callbackUrl: 'https://content.creatorsignal.me/admin/creativesignal/oidc/callback',
          projectId: 'project-1',
          ...override,
        })
      )
    ).toThrow();
  });

  test('allows loopback HTTP only outside production and when explicitly enabled', () => {
    const originalEnvironment = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      expect(
        getCreatorSignalAdminOidcConfig(
          createStrapi({
            enabled: true,
            issuer: 'http://auth.localhost:48080',
            clientId: 'strapi-client',
            clientSecret: 'secret',
            callbackUrl: 'http://localhost:48120/admin/creativesignal/oidc/callback',
            projectId: 'project-1',
            allowInsecureDevelopmentHttp: true,
          })
        )
      ).not.toBeNull();

      process.env.NODE_ENV = 'production';
      expect(() =>
        getCreatorSignalAdminOidcConfig(
          createStrapi({
            enabled: true,
            issuer: 'http://auth.localhost:48080',
            clientId: 'strapi-client',
            clientSecret: 'secret',
            callbackUrl: 'http://localhost:48120/admin/creativesignal/oidc/callback',
            projectId: 'project-1',
            allowInsecureDevelopmentHttp: true,
          })
        )
      ).toThrow();
    } finally {
      if (originalEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalEnvironment;
      }
    }
  });
});
