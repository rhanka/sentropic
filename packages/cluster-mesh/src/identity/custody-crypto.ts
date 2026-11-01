// A2.0b custody cryptography: caller-borrowed buffers, owned temporaries and
// fixed encodings. `IdentityDigestPortV1`, ticket and login ports borrow the
// caller's Uint8Array inputs: they copy what they need, dispose their own
// temporaries in `finally`, and never retain or zero the caller's buffer.
// The caller owns disposal after the awaited operation.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';
import type {
  IdentityDigestPortV1,
  IdentityEmailTicketClaimsV1,
  IdentityEmailTicketTokenPortV1,
  IdentitySha256HexV1,
} from '../identity-contracts/custody.js';
import { canonicalBindingEmailV1 } from '../identity-contracts/custody.js';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const isSha256HexV1 = (value: string): boolean => SHA256_HEX.test(value);

export const isCanonicalBase64UrlV1 = (value: string): boolean => {
  if (value.length === 0 || !BASE64URL.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.toString('base64url') === value;
  } catch {
    return false;
  }
};

/** Overwrites every byte of an owned mutable buffer. Strings are immutable
 * and are never passed here; callers keep binary material in Uint8Array. */
export const zeroizeV1 = (buffer: Uint8Array): void => {
  buffer.fill(0);
};

const copyBorrowed = (value: Uint8Array): Uint8Array => Uint8Array.from(value);

const sha256HexOfOwned = (owned: Uint8Array): IdentitySha256HexV1 => {
  try {
    return createHash('sha256').update(owned).digest('hex');
  } finally {
    zeroizeV1(owned);
  }
};

const hmacHexOfOwned = (key: Uint8Array, owned: Uint8Array): IdentitySha256HexV1 => {
  try {
    return createHmac('sha256', Buffer.from(key)).update(owned).digest('hex');
  } finally {
    zeroizeV1(owned);
  }
};

export const hashUtf8Borrowed = async (value: Uint8Array): Promise<IdentitySha256HexV1> =>
  sha256HexOfOwned(copyBorrowed(value));

/** Exact email-code keyed preimage: HMAC-SHA256(keyRef,
 * UTF8(JSON.stringify(["cm-email-code","1",canonicalEmail,code]))). */
export const emailCodePreimageV1 = (canonicalEmail: string, code: string): Uint8Array =>
  Buffer.from(JSON.stringify(['cm-email-code', '1', canonicalEmail, code]), 'utf8');

export interface StaticDigestKeyRing {
  readonly keys: Readonly<Record<string, Uint8Array>>;
}

/** Test/production adapter factory: keys stay with the custodian; the port
 * borrows them per call and never exposes them. */
export const createNodeIdentityDigestPort = (keys: Readonly<Record<string, Uint8Array>> = {}): IdentityDigestPortV1 => ({
  sha256: async (value) => hashUtf8Borrowed(value),
  hmacSha256: async (keyRef, value) => {
    const key = keys[keyRef];
    if (!key) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
    return hmacHexOfOwned(copyBorrowed(key), copyBorrowed(value));
  },
  equal: (left, right) => {
    if (left.byteLength !== right.byteLength) return false;
    if (left.byteLength === 0) return true;
    return timingSafeEqual(Buffer.from(left), Buffer.from(right));
  },
});

/** Asserts canonical binding form; rejects anything the adapters must not
 * silently normalize. */
export const assertCanonicalEmailV1 = (email: string): string => {
  if (email !== canonicalBindingEmailV1(email) || email.length === 0 || !email.includes('@')) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
  return email;
};

const INVITATION_PREFIX = 'sit_';

export interface IssuedTokenMaterial {
  readonly token: string;
  /** Owned mutable bytes; the caller must zeroize after hashing. */
  readonly material: Uint8Array;
}

/** Issues a high-entropy `sit_` token; only its SHA-256 digest is stored. */
export const issueInvitationTokenV1 = (byteLength = 32): IssuedTokenMaterial => {
  const material = randomBytes(byteLength);
  const token = `${INVITATION_PREFIX}${material.toString('base64url')}`;
  return { token, material: new Uint8Array(material.buffer, material.byteOffset, material.byteLength) };
};

export const hashPresentedTokenV1 = (token: string): IdentitySha256HexV1 => {
  const owned = Buffer.from(token, 'utf8');
  try {
    return createHash('sha256').update(owned).digest('hex');
  } finally {
    zeroizeV1(owned);
  }
};

/** Issues opaque session material: the caller hashes both parts and stores
 * only digests. The returned `material` buffers are caller-owned. */
export const issueSessionTokenMaterialV1 = (): { readonly session: IssuedTokenMaterial; readonly refresh: IssuedTokenMaterial } => ({
  session: issueInvitationTokenV1(32),
  refresh: issueInvitationTokenV1(32),
});

const base64UrlJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const signHs256 = (secret: Uint8Array, parts: string): string => {
  const owned = Buffer.from(parts, 'utf8');
  try {
    const signature = createHmac('sha256', Buffer.from(secret)).update(owned).digest();
    return `${parts}.${signature.toString('base64url')}`;
  } finally {
    zeroizeV1(owned);
  }
};

const verifyHs256 = (secret: Uint8Array, token: Uint8Array): { readonly header: unknown; readonly payload: unknown } => {
  const text = Buffer.from(token).toString('utf8');
  const dot = text.lastIndexOf('.');
  if (dot < 0) throw new IdentityCustodyErrorV1('identity_material_invalid');
  const parts = text.slice(0, dot);
  const owned = Buffer.from(parts, 'utf8');
  try {
    const expected = createHmac('sha256', Buffer.from(secret)).update(owned).digest();
    const presented = Buffer.from(text.slice(dot + 1), 'base64url');
    if (presented.byteLength !== expected.byteLength || !timingSafeEqual(presented, expected)) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    return {
      header: JSON.parse(Buffer.from(parts.split('.')[0], 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(parts.split('.')[1], 'base64url').toString('utf8')),
    };
  } finally {
    zeroizeV1(owned);
  }
};

/** HS256 email-ticket continuation port. The source ticket has no issuer
 * claim; neither verification nor import requires or fabricates one. */
export const createHs256EmailTicketPort = (secret: Uint8Array): IdentityEmailTicketTokenPortV1 => {
  const checkClaims = (payload: unknown): IdentityEmailTicketClaimsV1 => {
    if (typeof payload !== 'object' || payload === null) throw new IdentityCustodyErrorV1('identity_material_invalid');
    const claims = payload as Record<string, unknown>;
    if (
      typeof claims.codeProofId !== 'string' ||
      typeof claims.email !== 'string' ||
      typeof claims.issuedAt !== 'string' ||
      typeof claims.expiresAt !== 'string'
    ) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    return {
      codeProofId: claims.codeProofId,
      email: claims.email,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
    };
  };
  return {
    sign: async (claims) => signHs256(secret, `${base64UrlJson({ alg: 'HS256', typ: 'JWT' })}.${base64UrlJson(claims)}`),
    verify: async (token, now) => {
      const { payload } = verifyHs256(secret, token);
      const claims = checkClaims(payload);
      if (!(claims.expiresAt > now)) throw new IdentityCustodyErrorV1('identity_material_invalid');
      return claims;
    },
    verifyForImport: async (token) => checkClaims(verifyHs256(secret, token).payload),
  };
};
