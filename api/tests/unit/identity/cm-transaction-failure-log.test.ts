import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { describe, expect, it } from 'vitest';

import {
  closedRefusalCode,
  CmHttpRefusalError,
  describeCmTransactionFailure,
} from '../../../src/services/identity/cm-transaction';

const SENTINEL = 'private-credential-material';

describe('CM host transaction failure log fields', () => {
  it('keeps the custody code for a custody refusal', () => {
    expect(describeCmTransactionFailure(new IdentityCustodyErrorV1('identity_transaction_unbound')))
      .toEqual({ code: 'identity_transaction_unbound', errorType: 'IdentityCustodyErrorV1' });
  });

  it('logs an expected HTTP refusal as a refusal with its status and closed code, not a host failure', () => {
    const fields = describeCmTransactionFailure(new CmHttpRefusalError(401, 'credential_not_found'));
    expect(fields).toEqual({ code: 'identity_http_refusal', status: 401, refusalCode: 'credential_not_found',
      errorType: 'CmHttpRefusalError' });
  });

  it('keeps a SQLSTATE, direct or as the cause', () => {
    expect(describeCmTransactionFailure(Object.assign(new Error(SENTINEL), { code: '40001' })))
      .toEqual({ code: '40001', errorType: 'Error' });
    expect(describeCmTransactionFailure(new Error(SENTINEL, { cause: Object.assign(new Error(SENTINEL), { code: '23505' }) })))
      .toEqual({ code: '23505', errorType: 'Error' });
  });

  it('keeps identity_host_failure for any other error, with its type and a non-SQLSTATE driver code', () => {
    class GcmLikeError extends Error { override name = 'GcmLikeError'; }
    expect(describeCmTransactionFailure(new GcmLikeError(SENTINEL)))
      .toEqual({ code: 'identity_host_failure', errorType: 'GcmLikeError' });
    expect(describeCmTransactionFailure(Object.assign(new Error(SENTINEL), { code: 'ECONNRESET' })))
      .toEqual({ code: 'identity_host_failure', errorType: 'Error', errorCode: 'ECONNRESET' });
    expect(describeCmTransactionFailure(Object.assign(new Error(SENTINEL), { code: SENTINEL })))
      .toEqual({ code: 'identity_host_failure', errorType: 'Error' });
    expect(describeCmTransactionFailure('thrown string')).toEqual({ code: 'identity_host_failure', errorType: 'unknown' });
  });

  it('never carries an error message', () => {
    for (const error of [new Error(SENTINEL), new CmHttpRefusalError(400, 'invalid_request'),
      Object.assign(new Error(SENTINEL), { code: '40P01', detail: SENTINEL })]) {
      expect(JSON.stringify(describeCmTransactionFailure(error))).not.toContain(SENTINEL);
    }
  });
});

describe('closedRefusalCode', () => {
  it('reads the closed code of both error DTO shapes', () => {
    expect(closedRefusalCode(JSON.stringify({ error: { code: 'authentication_verification_failed', message: 'x' } })))
      .toBe('authentication_verification_failed');
    expect(closedRefusalCode(JSON.stringify({ error: 'invalid_grant', error_description: SENTINEL }))).toBe('invalid_grant');
  });

  it('refuses anything that is not a closed snake_case code', () => {
    for (const body of ['not json', '{}', JSON.stringify({ error: { code: `Free text ${SENTINEL}` } }),
      JSON.stringify({ error: { code: 'a'.repeat(65) } }), JSON.stringify({ error: 42 })]) {
      expect(closedRefusalCode(body)).toBe('unrecognized');
    }
  });
});
