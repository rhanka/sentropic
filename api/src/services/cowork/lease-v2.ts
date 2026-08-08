import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

import { createJwksAdapter, type JwksAdapter } from '../auth/jwks-adapter';

export type LeaseV2Envelope = Readonly<{
  version: 2; kid: string; leaseId: string; invocationId: string; toolCallId: string; durableCallRef: string;
  principalId: string; tenantId: string; workspaceId: string; targetDeviceId: string; targetPepKeyId: string;
  capability: string; actionKind: string; actionDescriptorId: string; argumentDigest: string; requiredAuthority: string;
  scopeOrReceiptId: string | null; attestationProfileId: string; policyVersion: string; actionBudget: number;
  authorityEpoch: number; killEpoch: number; issuedAt: string; expiresAt: string; nonce: string;
}>;

export type SignedLeaseV2 = Readonly<{ envelope: LeaseV2Envelope; signature: string }>;
type ServerKey = Readonly<{ kid: string; privateKey: KeyObject; alg: string; crv: string }>;
type PublicKey = Readonly<{ kid: string; publicJwk: JsonWebKey; active: boolean; alg: string; crv: string; rotatedAt: Date | null }>;
export interface LeaseV2KeyPort { getActiveKey(): Promise<ServerKey | null>; findKeyByKid(kid: string): Promise<PublicKey | null>; }

export const MAX_LEASE_V2_TTL_MS = 60_000;
export const MAX_LEASE_V2_ISSUED_CLOCK_SKEW_MS = 5_000;
export const LEASE_V2_ROTATION_OVERLAP_MS = 120_000;

/** Reuses the LOCAL OAuth/OIDC signing-key port; no Cowork key is introduced. */
export function createServerLeaseV2KeyPort(jwks: Pick<JwksAdapter, 'getActiveKey' | 'findKeyByKid'> = createJwksAdapter()): LeaseV2KeyPort {
  return {
    async getActiveKey() {
      const key = await jwks.getActiveKey();
      return key?.privateKey && key.alg === 'EdDSA' && key.crv === 'Ed25519'
        ? { kid: key.kid, privateKey: key.privateKey, alg: key.alg, crv: key.crv }
        : null;
    },
    async findKeyByKid(kid) {
      const key = await jwks.findKeyByKid(kid);
      return key ? {
        kid: key.kid,
        publicJwk: key.publicJwk as JsonWebKey,
        active: key.active,
        alg: key.alg,
        crv: key.crv,
        rotatedAt: key.rotatedAt,
      } : null;
    },
  };
}

/** Stable JSON avoids signature ambiguity across rotation and language boundaries. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Lease payload contains a non-finite number.');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') throw new Error('Lease payload is not canonicalizable.');
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export const leaseV2Digest = (envelope: LeaseV2Envelope): string =>
  createHash('sha256').update(canonicalJson(envelope)).digest('base64url');

const leaseV2Keys = [
  'version', 'kid', 'leaseId', 'invocationId', 'toolCallId', 'durableCallRef', 'principalId', 'tenantId', 'workspaceId', 'targetDeviceId', 'targetPepKeyId',
  'capability', 'actionKind', 'actionDescriptorId', 'argumentDigest', 'requiredAuthority', 'scopeOrReceiptId', 'attestationProfileId', 'policyVersion', 'actionBudget',
  'authorityEpoch', 'killEpoch', 'issuedAt', 'expiresAt', 'nonce',
] as const;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const parseStrictTimestamp = (value: unknown): Date | null => {
  if (!isNonEmptyString(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
};

export function isValidLeaseV2Envelope(value: unknown, now = new Date()): value is LeaseV2Envelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  if (Object.keys(envelope).length !== leaseV2Keys.length || !leaseV2Keys.every((key) => Object.hasOwn(envelope, key))) return false;
  if (envelope.version !== 2 || !isNonEmptyString(envelope.kid)) return false;
  const stringFields = ['leaseId', 'invocationId', 'toolCallId', 'durableCallRef', 'principalId', 'tenantId', 'workspaceId', 'targetDeviceId', 'targetPepKeyId', 'capability', 'actionKind', 'actionDescriptorId', 'argumentDigest', 'requiredAuthority', 'attestationProfileId', 'policyVersion', 'nonce'];
  if (!stringFields.every((field) => isNonEmptyString(envelope[field]))) return false;
  if (envelope.scopeOrReceiptId !== null && !isNonEmptyString(envelope.scopeOrReceiptId)) return false;
  if (!isNonNegativeInteger(envelope.actionBudget) || envelope.actionBudget < 1 || !isNonNegativeInteger(envelope.authorityEpoch) || !isNonNegativeInteger(envelope.killEpoch)) return false;
  const issuedAt = parseStrictTimestamp(envelope.issuedAt);
  const expiresAt = parseStrictTimestamp(envelope.expiresAt);
  if (!issuedAt || !expiresAt || issuedAt.getTime() > now.getTime() + MAX_LEASE_V2_ISSUED_CLOCK_SKEW_MS || expiresAt <= issuedAt || expiresAt.getTime() - issuedAt.getTime() > MAX_LEASE_V2_TTL_MS) return false;
  return true;
}

function keyIsValidForLeaseVerification(key: PublicKey, now: Date): boolean {
  if (key.alg !== 'EdDSA' || key.crv !== 'Ed25519') return false;
  if (key.active) return true;
  if (!key.rotatedAt || !Number.isFinite(key.rotatedAt.getTime()) || key.rotatedAt > now) return false;
  return now.getTime() - key.rotatedAt.getTime() <= LEASE_V2_ROTATION_OVERLAP_MS;
}

export async function signLeaseV2(envelope: Omit<LeaseV2Envelope, 'version' | 'kid'>, keys: LeaseV2KeyPort, now = new Date()): Promise<SignedLeaseV2 | null> {
  const active = await keys.getActiveKey();
  if (!active) return null;
  const complete: LeaseV2Envelope = Object.freeze({ ...envelope, version: 2, kid: active.kid });
  if (!isValidLeaseV2Envelope(complete, now)) return null;
  return Object.freeze({ envelope: complete, signature: sign(null, Buffer.from(canonicalJson(complete)), active.privateKey).toString('base64url') });
}

export async function verifyLeaseV2(
  signed: SignedLeaseV2 | { envelope: { version?: unknown; kid?: unknown }; signature: string },
  keys: LeaseV2KeyPort,
  expected: Partial<Omit<LeaseV2Envelope, 'version' | 'kid'>> = {},
  now = new Date(),
): Promise<boolean> {
  const envelope = signed.envelope as LeaseV2Envelope;
  if (!isValidLeaseV2Envelope(envelope, now)) return false;
  const record = await keys.findKeyByKid(envelope.kid);
  if (!record || !keyIsValidForLeaseVerification(record, now)) return false;
  try {
    if (!verify(null, Buffer.from(canonicalJson(envelope)), createPublicKey({ key: record.publicJwk, format: 'jwk' }), Buffer.from(signed.signature, 'base64url'))) return false;
  } catch { return false; }
  if (new Date(envelope.expiresAt) <= now) return false;
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
export type DevicePepProof = Readonly<{
  channel: ProofChannel;
  deviceId: string;
  pepKeyId: string;
  challengeId: string;
  resourceId: string;
  method: string;
  expiresAt: string;
  deviceKillEpoch: number;
  signature: string;
}>;
export const devicePepProofPayload = (proof: Omit<DevicePepProof, 'signature'>): string => `cowork-device-pep-pop-v2:${canonicalJson(proof)}`;

export function verifyDevicePepProof(proof: DevicePepProof, expected: Omit<DevicePepProof, 'signature'>, pepPublicKey: string): boolean {
  if (proof.channel !== expected.channel || proof.deviceId !== expected.deviceId || proof.pepKeyId !== expected.pepKeyId || proof.challenge !== expected.challenge) return false;
  try {
    return verify(null, Buffer.from(devicePepProofPayload(expected)), createPublicKey({ key: Buffer.from(pepPublicKey, 'base64url'), format: 'der', type: 'spki' }), Buffer.from(proof.signature, 'base64url'));
  } catch { return false; }
}
