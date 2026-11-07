import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BUILDER_KEY_ENV, SUPERVISOR_KEY_ENV, supervisorKey } from '../../../src/services/artifacts/live/builder-keys';
import { composeSupervisor } from '../../../src/services/artifacts/live/supervisor-composition';
import { openFrame } from '../../../src/services/artifacts/live/supervisor-frame';
import { runtime, stream } from './supervisor-pod';

const der = (key: KeyObject, type: 'pkcs8' | 'spki') => key.export({ type, format: 'der' }).toString('base64');
const pair = generateKeyPairSync('ed25519');
const KID = 'sentropic-preprod-supervisor-1';
const value = (kid: unknown = KID, privateKey: unknown = der(pair.privateKey, 'pkcs8')) => JSON.stringify({ kid, privateKey });
const unconfigured = expect.objectContaining({ code: 'builder_unavailable', reason: 'keys_unconfigured' });
const sources = { source: vi.fn(async () => []), draft: vi.fn(async () => ({ files: [], deletes: [] })),
  dependencies: vi.fn(() => stream([])), candidate: vi.fn(async () => undefined) };
function relay(frames: Uint8Array[]) {
  return { send: vi.fn(async (_target: unknown, frame: Uint8Array) => {
    frames.push(frame);
    const { id } = JSON.parse(Buffer.from(frame.subarray(64)).toString('utf8')) as { id: string };
    return Buffer.from(JSON.stringify({ id, ok: true, data: { renewed: true } }));
  }) };
}
const embedded = (bootstrap: string) => /"PUBLIC_KEY":"([^"]+)"/.exec(bootstrap)?.[1] ?? '';

describe('supervisor frame signing key and pod bootstrap composition (s-archi 16:40 FIX5)', () => {
  it('should read the Ed25519 frame key from its fixed env name only', () => {
    expect(SUPERVISOR_KEY_ENV).toBe('ARTIFACT_SUPERVISOR_SIGNING_KEY_JSON');
    const key = supervisorKey({ [SUPERVISOR_KEY_ENV]: value() });
    expect(key.kid).toBe(KID);
    expect(key.key).toMatchObject({ type: 'private', asymmetricKeyType: 'ed25519' });
    expect(() => supervisorKey({ [BUILDER_KEY_ENV.signing]: value() })).toThrow(unconfigured);
  });
  it('should refuse an absent, malformed or non-Ed25519 private key', () => {
    const ed448 = generateKeyPairSync('ed448').privateKey;
    for (const raw of [undefined, '', 'not-json', '[]', JSON.stringify({ kid: KID }),
      JSON.stringify({ kid: KID, privateKey: der(pair.privateKey, 'pkcs8'), publicKey: 'x' }), value('bad kid'), value(7),
      value(KID, ''), value(KID, 'AAAA'), value(KID, der(ed448, 'pkcs8')), value(KID, der(pair.publicKey, 'spki'))]) {
      expect(() => supervisorKey({ [SUPERVISOR_KEY_ENV]: raw })).toThrow(unconfigured);
    }
  });
  it('should embed only the public half of the key that signs every supervisor frame', async () => {
    const frames: Uint8Array[] = [];
    const { bootstrap, supervisor } = composeSupervisor({ key: supervisorKey({ [SUPERVISOR_KEY_ENV]: value() }),
      channel: relay(frames), now: () => 1_000, id: () => 'frame-1', sources });
    expect(embedded(bootstrap)).toBe(der(pair.publicKey, 'spki'));
    expect(bootstrap).not.toContain(der(pair.privateKey, 'pkcs8'));
    await supervisor.renew(runtime);
    const podKey = createPublicKey({ key: Buffer.from(embedded(bootstrap), 'base64'), format: 'der', type: 'spki' });
    expect(openFrame(podKey, frames[0], 1_000)).toMatchObject({ op: 'renew', id: 'frame-1', fence: { podUid: runtime.podUid } });
    // A frame sealed with any other key fails the pod-side check of this bootstrap.
    const other = generateKeyPairSync('ed25519').privateKey;
    const foreign = composeSupervisor({ key: supervisorKey({ [SUPERVISOR_KEY_ENV]: value('rotated-2', der(other, 'pkcs8')) }),
      channel: relay(frames), now: () => 1_000, id: () => 'frame-2', sources });
    await foreign.supervisor.renew(runtime);
    expect(openFrame(podKey, frames[1], 1_000)).toBeNull();
    expect(embedded(foreign.bootstrap)).toBe(der(createPublicKey(other), 'spki'));
  });
});
