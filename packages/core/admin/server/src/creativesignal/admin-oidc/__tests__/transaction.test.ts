import { readOidcTransaction, safeAdminReturnTo, signOidcTransaction } from '../transaction';

const transaction = {
  codeVerifier: 'verifier',
  issuedAt: 1_000,
  nonce: 'nonce',
  returnTo: '/admin/content-manager/collection-types/api::page.page',
  state: 'state',
};

describe('Creator Signal OIDC transaction', () => {
  test('round-trips a signed, unexpired transaction', () => {
    const signed = signOidcTransaction(transaction, 'secret');
    expect(readOidcTransaction(signed, 'secret', 2_000)).toEqual(transaction);
  });

  test('rejects tampering and expiry', () => {
    const signed = signOidcTransaction(transaction, 'secret');
    expect(() => readOidcTransaction(`${signed}x`, 'secret', 2_000)).toThrow(
      'oidc_transaction_invalid'
    );
    expect(() => readOidcTransaction(signed, 'secret', 11 * 60 * 1_000)).toThrow(
      'oidc_transaction_expired_or_invalid'
    );
  });

  test.each([
    ['https://attacker.example/admin'],
    ['//attacker.example/admin'],
    ['/not-admin'],
    ['/admin/../../attacker'],
    [undefined],
  ])('uses the safe default for unsafe return target %p', (value) => {
    expect(safeAdminReturnTo(value)).toBe('/admin/content-manager');
  });
});
