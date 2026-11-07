import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_REVISION_LENGTH, signLiveAssertion, signLiveControl, signLiveFence, verifyLiveAssertion, verifyLiveControl,
  verifyLiveFence, type LiveAssertionClaims, type LiveControlClaims, type LiveFenceClaims,
} from '../src/live-host/live-format.js';

const key = Buffer.alloc(32, 7); const t0 = 1_000_000; const s0 = t0 / 1000;
const keys = (kid: string) => (kid === 'immo-1' || kid === 'sentropic-1' ? key : undefined);
const at = (now = t0) => ({ key: keys, now: () => now });
const artifactId = '11111111-1111-4111-8111-111111111111'; const host = `${artifactId}.pages.immo.example`;
const claims = (over: Partial<LiveAssertionClaims> = {}): LiveAssertionClaims => ({ v: 1, kid: 'immo-1', host, artifactId,
  storageScopeId: 'scope', sessionId: 'session', generation: 1, routeEpoch: 1, podUid: 'uid', podName: 'live-pod',
  sourceRevision: '8f14e45f-ceea-467a-9575-21b2a6c3e1d0', principalId: 'owner', role: 'binding_owner', invitationId: '',
  invitationEpoch: 0, invitationExp: 0, iat: s0, exp: s0 + 600, ...over });
const invitee = (over: Partial<LiveAssertionClaims> = {}) => claims({ role: 'invitee', principalId: 'guest', invitationId: 'inv-1',
  invitationEpoch: 1, invitationExp: s0 + 900, ...over });
const control = (over: Partial<LiveControlClaims> = {}): LiveControlClaims => ({ v: 1, kid: 'immo-1', host, artifactId,
  op: 'revoke_invitation', sessionId: '', invitationId: 'inv-1', epoch: 2, iat: s0, exp: s0 + 60, ...over });
const fence = (over: Partial<LiveFenceClaims> = {}): LiveFenceClaims => ({ v: 1, kid: 'sentropic-1', artifactId, generation: 1,
  routeEpoch: 2, iat: s0, exp: s0 + 60, ...over });
/** Signs any body under a prefix, bypassing the typed signers, to exercise verifier-side refusals. */
const raw = (prefix: string, body: object) => {
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${prefix}.${encoded}.${createHmac('sha256', key).update(`${prefix}.${encoded}`).digest('base64url')}`;
};

describe('live-host live wire format (A-LIVE 8.2)', () => {
  it('pins the assertion token vector and round-trips every kind', () => {
    const token = signLiveAssertion(claims(), key);
    const body = Buffer.from(JSON.stringify(claims())).toString('base64url');
    expect(token).toBe(`v1.${body}.Vf9XGg_OPpqqPgR8JDjvl_TlUzV0g__092E9yFtQ63E`);
    expect(verifyLiveAssertion(token, at())).toEqual(claims());
    expect(verifyLiveAssertion(signLiveAssertion(invitee(), key), at())).toEqual(invitee());
    expect(verifyLiveControl(signLiveControl(control(), key), at())).toEqual(control());
    expect(verifyLiveFence(signLiveFence(fence(), key), at())).toEqual(fence());
  });
  it('binds the prefix in the MAC: no kind is accepted as another', () => {
    const [, body, mac] = signLiveAssertion(claims(), key).split('.');
    expect(verifyLiveControl(`c1.${body}.${mac}`, at())).toBeUndefined();
    expect(verifyLiveControl(signLiveFence(fence(), key), at())).toBeUndefined();
    expect(verifyLiveFence(signLiveControl(control(), key), at())).toBeUndefined();
    expect(verifyLiveAssertion(raw('c1', claims()), at())).toBeUndefined();
  });
  it('refuses tampering, a wrong or short key, an unknown kid and malformed tokens', () => {
    const [v, body, mac] = signLiveAssertion(claims(), key).split('.');
    const forged = Buffer.from(JSON.stringify(claims({ principalId: 'attacker' }))).toString('base64url');
    for (const bad of [`${v}.${forged}.${mac}`, `${v}.${body}.${mac.slice(0, -2)}AA`, signLiveAssertion(claims(), Buffer.alloc(32, 9)),
      signLiveAssertion(claims({ kid: 'other' }), key), 'garbage', '', `v2.${body}.${mac}`, `${v}.${body}`, `${v}.${body}.${mac}.x`,
      `${v}.${'A'.repeat(2048)}.${mac}`]) {
      expect(verifyLiveAssertion(bad, at())).toBeUndefined();
    }
    expect(() => signLiveAssertion(claims(), Buffer.alloc(8))).toThrow();
    expect(verifyLiveAssertion(signLiveAssertion(claims(), key), { key: () => Buffer.alloc(8, 1), now: () => t0 })).toBeUndefined();
  });
  it('refuses expired, not-yet-valid and over-long messages', () => {
    const token = signLiveAssertion(claims(), key);
    expect(verifyLiveAssertion(token, at(t0 + 601_000))).toBeUndefined();
    for (const over of [{ iat: s0 + 120, exp: s0 + 700 }, { exp: s0 + 3601 }, { exp: s0 - 1 }]) {
      expect(verifyLiveAssertion(signLiveAssertion(claims(over), key), at())).toBeUndefined();
    }
    expect(verifyLiveControl(signLiveControl(control({ exp: s0 + 301 }), key), at())).toBeUndefined();
    expect(verifyLiveFence(signLiveFence(fence({ exp: s0 + 301 }), key), at())).toBeUndefined();
  });
  it('carries the source revision as an opaque bounded string, never a number', () => {
    for (const sourceRevision of ['r', 'gen:3/rev:8f14e45f', 'x'.repeat(MAX_SOURCE_REVISION_LENGTH)]) {
      expect(verifyLiveAssertion(signLiveAssertion(claims({ sourceRevision }), key), at())?.sourceRevision).toBe(sourceRevision);
    }
    for (const sourceRevision of [3, '', 'x'.repeat(MAX_SOURCE_REVISION_LENGTH + 1), null]) {
      expect(() => signLiveAssertion(claims({ sourceRevision } as never), key)).toThrow(TypeError);
      expect(verifyLiveAssertion(raw('v1', claims({ sourceRevision } as never)), at())).toBeUndefined();
    }
  });
  it('refuses missing, extra or mistyped fields and negative or fractional numbers', () => {
    const { podUid: _omitted, ...missing } = claims();
    for (const body of [missing, { ...claims(), extra: 'x' }, claims({ generation: '1' as never }), claims({ routeEpoch: -1 }),
      claims({ generation: 1.5 }), claims({ v: 2 as never })]) {
      expect(verifyLiveAssertion(raw('v1', body), at())).toBeUndefined();
    }
  });
  it('validates the owner and invitee roles', () => {
    for (const bad of [claims({ invitationId: 'inv-1' }), claims({ invitationEpoch: 1 }), claims({ role: 'reader' as never }),
      invitee({ invitationId: '' }), invitee({ invitationId: 'bad id' }), invitee({ invitationEpoch: 0 }),
      invitee({ invitationExp: s0 }), invitee({ invitationExp: s0 + 300 })]) {
      expect(verifyLiveAssertion(signLiveAssertion(bad, key), at())).toBeUndefined();
    }
  });
  it('validates host control and controller fence operations', () => {
    const session = control({ op: 'revoke_session', sessionId: 'session', invitationId: '', epoch: 0 });
    expect(verifyLiveControl(signLiveControl(session, key), at())).toEqual(session);
    for (const bad of [control({ sessionId: 'session' }), control({ epoch: 0 }), control({ epoch: 1.5 }),
      { ...session, epoch: 1 }, { ...session, invitationId: 'inv-1' }, control({ op: 'fence' as never })]) {
      expect(verifyLiveControl(signLiveControl(bad, key), at())).toBeUndefined();
    }
    expect(verifyLiveFence(signLiveFence(fence({ generation: 0 }), key), at())).toBeUndefined();
  });
});
