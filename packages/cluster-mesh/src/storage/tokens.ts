// K3 chain-boundary tokens and opaque identities (L3a v4.1 frozen §8.2).
// G3: readChainPage uses the HMAC exact-head boundary provider below.
// Cursors are self-contained opaque strings: [version, position, head, mac]
// base64url-encoded. Module, scope, incarnation, selection, ordering and the
// exact head travel inside the MAC, never in the token, so verification binds
// every field server-side and any alteration fails closed. Minting and
// verification are pure: a thousand-page traversal leaves no pins, no
// registry entries, no leases. Restart stability comes from the secret: two
// kernels sharing moduleId, incarnation and cursorSecret verify each other's
// cursors; without a configured secret each kernel mints with a fresh random
// key. Tokens stay compact by construction (fixed-size MAC plus the
// caller-sized head), so the §8.2 oversized server-side recipe is not needed.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { StorageInvalidCommandError } from './errors.js';
import type { StorageScope } from './contracts.js';

export interface ChainCursor {
  readonly position: number;
  readonly head: string;
}

export interface ChainBoundaryRecord {
  readonly moduleId: string;
  readonly scope: StorageScope;
  readonly incarnation: string;
  readonly selection: string;
  readonly position: number;
  readonly head: string;
}

export interface ChainBoundaryProvider {
  mint(record: ChainBoundaryRecord): string;
  verify(
    selection: string,
    cursor: unknown,
    opts: { readonly moduleId: string; readonly scope: StorageScope; readonly incarnation: string },
  ): ChainCursor | null;
}

const CURSOR_VERSION = 1;
const CURSOR_ORDERING = 'seq-asc';

/** G3 designated provider for readChainPage: exact head, immutable. */
export class HmacExactHeadBoundaryProvider implements ChainBoundaryProvider {
  private readonly key: Buffer;

  constructor(secret?: string) {
    if (secret === undefined) {
      this.key = randomBytes(32);
      return;
    }
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new StorageInvalidCommandError('cursor secret must be a non-empty string');
    }
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }

  private mac(
    moduleId: string,
    scope: StorageScope,
    incarnation: string,
    selection: string,
    position: number,
    head: string,
  ): string {
    return createHmac('sha256', this.key)
      .update(
        JSON.stringify([
          'k3-cursor-v1',
          moduleId,
          scope.tenantId,
          scope.workspaceId,
          incarnation,
          selection,
          head,
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
      record.selection,
      record.position,
      record.head,
    );
    return Buffer.from(JSON.stringify([CURSOR_VERSION, record.position, record.head, tag]), 'utf8').toString(
      'base64url',
    );
  }

  verify(
    selection: string,
    cursor: unknown,
    opts: { readonly moduleId: string; readonly scope: StorageScope; readonly incarnation: string },
  ): ChainCursor | null {
    if (typeof cursor !== 'string' || cursor.length === 0) return null;
    let parts: unknown;
    try {
      parts = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!Array.isArray(parts) || parts.length !== 4) return null;
    const [version, position, head, tag] = parts as readonly unknown[];
    if (version !== CURSOR_VERSION) return null;
    if (!Number.isSafeInteger(position) || (position as number) < 0) return null;
    if (typeof head !== 'string' || head.length === 0) return null;
    if (typeof tag !== 'string' || tag.length === 0) return null;
    const expected = this.mac(opts.moduleId, opts.scope, opts.incarnation, selection, position as number, head);
    const actual = Buffer.from(tag, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
    return { position: position as number, head };
  }
}

/** Opaque kernel-issued identities (commit, event, operation). */
export const createOpaqueIssuer = (prefix: string): (() => string) => {
  let seq = 0;
  return () => `${prefix}-${(seq += 1)}`;
};
