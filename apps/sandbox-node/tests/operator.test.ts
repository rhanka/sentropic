import { describe, expect, it } from 'vitest';
import { sign } from 'node:crypto';
import { generateTicketKeyPair } from '../src/tickets.js';
import { OperatorGuard } from '../src/operator.js';

describe('operator compact JWS', () => {
  const key = generateTicketKeyPair(), next = generateTicketKeyPair();
  const claims = { op: 'drain', nodeInstanceId: 'node', nodeEpoch: 2, iat: 100, exp: 160, jti: 'one', aud: 'execution-node' };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const ticket = (body = claims, privateKey = key.privateKeyPem, alg = 'EdDSA') => {
    const payload = `${encode({ alg })}.${encode(body)}`;
    return `${payload}.${sign(null, Buffer.from(payload), privateKey).toString('base64url')}`;
  };
  it('should accept either rotation key and reject a replay', () => {
    const guard = new OperatorGuard([key.publicKeyPem, next.publicKeyPem], 'node', 2, () => 110);
    guard.authorize(ticket(), 'drain');
    expect(() => guard.authorize(ticket(), 'drain')).toThrow();
    guard.authorize(ticket({ ...claims, jti: 'two' }, next.privateKeyPem), 'drain');
  });
  it('should reject tampering, wrong operation, node, epoch, audience, TTL and expiry', () => {
    const guard = new OperatorGuard([key.publicKeyPem], 'node', 2, () => 110);
    for (const body of [{ ...claims, op: 'status' }, { ...claims, nodeInstanceId: 'other' },
      { ...claims, nodeEpoch: 1 }, { ...claims, aud: 'other' }, { ...claims, exp: 161 },
      { ...claims, exp: 110 }, { ...claims, iat: 111 }, { ...claims, jti: '' }]) {
      expect(() => guard.authorize(ticket(body), 'drain')).toThrow();
    }
    expect(() => guard.authorize(ticket(claims, next.privateKeyPem), 'drain')).toThrow();
    expect(() => guard.authorize(ticket(claims, key.privateKeyPem, 'none'), 'drain')).toThrow();
    expect(() => guard.authorize(undefined, 'drain')).toThrow();
  });
});
