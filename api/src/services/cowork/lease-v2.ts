import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export type LeaseV2Envelope = Readonly<{
  version: 2; kid: string; leaseId: string; invocationId: string; toolCallId: string; durableCallRef: string | null;
  principalId: string; tenantId: string; workspaceId: string; targetDeviceId: string; targetPepKeyId: string;
  capability: string; actionKind: string; actionDescriptorId: string; argumentDigest: string; requiredAuthority: string;
  scopeOrReceiptId: string | null; attestationProfileId: string; policyVersion: string; actionBudget: number;
  killEpoch: number; issuedAt: string; expiresAt: string; nonce: string;
}>;

export type SignedLeaseV2 = Readonly<{ envelope: LeaseV2Envelope; signature: string }>;
type ServerKey = Readonly<{ kid: string; privateKey: KeyObject }>;
type PublicKey = Readonly<{ kid: string; publicJwk: JsonWebKey }>;
export interface LeaseV2KeyPort { getActiveKey(): Promise<ServerKey | null>; findKeyByKid(kid: string): Promise<PublicKey | null>; }

/** Stable JSON avoids signature ambiguity across rotation and language boundaries. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') throw new Error('Lease payload is not canonicalizable.');
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export const leaseV2Digest = (envelope: LeaseV2Envelope): string =>
  createHash('sha256').update(canonicalJson(envelope)).digest('base64url');

export async function signLeaseV2(envelope: Omit<LeaseV2Envelope, 'version' | 'kid'>, keys: LeaseV2KeyPort): Promise<SignedLeaseV2 | null> {
  const active = await keys.getActiveKey();
  if (!active) return null;
  const complete: LeaseV2Envelope = Object.freeze({ ...envelope, version: 2, kid: active.kid });
  return Object.freeze({ envelope: complete, signature: sign(null, Buffer.from(canonicalJson(complete)), active.privateKey).toString('base64url') });
}

export async function verifyLeaseV2(
  signed: SignedLeaseV2 | { envelope: { version?: unknown; kid?: unknown }; signature: string },
  keys: LeaseV2KeyPort,
  expected: Partial<Pick<LeaseV2Envelope, 'targetDeviceId' | 'targetPepKeyId' | 'tenantId' | 'workspaceId' | 'principalId' | 'nonce'>> = {},
  now = new Date(),
): Promise<boolean> {
  const envelope = signed.envelope as LeaseV2Envelope;
  if (envelope.version !== 2 || typeof envelope.kid !== 'string') return false;
  const record = await keys.findKeyByKid(envelope.kid);
  if (!record) return false; // retired-but-present kids overlap; unknown kid never falls back.
  try {
    if (!verify(null, Buffer.from(canonicalJson(envelope)), createPublicKey({ key: record.publicJwk, format: 'jwk' }), Buffer.from(signed.signature, 'base64url'))) return false;
  } catch { return false; }
  if (new Date(envelope.expiresAt) <= now || !Number.isFinite(new Date(envelope.expiresAt).getTime())) return false;
  return Object.entries(expected).every(([key, value]) => envelope[key as keyof LeaseV2Envelope] === value);
}

export type LeaseAckV2 = Readonly<{
  version: 2; leaseId: string; leaseDigest: string; deviceId: string; pepKeyId: string; surfaceEpoch: number; killEpoch: number; signature: string;
}>;
const ackPayload = (ack: Omit<LeaseAckV2, 'signature'>): string => `cowork-lease-ack-v2:${canonicalJson(ack)}`;

export function verifyLeaseAckV2(ack: LeaseAckV2, signed: SignedLeaseV2, pepPublicKey: string): boolean {
  if (ack.version !== 2 || ack.leaseId !== signed.envelope.leaseId || ack.leaseDigest !== leaseV2Digest(signed.envelope)) return false;
  if (ack.deviceId !== signed.envelope.targetDeviceId || ack.pepKeyId !== signed.envelope.targetPepKeyId || ack.killEpoch !== signed.envelope.killEpoch) return false;
  try {
    const { signature, ...unsigned } = ack;
    return verify(null, Buffer.from(ackPayload(unsigned)), createPublicKey({ key: Buffer.from(pepPublicKey, 'base64url'), format: 'der', type: 'spki' }), Buffer.from(signature, 'base64url'));
  } catch { return false; }
}

export type ProofChannel = 'poll' | 'sse' | 'wake' | 'ack' | 'result' | 'stop-status';
export type DevicePepProof = Readonly<{ channel: ProofChannel; deviceId: string; pepKeyId: string; challenge: string; signature: string }>;
export const devicePepProofPayload = (proof: Omit<DevicePepProof, 'signature'>): string => `cowork-device-pep-pop-v2:${canonicalJson(proof)}`;

export function verifyDevicePepProof(proof: DevicePepProof, expected: Omit<DevicePepProof, 'signature'>, pepPublicKey: string): boolean {
  if (proof.channel !== expected.channel || proof.deviceId !== expected.deviceId || proof.pepKeyId !== expected.pepKeyId || proof.challenge !== expected.challenge) return false;
  try {
    return verify(null, Buffer.from(devicePepProofPayload(expected)), createPublicKey({ key: Buffer.from(pepPublicKey, 'base64url'), format: 'der', type: 'spki' }), Buffer.from(proof.signature, 'base64url'));
  } catch { return false; }
}
