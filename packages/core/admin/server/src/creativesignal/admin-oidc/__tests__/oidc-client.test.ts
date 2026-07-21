import { generateKeyPairSync, sign } from 'node:crypto';

import type { CreatorSignalAdminOidcConfig } from '../config';
import {
  buildZitadelAuthorizationUrl,
  createPkceChallenge,
  exchangeZitadelAuthorizationCode,
  type ZitadelIdTokenClaims,
} from '../oidc-client';

const config: CreatorSignalAdminOidcConfig = {
  enabled: true,
  issuer: 'https://auth.creatorsignal.me',
  clientId: 'client@example',
  clientSecret: 'secret+value',
  callbackUrl: 'https://content.creatorsignal.me/admin/creativesignal/oidc/callback',
  projectId: 'project-1',
  requiredProjectRole: 'content:editor',
  strapiRoleCode: 'strapi-editor',
  allowInsecureDevelopmentHttp: false,
};

const metadata = {
  issuer: config.issuer,
  authorization_endpoint: `${config.issuer}/oauth/v2/authorize`,
  token_endpoint: `${config.issuer}/oauth/v2/token`,
  jwks_uri: `${config.issuer}/oauth/v2/keys`,
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
  id_token_signing_alg_values_supported: ['RS256'],
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (claims: ZitadelIdTokenClaims) => {
  const header = encode({ alg: 'RS256', kid: 'key-1', typ: 'JWT' });
  const payload = encode(claims);
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString(
    'base64url'
  );
  return `${header}.${payload}.${signature}`;
};

const claims = (override: Partial<ZitadelIdTokenClaims> = {}): ZitadelIdTokenClaims => ({
  iss: config.issuer,
  sub: 'user-1',
  aud: config.clientId,
  exp: 2_000,
  iat: 1_000,
  nonce: 'nonce',
  email: 'editor@creatorsignal.me',
  email_verified: true,
  ...override,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const createFetch = (tokenClaims = claims()) =>
  jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) {
      return json(metadata);
    }
    if (url === metadata.token_endpoint) {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: `Basic ${Buffer.from('client%40example:secret%2Bvalue').toString(
            'base64'
          )}`,
        })
      );
      expect(String(init?.body)).toContain('code_verifier=verifier');
      return json({ id_token: idToken(tokenClaims), access_token: 'access', token_type: 'Bearer' });
    }
    if (url === metadata.jwks_uri) {
      return json({ keys: [{ ...publicJwk, kid: 'key-1', alg: 'RS256', use: 'sig' }] });
    }
    throw new Error(`Unexpected test URL ${url}`);
  }) as unknown as typeof fetch;

describe('Creator Signal ZITADEL OIDC client', () => {
  test('builds an Authorization Code + PKCE request with exact project scopes', async () => {
    const url = await buildZitadelAuthorizationUrl(
      config,
      { codeChallenge: 'challenge', nonce: 'nonce', state: 'state' },
      { fetch: createFetch() }
    );

    expect(url.origin + url.pathname).toBe(metadata.authorization_endpoint);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining([
        'openid',
        'urn:zitadel:iam:org:projects:roles',
        `urn:zitadel:iam:org:project:id:${config.projectId}:aud`,
      ])
    );
    expect(createPkceChallenge('verifier')).toHaveLength(43);
  });

  test('exchanges the code and verifies the signed ID token', async () => {
    await expect(
      exchangeZitadelAuthorizationCode(
        config,
        {
          callbackUrl: new URL(`${config.callbackUrl}?code=code&state=state`),
          codeVerifier: 'verifier',
          expectedNonce: 'nonce',
        },
        { fetch: createFetch(), now: () => 1_500_000 }
      )
    ).resolves.toEqual(expect.objectContaining({ sub: 'user-1', nonce: 'nonce' }));
  });

  test.each([
    ['issuer', claims({ iss: 'https://attacker.example' })],
    ['audience', claims({ aud: 'different-client' })],
    ['nonce', claims({ nonce: 'different-nonce' })],
    ['expiry', claims({ exp: 1_000 })],
  ])('rejects an invalid %s claim', async (_name, tokenClaims) => {
    await expect(
      exchangeZitadelAuthorizationCode(
        config,
        {
          callbackUrl: new URL(`${config.callbackUrl}?code=code&state=state`),
          codeVerifier: 'verifier',
          expectedNonce: 'nonce',
        },
        { fetch: createFetch(tokenClaims), now: () => 1_500_000 }
      )
    ).rejects.toThrow();
  });

  test('rejects discovery endpoints outside the configured issuer origin', async () => {
    const maliciousFetch = jest.fn(async () =>
      json({ ...metadata, token_endpoint: 'https://attacker.example/token' })
    ) as unknown as typeof fetch;
    await expect(
      buildZitadelAuthorizationUrl(
        config,
        { codeChallenge: 'challenge', nonce: 'nonce', state: 'state' },
        { fetch: maliciousFetch }
      )
    ).rejects.toThrow('oidc_discovery_contains_untrusted_endpoint');
  });
});
