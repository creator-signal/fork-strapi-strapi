import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

import type { CreatorSignalAdminOidcConfig } from './config';

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

interface JsonWebKey {
  kid?: string;
  kty?: string;
  use?: string;
  alg?: string;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  token_type?: string;
}

export interface ZitadelIdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  azp?: string;
  exp: number;
  iat: number;
  nbf?: number;
  nonce: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  [key: string]: unknown;
}

export interface OidcDependencies {
  fetch?: typeof fetch;
  now?: () => number;
}

const jsonResponse = async <T>(response: Response, source: string): Promise<T> => {
  if (!response.ok) {
    throw new Error(`${source}_request_failed`);
  }

  return (await response.json()) as T;
};

const trustedEndpoint = (value: string, config: CreatorSignalAdminOidcConfig): URL => {
  const url = new URL(value);
  const issuer = new URL(config.issuer);
  if (
    url.origin !== issuer.origin ||
    url.protocol !== issuer.protocol ||
    url.username ||
    url.password
  ) {
    throw new Error('oidc_discovery_contains_untrusted_endpoint');
  }

  return url;
};

const discover = async (
  config: CreatorSignalAdminOidcConfig,
  fetcher: typeof fetch
): Promise<DiscoveryDocument> => {
  const response = await fetcher(`${config.issuer}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const document = await jsonResponse<DiscoveryDocument>(response, 'oidc_discovery');

  if (document.issuer !== config.issuer) {
    throw new Error('oidc_discovery_issuer_mismatch');
  }
  trustedEndpoint(document.authorization_endpoint, config);
  trustedEndpoint(document.token_endpoint, config);
  trustedEndpoint(document.jwks_uri, config);

  if (!document.response_types_supported?.includes('code')) {
    throw new Error('oidc_authorization_code_flow_unsupported');
  }
  if (!document.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('oidc_pkce_s256_unsupported');
  }
  if (!document.id_token_signing_alg_values_supported?.includes('RS256')) {
    throw new Error('oidc_rs256_unsupported');
  }

  return document;
};

const formUrlEncode = (value: string): string => {
  const encoded = new URLSearchParams({ value }).toString();
  return encoded.slice('value='.length);
};

const equalStrings = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const parseJwt = (
  value: string
): {
  header: Record<string, unknown>;
  claims: ZitadelIdTokenClaims;
  signingInput: string;
  signature: Buffer;
} => {
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('oidc_id_token_invalid');
  }

  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >,
      claims: JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8')
      ) as ZitadelIdTokenClaims,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2], 'base64url'),
    };
  } catch {
    throw new Error('oidc_id_token_invalid');
  }
};

const validateClaims = (
  claims: ZitadelIdTokenClaims,
  config: CreatorSignalAdminOidcConfig,
  expectedNonce: string,
  now: number
): void => {
  const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
  if (
    claims.iss !== config.issuer ||
    !Array.isArray(audiences) ||
    !audiences.includes(config.clientId) ||
    (audiences.length > 1 && claims.azp !== config.clientId) ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now - 60 ||
    typeof claims.iat !== 'number' ||
    claims.iat > now + 60 ||
    (typeof claims.nbf === 'number' && claims.nbf > now + 60) ||
    typeof claims.nonce !== 'string' ||
    !equalStrings(claims.nonce, expectedNonce)
  ) {
    throw new Error('oidc_id_token_claims_invalid');
  }
};

const verifyIdToken = async (
  idToken: string,
  discovery: DiscoveryDocument,
  config: CreatorSignalAdminOidcConfig,
  expectedNonce: string,
  fetcher: typeof fetch,
  now: number
): Promise<ZitadelIdTokenClaims> => {
  const parsed = parseJwt(idToken);
  if (parsed.header.alg !== 'RS256' || typeof parsed.header.kid !== 'string') {
    throw new Error('oidc_id_token_algorithm_invalid');
  }

  const response = await fetcher(discovery.jwks_uri, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const jwks = await jsonResponse<{ keys?: JsonWebKey[] }>(response, 'oidc_jwks');
  const key = jwks.keys?.find(
    (candidate) =>
      candidate.kid === parsed.header.kid &&
      candidate.kty === 'RSA' &&
      (candidate.use === undefined || candidate.use === 'sig') &&
      (candidate.alg === undefined || candidate.alg === 'RS256')
  );
  if (!key) {
    throw new Error('oidc_signing_key_unavailable');
  }

  const publicKey = createPublicKey({ key, format: 'jwk' });
  if (!verify('RSA-SHA256', Buffer.from(parsed.signingInput), publicKey, parsed.signature)) {
    throw new Error('oidc_id_token_signature_invalid');
  }

  validateClaims(parsed.claims, config, expectedNonce, now);
  return parsed.claims;
};

export const createPkceChallenge = (codeVerifier: string): string =>
  createHash('sha256').update(codeVerifier).digest('base64url');

export const buildZitadelAuthorizationUrl = async (
  config: CreatorSignalAdminOidcConfig,
  input: { codeChallenge: string; state: string; nonce: string },
  dependencies: OidcDependencies = {}
): Promise<URL> => {
  const fetcher = dependencies.fetch ?? fetch;
  const metadata = await discover(config, fetcher);
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    nonce: input.nonce,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: [
      'openid',
      'profile',
      'email',
      'urn:zitadel:iam:org:projects:roles',
      `urn:zitadel:iam:org:project:id:${config.projectId}:aud`,
    ].join(' '),
    state: input.state,
  }).toString();
  return url;
};

export const exchangeZitadelAuthorizationCode = async (
  config: CreatorSignalAdminOidcConfig,
  input: { callbackUrl: URL; codeVerifier: string; expectedNonce: string },
  dependencies: OidcDependencies = {}
): Promise<ZitadelIdTokenClaims> => {
  const fetcher = dependencies.fetch ?? fetch;
  const metadata = await discover(config, fetcher);
  const code = input.callbackUrl.searchParams.get('code');
  if (!code || input.callbackUrl.searchParams.has('error')) {
    throw new Error('oidc_authorization_response_invalid');
  }

  const credentials = Buffer.from(
    `${formUrlEncode(config.clientId)}:${formUrlEncode(config.clientSecret)}`
  ).toString('base64');
  const response = await fetcher(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: config.callbackUrl,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const tokens = await jsonResponse<TokenResponse>(response, 'oidc_token');
  if (!tokens.id_token) {
    throw new Error('oidc_id_token_missing');
  }

  return verifyIdToken(
    tokens.id_token,
    metadata,
    config,
    input.expectedNonce,
    fetcher,
    Math.floor((dependencies.now?.() ?? Date.now()) / 1000)
  );
};
