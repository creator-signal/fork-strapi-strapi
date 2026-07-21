import type { Core } from '@strapi/types';
import type { Context } from 'koa';

import { createCreatorSignalAdminOidcController } from '../controller';
import { signOidcTransaction } from '../transaction';

const adminOidc = {
  enabled: true,
  issuer: 'https://auth.creatorsignal.me',
  clientId: 'client',
  clientSecret: 'secret',
  callbackUrl: 'https://content.creatorsignal.me/admin/creativesignal/oidc/callback',
  projectId: 'project-1',
  requiredProjectRole: 'content:editor',
  strapiRoleCode: 'strapi-editor',
};

const createRuntime = () => {
  const sessionOrigin = {
    generateRefreshToken: jest.fn().mockResolvedValue({ token: 'refresh-token' }),
    generateAccessToken: jest.fn().mockResolvedValue({ token: 'access-token' }),
  };
  const sessionManager = Object.assign(
    jest.fn(() => sessionOrigin),
    {
      hasOrigin: jest.fn().mockReturnValue(true),
    }
  );
  const sanitizeUser = jest.fn((user) => user);
  const strapi = {
    config: {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'admin.creativesignal') return { adminOidc };
        if (key === 'admin.auth.secret') return 'admin-secret';
        if (key === 'admin.auth.cookie.name') return 'creator_signal_admin';
        return fallback;
      }),
    },
    eventHub: { emit: jest.fn() },
    log: { warn: jest.fn() },
    service: jest.fn(() => ({ sanitizeUser })),
    sessionManager,
  } as unknown as Core.Strapi;

  const cookieValues = new Map<string, string>();
  const setCookie = jest.fn((name: string, value: string) => cookieValues.set(name, value));
  const redirect = jest.fn();
  const ctx = {
    body: undefined,
    cookies: {
      get: jest.fn((name: string) => cookieValues.get(name)),
      set: setCookie,
    },
    notFound: jest.fn(),
    query: {},
    redirect,
    request: {
      headers: { 'user-agent': 'test-browser' },
      secure: true,
      url: '/admin/creativesignal/oidc/callback?code=code&state=state',
    },
  } as unknown as Context;

  return { cookieValues, ctx, redirect, sessionManager, sessionOrigin, setCookie, strapi };
};

describe('Creator Signal Admin OIDC controller', () => {
  test('starts a signed PKCE transaction and redirects to ZITADEL', async () => {
    const { ctx, redirect, setCookie, strapi } = createRuntime();
    ctx.query = { returnTo: '/admin/content-manager' };
    const randomValues = ['verifier', 'state', 'nonce'];
    const buildAuthorizationUrl = jest
      .fn()
      .mockResolvedValue(new URL('https://auth.creatorsignal.me/oauth/v2/authorize?request=1'));
    const controller = createCreatorSignalAdminOidcController(strapi, {
      now: () => 1_000,
      randomValue: () => randomValues.shift()!,
      buildAuthorizationUrl,
    });

    await controller.start(ctx);

    expect(setCookie).toHaveBeenCalledWith(
      'creativesignal_strapi_oidc',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
    );
    expect(buildAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1' }),
      { codeChallenge: expect.any(String), nonce: 'nonce', state: 'state' },
      expect.any(Object)
    );
    expect(redirect).toHaveBeenCalledWith(
      'https://auth.creatorsignal.me/oauth/v2/authorize?request=1'
    );
  });

  test('issues normal Community Admin cookies after an authorised callback', async () => {
    const { cookieValues, ctx, redirect, sessionOrigin, setCookie, strapi } = createRuntime();
    cookieValues.set(
      'creativesignal_strapi_oidc',
      signOidcTransaction(
        {
          codeVerifier: 'verifier',
          issuedAt: 1_000,
          nonce: 'nonce',
          returnTo: '/admin/content-manager',
          state: 'state',
        },
        'admin-secret'
      )
    );
    const user = {
      id: 42,
      email: 'editor@creatorsignal.me',
      isActive: true,
      roles: [{ id: 2, code: 'strapi-editor' }],
    };
    const controller = createCreatorSignalAdminOidcController(strapi, {
      now: () => 2_000,
      randomDeviceId: () => 'device-id',
      exchangeCode: jest.fn().mockResolvedValue({
        iss: adminOidc.issuer,
        sub: 'user-1',
        aud: adminOidc.clientId,
        exp: 2_000,
        iat: 1_000,
        nonce: 'nonce',
      }),
      ensureAdmin: jest.fn().mockResolvedValue(user),
    });

    await controller.callback(ctx);

    expect(sessionOrigin.generateRefreshToken).toHaveBeenCalledWith('42', 'device-id', {
      type: 'session',
      metadata: { userAgent: 'test-browser' },
    });
    expect(setCookie).toHaveBeenCalledWith(
      'strapi_admin_refresh',
      'refresh-token',
      expect.objectContaining({ httpOnly: true, path: '/admin' })
    );
    expect(setCookie).toHaveBeenCalledWith(
      'creator_signal_admin',
      'access-token',
      expect.objectContaining({ httpOnly: false, path: '/' })
    );
    expect(redirect).toHaveBeenCalledWith('/admin/content-manager');
  });

  test('denies a callback with a mismatched state before exchanging the code', async () => {
    const { cookieValues, ctx, strapi } = createRuntime();
    cookieValues.set(
      'creativesignal_strapi_oidc',
      signOidcTransaction(
        {
          codeVerifier: 'verifier',
          issuedAt: 1_000,
          nonce: 'nonce',
          returnTo: '/admin/content-manager',
          state: 'different-state',
        },
        'admin-secret'
      )
    );
    const exchangeCode = jest.fn();
    const controller = createCreatorSignalAdminOidcController(strapi, {
      now: () => 2_000,
      exchangeCode,
    });

    await controller.callback(ctx);

    expect(ctx.status).toBe(403);
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});
