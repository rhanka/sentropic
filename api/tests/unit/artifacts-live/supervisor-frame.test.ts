import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FRAME_TTL_MS, MAX_FRAME_BYTES, MAX_REPLY_BYTES, openFrame, readReply, sealFrame, supervisorPublicKey,
  type FrameBody } from '../../../src/services/artifacts/live/supervisor-frame';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const body = (patch: Partial<FrameBody> = {}): FrameBody => ({ v: 1, id: 'cmd-1', op: 'terminate', issuedAt: 1_000,
  expiresAt: 1_000 + FRAME_TTL_MS, args: {}, fence: { generation: 1, sessionId: 's', leaseEpoch: 2, routeEpoch: 3,
    podName: 'artifact-' + 'a'.repeat(40), podUid: 'uid' }, ...patch });
const reply = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('supervisor frame', () => {
  it('should sign a frame that the pod opens with only the public key from the pod spec', () => {
    const podKey = createPublicKey({ key: Buffer.from(supervisorPublicKey(privateKey), 'base64'), format: 'der', type: 'spki' });
    expect(openFrame(podKey, sealFrame(privateKey, body()), 2_000)).toEqual(body());
  });
  it('should refuse a tampered, foreign-signed, expired or unknown-op frame', () => {
    const frame = Buffer.from(sealFrame(privateKey, body()));
    const tampered = Buffer.from(frame); tampered[tampered.length - 2] ^= 1;
    const foreign = sealFrame(generateKeyPairSync('ed25519').privateKey, body());
    expect(openFrame(publicKey, tampered, 2_000)).toBeNull();
    expect(openFrame(publicKey, foreign, 2_000)).toBeNull();
    expect(openFrame(publicKey, frame, 1_000 + FRAME_TTL_MS + 1)).toBeNull();
    expect(openFrame(publicKey, sealFrame(privateKey, body({ expiresAt: 1_000 + FRAME_TTL_MS + 1 })), 2_000)).toBeNull();
    expect(openFrame(publicKey, sealFrame(privateKey, body({ op: 'exec' as never })), 2_000)).toBeNull();
    expect(openFrame(publicKey, frame.subarray(0, 64), 2_000)).toBeNull();
  });
  it('should bound frames and refuse a non-Ed25519 signing key', () => {
    expect(() => sealFrame(privateKey, body({ args: { data: 'x'.repeat(MAX_FRAME_BYTES) } })))
      .toThrow(expect.objectContaining({ code: 'limit_exceeded' }));
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
    expect(() => sealFrame(rsa, body())).toThrow(expect.objectContaining({ code: 'builder_unavailable' }));
    expect(() => sealFrame(publicKey, body())).toThrow(expect.objectContaining({ code: 'builder_unavailable' }));
  });
  it('should accept only a bounded reply bound to the frame id', () => {
    expect(readReply(reply({ id: 'cmd-1', ok: true, data: { treeGone: true } }), 'cmd-1')).toEqual({ treeGone: true });
    expect(readReply(reply({ id: 'cmd-1', ok: true }), 'cmd-1')).toEqual({});
    for (const bad of [reply({ id: 'cmd-2', ok: true }), Buffer.from('not json'), reply([]),
      Buffer.alloc(MAX_REPLY_BYTES + 1, 0x20)]) {
      expect(() => readReply(bad, 'cmd-1')).toThrow(expect.objectContaining({ code: 'builder_unavailable' }));
    }
  });
  it('should map refusals to closed codes and never surface worker text', () => {
    const cases = [['fenced', { code: 'git_live_conflict', reason: 'stale_fence' }], ['limit', { code: 'limit_exceeded' }],
      ['integrity', { code: 'dependency_integrity_missing' }], ['failed', { code: 'builder_unavailable' }],
      ['/etc/passwd secret-token', { code: 'builder_unavailable' }]] as const;
    for (const [code, expected] of cases) {
      let error: unknown;
      try { readReply(reply({ id: 'cmd-1', ok: false, code, message: 'secret-token' }), 'cmd-1'); } catch (e) { error = e; }
      expect(error).toMatchObject(expected);
      expect(JSON.stringify(error) + String((error as Error).message)).not.toContain('secret-token');
    }
  });
});
