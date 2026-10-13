// K3 chain-boundary tokens and opaque identities (L3a v4.1 frozen §8.2).
// G3: readChainPage uses the retained exact-head boundary provider below.
// A server-side retained recipe replaces an oversized self-contained
// boundary: cursors stay byte-identical to the K2a shape
// ({position, head}) while module, scope, incarnation and selection stay
// bound in the registry. Unknown, tampered or cross-chain cursors were
// never issued for that selection and verify as null.

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
  mint(record: ChainBoundaryRecord): ChainCursor;
  verify(
    selection: string,
    cursor: unknown,
    opts: { readonly moduleId: string; readonly scope: StorageScope; readonly incarnation: string },
  ): ChainCursor | null;
}

/** G3 designated provider for readChainPage: exact head, immutable. */
export class RetainedExactHeadBoundaryProvider implements ChainBoundaryProvider {
  private readonly issued = new Set<string>();

  private static key(
    moduleId: string,
    scope: StorageScope,
    incarnation: string,
    selection: string,
    position: number,
    head: string,
  ): string {
    return JSON.stringify([moduleId, scope.tenantId, scope.workspaceId, incarnation, selection, position, head]);
  }

  mint(record: ChainBoundaryRecord): ChainCursor {
    this.issued.add(
      RetainedExactHeadBoundaryProvider.key(
        record.moduleId,
        record.scope,
        record.incarnation,
        record.selection,
        record.position,
        record.head,
      ),
    );
    return { position: record.position, head: record.head };
  }

  verify(
    selection: string,
    cursor: unknown,
    opts: { readonly moduleId: string; readonly scope: StorageScope; readonly incarnation: string },
  ): ChainCursor | null {
    if (typeof cursor !== 'object' || cursor === null) return null;
    const candidate = cursor as { readonly position?: unknown; readonly head?: unknown };
    if (!Number.isSafeInteger(candidate.position) || (candidate.position as number) < 0) return null;
    if (typeof candidate.head !== 'string' || candidate.head.length === 0) return null;
    const position = candidate.position as number;
    const head = candidate.head;
    const key = RetainedExactHeadBoundaryProvider.key(opts.moduleId, opts.scope, opts.incarnation, selection, position, head);
    if (!this.issued.has(key)) return null;
    return { position, head };
  }
}

/** Opaque kernel-issued identities (commit, event, operation). */
export const createOpaqueIssuer = (prefix: string): (() => string) => {
  let seq = 0;
  return () => `${prefix}-${(seq += 1)}`;
};
