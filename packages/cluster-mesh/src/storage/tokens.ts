// K3 chain-boundary tokens and opaque identities (L3a v4.1 frozen §8.2).
// G3: readChainPage uses the HMAC exact-head boundary provider below.
// Cursors are self-contained opaque strings: [version, position, head, seq,
// allocation, incarnation, keyId, mac] base64url-encoded. Position, head,
// sequence, allocation, incarnation and key id travel in plaintext: the
// reader needs them to resolve the immutable boundary and to tell an
// unknown boundary (changed incarnation, retired or default key) apart from
// a broken seal. Every plaintext field is integrity-protected by the MAC:
// the seal is verified first, so an altered field breaks the seal
// (invalid-command) while a valid seal under a foreign incarnation or key
// reports unknown-boundary (incomplete). Head hashes stay readable in the token;
// comments retains hashes required by its contract without an anonymity
// claim (§5.1). Minting and verification are pure: a thousand-page
// traversal leaves no pins, no registry entries, no leases. Restart
// stability comes from the secret: two kernels sharing moduleId,
// incarnation and cursorSecret verify each other's cursors; without a
// configured secret each kernel mints with a fresh random key, so its
// cursors read as an unknown boundary after a restart (explicit
// `incomplete`, never `invalid-command`, never a redirect to the latest
// head). Tokens stay compact by construction (fixed-size MAC plus the
// caller-sized head), so the §8.2 oversized server-side recipe is not needed.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { StorageInvalidCommandError } from './errors.js';
import type { StorageScope } from './contracts.js';

export interface ChainCursor {
  readonly position: number;
  readonly head: string;
  readonly seq: number;
  readonly allocation: string;
}

/** The cursor is well-formed but bound to an incarnation or key this kernel
 * does not hold (§8.2 changed incarnation): the caller gets an explicit
 * unavailable/incomplete result, not an invalid-command refusal. */
export interface UnknownCursorBoundary {
  readonly unknownBoundary: true;
}

export const isUnknownCursorBoundary = (value: unknown): value is UnknownCursorBoundary =>
  typeof value === 'object' &&
  value !== null &&
  (value as { unknownBoundary?: unknown }).unknownBoundary === true;

export type CursorVerification = ChainCursor | UnknownCursorBoundary | null;

export interface ChainBoundaryRecord {
  readonly moduleId: string;
  readonly scope: StorageScope;
  readonly incarnation: string;
  readonly selection: string;
  readonly position: number;
  readonly head: string;
  readonly seq: number;
  readonly allocation: string;
}

export interface ChainBoundaryProvider {
  mint(record: ChainBoundaryRecord): string;
  verify(
    selection: string,
    cursor: unknown,
    opts: { readonly moduleId: string; readonly scope: StorageScope; readonly incarnation: string },
  ): CursorVerification;
}

const CURSOR_VERSION = 2;
const CURSOR_ORDERING = 'seq-asc';

/** G3 designated provider for readChainPage: exact head, sequence and
 * allocation, immutable. */
export class HmacExactHeadBoundaryProvider implements ChainBoundaryProvider {
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(secret?: string) {
    if (secret === undefined) {
      this.key = randomBytes(32);
      this.keyId = randomBytes(9).toString('base64url');
      return;
    }
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new StorageInvalidCommandError('cursor secret must be a non-empty string');
    }
    this.key = createHash('sha256').update(secret, 'utf8').digest();
    this.keyId = createHash('sha256').update(`k3-cursor-key-id-v1:${secret}`, 'utf8').digest().subarray(0, 9).toString('base64url');
  }

  private mac(
    moduleId: string,
    scope: StorageScope,
    incarnation: string,
    keyId: string,
    selection: string,
    position: number,
    head: string,
    seq: number,
    allocation: string,
  ): string {
    return createHmac('sha256', this.key)
      .update(
        JSON.stringify([
          'k3-cursor-v2',
          moduleId,
          scope.tenantId,
          scope.workspaceId,
          incarnation,
          keyId,
          selection,
          head,
          seq,
          allocation,
          CURSOR_ORDERING,
          position,
        ]),
        'utf8',
      )
      .digest()
      .subarray(0, 16)
      .toString('base64url');
  }

  mint(record: ChainBoundaryRecord): string {
    const tag = this.mac(
      record.moduleId,
      record.scope,
      record.incarnation,
      this.keyId,
      record.selection,
      record.position,
      record.head,
      record.seq,
      record.allocation,
    );
    return Buffer.from(
      JSON.stringify([
        CURSOR_VERSION,
        record.position,
        record.head,
        record.seq,
        record.allocation,
        record.incarnation,
        this.keyId,
        tag,
      ]),
      'utf8',
    ).toString('base64url');
  }

  verify(
    selection: string,
    cursor: unknown,
    opts: { readonly moduleId: string; readonly scope: StorageScope; readonly incarnation: string },
  ): CursorVerification {
    if (typeof cursor !== 'string' || cursor.length === 0) return null;
    let parts: unknown;
    try {
      parts = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!Array.isArray(parts) || parts.length !== 8) return null;
    const [version, position, head, seq, allocation, incarnation, keyId, tag] = parts as readonly unknown[];
    if (version !== CURSOR_VERSION) return null;
    if (!Number.isSafeInteger(position) || (position as number) < 0) return null;
    if (typeof head !== 'string' || head.length === 0) return null;
    if (!Number.isSafeInteger(seq) || (seq as number) < 0) return null;
    if (typeof allocation !== 'string' || allocation.length === 0) return null;
    if (typeof incarnation !== 'string' || incarnation.length === 0) return null;
    if (typeof keyId !== 'string' || keyId.length === 0) return null;
    if (typeof tag !== 'string' || tag.length === 0) return null;
    // Unknown key first: under a retired or foreign key the seal cannot be
    // checked, so the cursor is an unknown boundary (§8.2), not a break-in.
    if (keyId !== this.keyId) return { unknownBoundary: true };
    // Seal first, with the token-carried incarnation: any altered plaintext
    // field breaks the seal (null → invalid-command). Only a valid seal
    // under a foreign incarnation is an unknown boundary.
    const expected = this.mac(
      opts.moduleId,
      opts.scope,
      incarnation as string,
      this.keyId,
      selection,
      position as number,
      head as string,
      seq as number,
      allocation as string,
    );
    const actual = Buffer.from(tag, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
    if (incarnation !== opts.incarnation) return { unknownBoundary: true };
    return { position: position as number, head: head as string, seq: seq as number, allocation: allocation as string };
  }
}

/** Opaque kernel-issued identities (commit, event, operation). */
export const createOpaqueIssuer = (prefix: string): (() => string) => {
  let seq = 0;
  return () => `${prefix}-${(seq += 1)}`;
};

// The provider forges the cursors every handle reads: freezing the shared
// prototype closes the cross-module channel (O1, same realm limit as
// Sol-1), so replacing mint or verify throws instead of minting forged
// cursors inside a handle's scope.
Object.freeze(HmacExactHeadBoundaryProvider.prototype);
