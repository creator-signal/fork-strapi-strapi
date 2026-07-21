import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TRANSACTION_LIFETIME_MS = 10 * 60 * 1000;
const DEFAULT_RETURN_TO = '/admin/content-manager';

export interface OidcTransaction {
  codeVerifier: string;
  issuedAt: number;
  nonce: string;
  returnTo: string;
  state: string;
}

export const safeAdminReturnTo = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^\/admin(?:[/?]|$)/.test(value) ||
    value.startsWith('//') ||
    value.includes('#')
  ) {
    return DEFAULT_RETURN_TO;
  }

  const url = new URL(value, 'https://strapi.invalid');
  const rawPath = value.split('?')[0];
  if (
    url.origin !== 'https://strapi.invalid' ||
    url.pathname !== rawPath ||
    (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/'))
  ) {
    return DEFAULT_RETURN_TO;
  }

  return `${url.pathname}${url.search}`;
};

export const randomUrlSafeValue = (): string => randomBytes(32).toString('base64url');

export const signOidcTransaction = (value: OidcTransaction, secret: string): string => {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

export const readOidcTransaction = (
  value: unknown,
  secret: string,
  now = Date.now()
): OidcTransaction => {
  if (typeof value !== 'string') {
    throw new Error('oidc_transaction_missing');
  }

  const [payload, suppliedSignature, extra] = value.split('.');
  if (!payload || !suppliedSignature || extra) {
    throw new Error('oidc_transaction_invalid');
  }

  const expectedSignature = createHmac('sha256', secret).update(payload).digest();
  const suppliedSignatureBytes = Buffer.from(suppliedSignature, 'base64url');
  if (
    suppliedSignatureBytes.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignatureBytes, expectedSignature)
  ) {
    throw new Error('oidc_transaction_invalid');
  }

  const transaction = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8')
  ) as Partial<OidcTransaction>;
  if (
    typeof transaction.state !== 'string' ||
    typeof transaction.nonce !== 'string' ||
    typeof transaction.codeVerifier !== 'string' ||
    typeof transaction.issuedAt !== 'number' ||
    transaction.issuedAt > now ||
    now - transaction.issuedAt > TRANSACTION_LIFETIME_MS
  ) {
    throw new Error('oidc_transaction_expired_or_invalid');
  }

  return {
    codeVerifier: transaction.codeVerifier,
    issuedAt: transaction.issuedAt,
    nonce: transaction.nonce,
    returnTo: safeAdminReturnTo(transaction.returnTo),
    state: transaction.state,
  };
};

export const oidcTransactionLifetimeMs = TRANSACTION_LIFETIME_MS;
