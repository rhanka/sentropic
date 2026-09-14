import { Buffer } from 'node:buffer';
import type { SignedCustodyToken } from './custody-types.js';

const TOKEN_KEYS = [
  'action', 'audience', 'custodyId', 'epoch', 'evidence', 'expiresAt',
  'holderPrincipalId', 'invocationId', 'issuedAt', 'issuer', 'kind',
  'registrationId', 'tokenId', 'version',
] as const;
const ISSUER_KEYS = ['algorithm', 'curve', 'issuerId', 'keyId'] as const;
const EVIDENCE_KEYS = ['canonicalization', 'kind', 'signatureBase64Url'] as const;
const actions = new Set(['drive', 'wake', 'relaunch']);
const base64Url = /^[A-Za-z0-9_-]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && expected.every((key, index) => actual[index] === key);
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export function canonicalCustodyJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('custody canonical JSON requires finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalCustodyJson(entry)).join(',')}]`;
  }
  if (!isRecord(value)) throw new TypeError('custody canonical JSON requires plain JSON values');
  const fields = Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) throw new TypeError('custody canonical JSON rejects undefined');
    return `${JSON.stringify(key)}:${canonicalCustodyJson(value[key])}`;
  });
  return `{${fields.join(',')}}`;
}

export function isSignedCustodyToken(value: unknown): value is SignedCustodyToken {
  if (!isRecord(value) || !hasExactKeys(value, TOKEN_KEYS)) return false;
  if (!isRecord(value.issuer) || !hasExactKeys(value.issuer, ISSUER_KEYS)) return false;
  if (!isRecord(value.evidence) || !hasExactKeys(value.evidence, EVIDENCE_KEYS)) return false;
  const issuer = value.issuer;
  const evidence = value.evidence;
  return value.kind === 'signed-custody-token'
    && value.version === 'sentropic.cluster-mesh.custody/v1'
    && isNonEmptyString(value.tokenId)
    && isNonEmptyString(issuer.issuerId)
    && isNonEmptyString(issuer.keyId)
    && issuer.algorithm === 'EdDSA'
    && issuer.curve === 'Ed25519'
    && isNonEmptyString(value.audience)
    && isNonEmptyString(value.registrationId)
    && typeof value.action === 'string' && actions.has(value.action)
    && isNonEmptyString(value.holderPrincipalId)
    && typeof value.epoch === 'number' && Number.isInteger(value.epoch) && value.epoch >= 0
    && isNonEmptyString(value.custodyId)
    && isNonEmptyString(value.invocationId)
    && isNonEmptyString(value.issuedAt)
    && isNonEmptyString(value.expiresAt)
    && evidence.kind === 'detached-signature'
    && evidence.canonicalization === 'sentropic-json-v1'
    && isNonEmptyString(evidence.signatureBase64Url)
    && base64Url.test(evidence.signatureBase64Url);
}

export function custodySignaturePayload(token: SignedCustodyToken): Uint8Array {
  const { signatureBase64Url: _signature, ...evidence } = token.evidence;
  return new TextEncoder().encode(canonicalCustodyJson({ ...token, evidence }));
}

export function encodeCustodyToken(token: SignedCustodyToken): string {
  if (!isSignedCustodyToken(token)) throw new TypeError('invalid signed custody token');
  return Buffer.from(canonicalCustodyJson(token), 'utf8').toString('base64url');
}

export function decodeCustodyToken(value: string): SignedCustodyToken {
  if (!value || !base64Url.test(value) || value.length % 4 === 1) {
    throw new TypeError('invalid custody token base64url');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new TypeError('non-canonical custody token base64url');
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError('invalid custody token UTF-8');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TypeError('invalid custody token JSON');
  }
  if (!isSignedCustodyToken(parsed) || canonicalCustodyJson(parsed) !== json) {
    throw new TypeError('non-canonical custody token shape');
  }
  return parsed;
}
