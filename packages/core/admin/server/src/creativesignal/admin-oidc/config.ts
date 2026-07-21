import type { Core } from '@strapi/types';

const DEFAULT_REQUIRED_PROJECT_ROLE = 'content:editor';
const DEFAULT_STRAPI_ROLE_CODE = 'strapi-editor';
const CALLBACK_PATH = '/admin/creativesignal/oidc/callback';

export interface CreatorSignalAdminOidcConfig {
  enabled: true;
  issuer: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  projectId: string;
  requiredProjectRole: string;
  strapiRoleCode: string;
  allowInsecureDevelopmentHttp: boolean;
}

const required = (value: unknown, name: string): string => {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) {
    throw new Error(`admin.creativesignal.adminOidc.${name} is required when OIDC is enabled`);
  }

  return result;
};

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '127.0.0.1' ||
  hostname === '::1';

const validateUrl = (value: string, name: string, allowInsecureDevelopmentHttp: boolean): URL => {
  const url = new URL(value);
  const permitsHttp =
    process.env.NODE_ENV !== 'production' &&
    allowInsecureDevelopmentHttp &&
    isLoopbackHostname(url.hostname);

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && permitsHttp)) {
    throw new Error(
      `admin.creativesignal.adminOidc.${name} must use HTTPS (loopback HTTP is development-only)`
    );
  }

  if (url.username || url.password || url.hash) {
    throw new Error(`admin.creativesignal.adminOidc.${name} contains unsupported URL components`);
  }

  return url;
};

export const getCreatorSignalAdminOidcConfig = (
  strapi: Core.Strapi
): CreatorSignalAdminOidcConfig | null => {
  const input = strapi.config.get<Core.Config.Admin['creativesignal']>('admin.creativesignal', {});
  const oidc = input?.adminOidc;
  if (oidc?.enabled !== true) {
    return null;
  }

  const allowInsecureDevelopmentHttp = oidc.allowInsecureDevelopmentHttp === true;
  const issuerUrl = validateUrl(
    required(oidc.issuer, 'issuer').replace(/\/$/, ''),
    'issuer',
    allowInsecureDevelopmentHttp
  );
  const callbackUrl = validateUrl(
    required(oidc.callbackUrl, 'callbackUrl'),
    'callbackUrl',
    allowInsecureDevelopmentHttp
  );

  if (issuerUrl.search || issuerUrl.pathname !== '/') {
    throw new Error('admin.creativesignal.adminOidc.issuer must be an origin URL');
  }

  if (callbackUrl.pathname !== CALLBACK_PATH || callbackUrl.search) {
    throw new Error(
      `admin.creativesignal.adminOidc.callbackUrl must use the exact ${CALLBACK_PATH} path`
    );
  }

  const strapiRoleCode = required(
    oidc.strapiRoleCode ?? DEFAULT_STRAPI_ROLE_CODE,
    'strapiRoleCode'
  );
  if (strapiRoleCode === 'strapi-super-admin') {
    throw new Error('Creator Signal OIDC cannot provision the Strapi Super Admin role');
  }

  return {
    enabled: true,
    issuer: issuerUrl.origin,
    clientId: required(oidc.clientId, 'clientId'),
    clientSecret: required(oidc.clientSecret, 'clientSecret'),
    callbackUrl: callbackUrl.href,
    projectId: required(oidc.projectId, 'projectId'),
    requiredProjectRole: required(
      oidc.requiredProjectRole ?? DEFAULT_REQUIRED_PROJECT_ROLE,
      'requiredProjectRole'
    ),
    strapiRoleCode,
    allowInsecureDevelopmentHttp,
  };
};

export const creatorSignalAdminOidcCallbackPath = CALLBACK_PATH;
