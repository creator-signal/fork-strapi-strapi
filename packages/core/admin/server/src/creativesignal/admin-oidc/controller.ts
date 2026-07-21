import { randomUUID, timingSafeEqual } from 'node:crypto';

import type { Core } from '@strapi/types';
import type { Context } from 'koa';

import { resolveAuthCookieName } from '../../../../shared/utils/auth-cookie-name';
import { REFRESH_COOKIE_NAME } from '../../../../shared/utils/session-auth';
import { getCreatorSignalAdminOidcConfig } from './config';
import {
  buildZitadelAuthorizationUrl,
  createPkceChallenge,
  exchangeZitadelAuthorizationCode,
  type OidcDependencies,
} from './oidc-client';
import { ensureCreatorSignalAdmin } from './provision-admin';
import {
  oidcTransactionLifetimeMs,
  randomUrlSafeValue,
  readOidcTransaction,
  safeAdminReturnTo,
  signOidcTransaction,
} from './transaction';

const OIDC_TRANSACTION_COOKIE = 'creativesignal_strapi_oidc';
const OIDC_COOKIE_PATH = '/admin/creativesignal/oidc';

interface ControllerDependencies extends OidcDependencies {
  buildAuthorizationUrl?: typeof buildZitadelAuthorizationUrl;
  exchangeCode?: typeof exchangeZitadelAuthorizationCode;
  ensureAdmin?: typeof ensureCreatorSignalAdmin;
  randomValue?: () => string;
  randomDeviceId?: () => string;
}

const secureCookies = (strapi: Core.Strapi, ctx: Context): boolean => {
  const configured = strapi.config.get('admin.auth.cookie.secure');
  if (typeof configured === 'boolean') {
    return configured;
  }

  return process.env.NODE_ENV === 'production' && ctx.request.secure;
};

const commonCookieOptions = (strapi: Core.Strapi, ctx: Context) => ({
  domain:
    strapi.config.get<string | undefined>('admin.auth.cookie.domain') ??
    strapi.config.get<string | undefined>('admin.auth.domain'),
  overwrite: true,
  sameSite: strapi.config.get<'lax' | 'strict' | 'none' | boolean>(
    'admin.auth.cookie.sameSite',
    'lax'
  ),
  secure: secureCookies(strapi, ctx),
});

const clearTransactionCookie = (strapi: Core.Strapi, ctx: Context): void => {
  ctx.cookies.set(OIDC_TRANSACTION_COOKIE, '', {
    ...commonCookieOptions(strapi, ctx),
    httpOnly: true,
    maxAge: 0,
    path: OIDC_COOKIE_PATH,
  });
};

const equalStrings = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const deny = (strapi: Core.Strapi, ctx: Context, error: unknown): void => {
  const code = error instanceof Error ? error.message : 'invalid_request';
  strapi.log.warn(`Creator Signal ZITADEL Admin access denied (${code})`);
  ctx.status = 403;
  ctx.type = 'text/plain';
  ctx.body = 'Creator Signal administrator access denied';
};

const requireEnabledConfig = (strapi: Core.Strapi, ctx: Context) => {
  const config = getCreatorSignalAdminOidcConfig(strapi);
  if (!config) {
    ctx.notFound();
    return null;
  }

  return config;
};

export const createCreatorSignalAdminOidcController = (
  strapi: Core.Strapi,
  dependencies: ControllerDependencies = {}
) => ({
  status(ctx: Context) {
    const enabled = getCreatorSignalAdminOidcConfig(strapi) !== null;
    ctx.body = {
      data: {
        enabled,
        startPath: enabled ? '/admin/creativesignal/oidc/start' : null,
      },
    };
  },

  async start(ctx: Context) {
    const config = requireEnabledConfig(strapi, ctx);
    if (!config) {
      return;
    }

    const now = dependencies.now ?? Date.now;
    const randomValue = dependencies.randomValue ?? randomUrlSafeValue;
    const codeVerifier = randomValue();
    const state = randomValue();
    const nonce = randomValue();
    const transaction = signOidcTransaction(
      {
        codeVerifier,
        issuedAt: now(),
        nonce,
        returnTo: safeAdminReturnTo(ctx.query.returnTo),
        state,
      },
      strapi.config.get<string>('admin.auth.secret')
    );
    ctx.cookies.set(OIDC_TRANSACTION_COOKIE, transaction, {
      ...commonCookieOptions(strapi, ctx),
      httpOnly: true,
      maxAge: oidcTransactionLifetimeMs,
      path: OIDC_COOKIE_PATH,
    });

    const authorizationUrl = await (
      dependencies.buildAuthorizationUrl ?? buildZitadelAuthorizationUrl
    )(
      config,
      {
        codeChallenge: createPkceChallenge(codeVerifier),
        nonce,
        state,
      },
      dependencies
    );
    ctx.redirect(authorizationUrl.href);
  },

  async callback(ctx: Context) {
    const config = requireEnabledConfig(strapi, ctx);
    if (!config) {
      return;
    }

    try {
      const now = dependencies.now ?? Date.now;
      const transaction = readOidcTransaction(
        ctx.cookies.get(OIDC_TRANSACTION_COOKIE),
        strapi.config.get<string>('admin.auth.secret'),
        now()
      );
      clearTransactionCookie(strapi, ctx);

      const callbackUrl = new URL(config.callbackUrl);
      callbackUrl.search = new URL(ctx.request.url, config.callbackUrl).search;
      const returnedState = callbackUrl.searchParams.get('state');
      if (!returnedState || !equalStrings(returnedState, transaction.state)) {
        throw new Error('oidc_state_mismatch');
      }

      const claims = await (dependencies.exchangeCode ?? exchangeZitadelAuthorizationCode)(
        config,
        {
          callbackUrl,
          codeVerifier: transaction.codeVerifier,
          expectedNonce: transaction.nonce,
        },
        dependencies
      );
      const user = await (dependencies.ensureAdmin ?? ensureCreatorSignalAdmin)(
        strapi,
        config,
        claims
      );

      const sessionManager = strapi.sessionManager;
      if (!sessionManager?.hasOrigin?.('admin')) {
        throw new Error('admin_session_manager_unavailable');
      }
      const { token: refreshToken } = await sessionManager('admin').generateRefreshToken(
        String(user.id),
        (dependencies.randomDeviceId ?? randomUUID)(),
        {
          type: 'session',
          metadata: { userAgent: ctx.request.headers['user-agent'] },
        }
      );
      const refreshCookiePath = strapi.config.get<string>('admin.auth.cookie.path', '/admin');
      ctx.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
        ...commonCookieOptions(strapi, ctx),
        httpOnly: true,
        path: refreshCookiePath,
      });

      const access = await sessionManager('admin').generateAccessToken(refreshToken);
      if ('error' in access) {
        throw new Error('admin_session_generation_failed');
      }
      const accessCookieName = resolveAuthCookieName(
        strapi.config.get<string | undefined>('admin.auth.cookie.name')
      );
      ctx.cookies.set(accessCookieName, access.token, {
        ...commonCookieOptions(strapi, ctx),
        httpOnly: false,
        path: '/',
      });

      strapi.eventHub.emit('admin.auth.success', {
        provider: 'creativesignal-zitadel',
        user: strapi.service('admin::user').sanitizeUser(user),
      });
      ctx.redirect(transaction.returnTo);
    } catch (error) {
      clearTransactionCookie(strapi, ctx);
      deny(strapi, ctx, error);
    }
  },
});

const controller = {
  status(ctx: Context) {
    return createCreatorSignalAdminOidcController(strapi).status(ctx);
  },
  start(ctx: Context) {
    return createCreatorSignalAdminOidcController(strapi).start(ctx);
  },
  callback(ctx: Context) {
    return createCreatorSignalAdminOidcController(strapi).callback(ctx);
  },
};

export default controller;
