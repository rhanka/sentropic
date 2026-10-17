// K4 canonical export manifest (L3a v4.1 frozen §11.5): a versioned digest
// over scope, normalized selections, chain heads, committed unit/group
// roots and descriptor/encoding versions. A server-established retained
// registry binds digests to real storage; an arbitrary digest with no
// retained boundary cannot open a snapshot. No pg, no drizzle, no engram.

import { createHash } from 'node:crypto';
import { StorageInvalidCommandError } from './errors.js';
import {
  isDecimalCounter,
  isNonEmptyString,
  validateStorageScope,
  type StorageScope,
} from './contracts.js';

export const EXPORT_MANIFEST_VERSION = 'export-manifest-v1';

export interface ManifestChainHead {
  readonly head: string;
  readonly allocation: string;
  readonly terminalSeq?: string;
}

export interface ManifestTerminal {
  readonly count: string;
  readonly complete: boolean;
}

export interface ExportManifest {
  readonly version: typeof EXPORT_MANIFEST_VERSION;
  readonly scope: StorageScope;
  readonly selections: readonly string[];
  readonly heads: Readonly<Record<string, ManifestChainHead>>;
  readonly unitRoots: readonly string[];
  readonly descriptorVersion: string;
  readonly encodingVersion: string;
  readonly terminal: ManifestTerminal;
}

export interface ManifestBuildInput {
  readonly scope: StorageScope;
  readonly selections: readonly string[];
  readonly heads: Readonly<Record<string, ManifestChainHead>>;
  readonly unitRoots: readonly string[];
  readonly descriptorVersion: string;
  readonly encodingVersion: string;
  readonly terminal: ManifestTerminal;
}

/**
 * Build a canonical manifest. Selections are normalized (sorted, deduped);
 * every selection binds exactly one head, a complete terminal binds the
 * exact selection count, and a truncated terminal export is rejected.
 */
export const buildManifest = (input: ManifestBuildInput): ExportManifest => {
  const scope = validateStorageScope(input.scope);
  if (!scope.ok) throw new StorageInvalidCommandError(scope.errors.join('; '));
  const selections = [...new Set(input.selections)].sort();
  if (selections.length === 0) throw new StorageInvalidCommandError('manifest requires at least one selection');
  for (const selection of selections) {
    if (!isNonEmptyString(selection)) throw new StorageInvalidCommandError('manifest selections must be non-empty');
    const bound = input.heads[selection];
    if (!bound || !isNonEmptyString(bound.head)) {
      throw new StorageInvalidCommandError(`manifest selection lacks a head: ${selection}`);
    }
    if (!isDecimalCounter(bound.allocation)) {
      throw new StorageInvalidCommandError(`manifest head lacks a decimal allocation: ${selection}`);
    }
    if (bound.terminalSeq !== undefined && !isDecimalCounter(bound.terminalSeq)) throw new StorageInvalidCommandError('manifest terminal sequence must be decimal');
  }
  for (const key of Object.keys(input.heads)) {
    if (!selections.includes(key)) throw new StorageInvalidCommandError(`manifest head outside selections: ${key}`);
  }
  for (const root of input.unitRoots) {
    if (!isNonEmptyString(root)) throw new StorageInvalidCommandError('manifest unit roots must be non-empty');
  }
  if (!isNonEmptyString(input.descriptorVersion)) {
    throw new StorageInvalidCommandError('manifest requires a descriptorVersion');
  }
  if (!isNonEmptyString(input.encodingVersion)) {
    throw new StorageInvalidCommandError('manifest requires an encodingVersion');
  }
  if (!isDecimalCounter(input.terminal.count)) {
    throw new StorageInvalidCommandError('manifest terminal requires a decimal count');
  }
  if (typeof input.terminal.complete !== 'boolean') throw new StorageInvalidCommandError('manifest terminal completeness must be boolean');
  if (input.terminal.complete && input.terminal.count !== String(selections.length)) {
    throw new StorageInvalidCommandError('a terminal fragment binds its exact count');
  }
  return {
    version: EXPORT_MANIFEST_VERSION,
    scope: { tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId },
    selections,
    heads: Object.fromEntries(selections.map((selection) => [selection, { ...input.heads[selection] }])),
    unitRoots: [...input.unitRoots],
    descriptorVersion: input.descriptorVersion,
    encodingVersion: input.encodingVersion,
    terminal: { ...input.terminal },
  };
};

/** Canonical encoding of a manifest for digesting. */
export const canonicalManifestEncoding = (manifest: ExportManifest): string =>
  JSON.stringify([
    'storage-export-manifest',
    manifest.version,
    [manifest.scope.tenantId, manifest.scope.workspaceId],
    ['selections', manifest.selections.map((selection) => [
      selection,
      manifest.heads[selection].head,
      manifest.heads[selection].allocation,
      manifest.heads[selection].terminalSeq ?? null,
    ])],
    ['unit-roots', manifest.unitRoots],
    ['descriptor', manifest.descriptorVersion],
    ['encoding', manifest.encodingVersion],
    ['terminal', manifest.terminal.count, manifest.terminal.complete],
  ]);

/** Digest binding a manifest to its canonical bytes. */
export const digestManifest = (manifest: ExportManifest): string =>
  createHash('sha256').update(canonicalManifestEncoding(manifest), 'utf8').digest('hex');

const frozenCopy = (manifest: ExportManifest): ExportManifest =>
  Object.freeze({
    ...manifest,
    scope: Object.freeze({ ...manifest.scope }),
    selections: Object.freeze([...manifest.selections]),
    heads: Object.freeze(Object.fromEntries(Object.entries(manifest.heads).map(([key, head]) => [key, Object.freeze({ ...head })]))),
    unitRoots: Object.freeze([...manifest.unitRoots]),
    terminal: Object.freeze({ ...manifest.terminal }),
  }) as ExportManifest;

/** Trusted manifest value registry. Storage-bound retention is performed by
 * the scoped root port; retaining a value alone grants no storage access. */
export class ManifestRegistry {
  private readonly retained = new Map<string, ExportManifest>();

  /** Retain a deeply owned manifest value under its structural digest. */
  retain(manifest: ExportManifest): string {
    if (manifest.version !== EXPORT_MANIFEST_VERSION) {
      throw new StorageInvalidCommandError('unknown manifest version');
    }
    const rebuilt = buildManifest(manifest);
    const digest = digestManifest(rebuilt);
    this.retained.set(digest, frozenCopy(rebuilt));
    return digest;
  }

  /** Reopen a retained boundary under its digest. Unknown digests are refused. */
  verify(digest: string): ExportManifest {
    const stored = this.retained.get(digest);
    if (!stored) throw new StorageInvalidCommandError('unknown manifest digest');
    return stored;
  }

  /** Reject a manifest that no longer matches its digest (changed mapping). */
  verifyAgainst(manifest: ExportManifest, digest: string): void {
    if (digestManifest(manifest) !== digest) {
      throw new StorageInvalidCommandError('manifest digest mismatch');
    }
    if (!this.retained.has(digest)) throw new StorageInvalidCommandError('unknown manifest digest');
  }
}
