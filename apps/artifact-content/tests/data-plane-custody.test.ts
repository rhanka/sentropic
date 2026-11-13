import { describe, expect, it } from 'vitest';
import { fixtureCustody } from './data-plane-custody';
import type { CustodyLease } from '../src/data-plane';

describe('fake agent compact custody contract', () => {
  it('should accept six signed claims and reject malformed, forged and expired custody', () => {
    const custody = fixtureCustody();
    try {
      const issued = Date.now();
      const lease: CustodyLease = { tenantId: 'sentropic', principalId: 'principal', physicalUid: 'physical-1',
        custodyEpoch: 1, port: 5173, token: '', issuedAt: new Date(issued).toISOString(),
        deadlineAt: new Date(issued + 60_000).toISOString() };
      const token = custody.sign(lease);
      expect(token.split('.')).toHaveLength(3);
      expect(custody.verify(token, 'sentropic', 'physical-1')).toMatchObject({ resourceId: 'physical-1' });
      const [header, payload, signature] = token.split('.');
      for (const invalid of [`${payload}.${signature}`, `${header}.${payload}.${signature}.extra`,
        `${header}.${Buffer.from('{}').toString('base64url')}.${signature}`,
        `${Buffer.from('{"alg":"none"}').toString('base64url')}.${payload}.${signature}`]) {
        expect(() => custody.verify(invalid, 'sentropic', 'physical-1')).toThrow();
      }
      expect(() => custody.verify(token, 'immo', 'physical-1')).toThrow();
      expect(() => custody.verify(token, 'sentropic', 'physical-2')).toThrow();
      for (const change of [{ principalId: '' }, { deadlineAt: new Date(issued + 60_001).toISOString() },
        { issuedAt: new Date(issued + 10_000).toISOString() }, { deadlineAt: new Date(issued - 1).toISOString() }]) {
        expect(() => custody.verify(custody.sign({ ...lease, ...change }), 'sentropic', 'physical-1')).toThrow();
      }
      custody.guard.revoke('sentropic', 'physical-1', 2);
      expect(() => custody.verify(token, 'sentropic', 'physical-1')).toThrow('custody_revoked');
      expect(custody.verify(custody.sign({ ...lease, custodyEpoch: 2 }), 'sentropic', 'physical-1')).toBeTruthy();
    } finally { custody.close(); }
  });
});
