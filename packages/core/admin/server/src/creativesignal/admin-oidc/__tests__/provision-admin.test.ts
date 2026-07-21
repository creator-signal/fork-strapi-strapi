import type { Core } from '@strapi/types';

import type { CreatorSignalAdminOidcConfig } from '../config';
import type { ZitadelIdTokenClaims } from '../oidc-client';
import { ensureCreatorSignalAdmin, zitadelProjectRoles } from '../provision-admin';

const config: CreatorSignalAdminOidcConfig = {
  enabled: true,
  issuer: 'https://auth.creatorsignal.me',
  clientId: 'client',
  clientSecret: 'secret',
  callbackUrl: 'https://content.creatorsignal.me/admin/creativesignal/oidc/callback',
  projectId: 'project-1',
  requiredProjectRole: 'content:editor',
  strapiRoleCode: 'strapi-editor',
  allowInsecureDevelopmentHttp: false,
};

const claims = (override: Partial<ZitadelIdTokenClaims> = {}): ZitadelIdTokenClaims => ({
  iss: config.issuer,
  sub: 'zitadel-user-1',
  aud: config.clientId,
  exp: 2_000,
  iat: 1_000,
  nonce: 'nonce',
  email: 'Editor@CreatorSignal.me',
  email_verified: true,
  given_name: 'Content',
  family_name: 'Editor',
  [`urn:zitadel:iam:org:project:${config.projectId}:roles`]: {
    'content:editor': { organization: 'Creator Signal' },
  },
  ...override,
});

const createServices = (existingUser: Record<string, unknown> | null = null) => {
  const editorRole = { id: 2, code: 'strapi-editor', name: 'Editor' };
  const createdUser = {
    id: 42,
    email: 'editor@creatorsignal.me',
    isActive: true,
    roles: [editorRole],
  };
  const user = {
    findOneByEmail: jest.fn().mockResolvedValue(existingUser),
    create: jest.fn().mockResolvedValue(createdUser),
    updateById: jest.fn().mockResolvedValue(createdUser),
  };
  const role = { findOne: jest.fn().mockResolvedValue(editorRole) };
  const strapi = {
    service: jest.fn((name: string) => (name === 'admin::user' ? user : role)),
  } as unknown as Core.Strapi;

  return { createdUser, role, strapi, user };
};

describe('Creator Signal Admin provisioning', () => {
  test('only reads roles from the exact configured project claim', () => {
    expect(zitadelProjectRoles(claims(), config.projectId)).toContain('content:editor');
    expect(
      zitadelProjectRoles(
        {
          'urn:zitadel:iam:org:project:other-project:roles': { 'content:editor': {} },
          'urn:zitadel:iam:org:project:roles': { 'content:editor': {} },
        },
        config.projectId
      )
    ).not.toContain('content:editor');
  });

  test('creates an active Editor on first authorised login', async () => {
    const { strapi, user, createdUser } = createServices();
    await expect(ensureCreatorSignalAdmin(strapi, config, claims())).resolves.toEqual(createdUser);
    expect(user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'editor@creatorsignal.me',
        isActive: true,
        registrationToken: null,
        roles: [2],
      })
    );
  });

  test('reuses an existing active Editor without changing it', async () => {
    const existing = {
      id: 42,
      email: 'editor@creatorsignal.me',
      isActive: true,
      roles: [{ id: 2, code: 'strapi-editor' }],
    };
    const { strapi, user } = createServices(existing);
    await expect(ensureCreatorSignalAdmin(strapi, config, claims())).resolves.toBe(existing);
    expect(user.create).not.toHaveBeenCalled();
    expect(user.updateById).not.toHaveBeenCalled();
  });

  test.each([
    ['unverified email', claims({ email_verified: false })],
    [
      'wrong project',
      claims({
        [`urn:zitadel:iam:org:project:${config.projectId}:roles`]: {},
        'urn:zitadel:iam:org:project:wrong:roles': { 'content:editor': {} },
      }),
    ],
  ])('denies %s', async (_name, input) => {
    const { strapi, user } = createServices();
    await expect(ensureCreatorSignalAdmin(strapi, config, input)).rejects.toThrow();
    expect(user.create).not.toHaveBeenCalled();
  });

  test.each([
    ['suspended Admin', { id: 42, email: 'editor@creatorsignal.me', isActive: false, roles: [] }],
    [
      'Super Admin',
      {
        id: 1,
        email: 'editor@creatorsignal.me',
        isActive: true,
        roles: [{ id: 1, code: 'strapi-super-admin' }],
      },
    ],
  ])('does not take over a %s', async (_name, existing) => {
    const { strapi, user } = createServices(existing);
    await expect(ensureCreatorSignalAdmin(strapi, config, claims())).rejects.toThrow();
    expect(user.updateById).not.toHaveBeenCalled();
  });
});
