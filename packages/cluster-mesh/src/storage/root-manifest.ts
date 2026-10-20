import { createHash } from 'node:crypto';
import type { BackendScopeState } from './backend.js';
import { StorageDeniedError, StorageInvalidCommandError } from './errors.js';
import { buildManifest, digestManifest, type ExportManifest, type ManifestChainHead } from './manifest.js';
import { readPageFromScope, type ReadPageResult } from './record-runtime.js';
import type { ScopedRuntime } from './scope-runtime.js';
import { ownedCopy, type StagedCore } from './staged-core.js';
import { stagedLimits } from './staged-operations.js';
import { isUnknownCursorBoundary } from './tokens.js';
import { encodeStagedCommitRoot } from './staged-codec.js';

interface CapturedManifest { readonly root: BackendScopeState; readonly ownerId: string; readonly manifest: ExportManifest; }
const registry = (core: StagedCore, bound: ScopedRuntime) => core.backend.controlState(bound.scope, 'root-manifests-v1', () => new Map<string, CapturedManifest>());
export interface RootManifestRequest { readonly selections: readonly string[]; readonly operationKeys?: readonly string[]; }
export const captureManifestRoot = (core: StagedCore, bound: ScopedRuntime, input: RootManifestRequest) => {
  bound.requireOperation('read');
  const limits = stagedLimits(core);
  if (!Array.isArray(input.selections) || !input.selections.length || input.selections.length > limits.maxRecords ||
    (input.operationKeys?.length ?? 0) > limits.maxRecords || Buffer.byteLength(JSON.stringify(input), 'utf8') > limits.maxEncodedBytes) {
    throw new StorageInvalidCommandError('manifest selection exceeds declared limits');
  }
  const root = core.current(bound.scope);
  const heads: Record<string, ManifestChainHead> = Object.create(null) as Record<string, ManifestChainHead>;
  for (const key of input.selections) {
    if (!core.accessible(root, key)) throw new StorageDeniedError('manifest selection is inaccessible');
    const chain = root.chains.get(key);
    if (!chain?.head) throw new StorageInvalidCommandError('manifest selection has no committed head');
    heads[key] = { head: chain.head, allocation: chain.allocation, terminalSeq: String(chain.records.length - 1) };
  }
  const unitRoots = (input.operationKeys ?? []).map((key) => {
    const committed = core.data(root).unitRoots.get(key);
    if (!committed) throw new StorageInvalidCommandError('manifest operation has no committed unit root');
    return createHash('sha256').update(encodeStagedCommitRoot(committed)).digest('hex');
  });
  const manifest = buildManifest({ scope: bound.scope, selections: input.selections, heads, unitRoots,
    descriptorVersion: core.options.descriptor?.contractVersion ?? 'storage-v1', encodingVersion: 'storage-canonical-v1',
    storeIncarnation: core.kernel.incarnation, rootVersion: root.version ?? '0', terminal: { count: String(new Set(input.selections).size), complete: true },
  });
  const digest = digestManifest(manifest);
  registry(core, bound).set(JSON.stringify([bound.grant.principalId, digest]), { root, ownerId: bound.grant.principalId, manifest: ownedCopy(manifest) });
  return { digest, manifest: ownedCopy(manifest) };
};
const retained = (core: StagedCore, bound: ScopedRuntime, digest: string): CapturedManifest => {
  bound.requireOperation('read');
  const captured = registry(core, bound).get(JSON.stringify([bound.grant.principalId, digest]));
  if (!captured) throw new StorageInvalidCommandError('unknown retained storage manifest');
  if (captured.ownerId !== bound.grant.principalId) throw new StorageDeniedError('manifest belongs to another principal');
  return captured;
};
export const verifyManifestRoot = (core: StagedCore, bound: ScopedRuntime, digest: string): ExportManifest => {
  const captured = retained(core, bound, digest);
  const current = core.current(bound.scope);
  if (captured.manifest.selections.some((key) => !core.accessible(current, key))) throw new StorageDeniedError('retained selection is now inaccessible');
  return ownedCopy(captured.manifest);
};
export const readManifestRootPage = (core: StagedCore, bound: ScopedRuntime, digest: string, chainId: string, limit: number, cursor: unknown, bytes: number): ReadPageResult => {
  const captured = retained(core, bound, digest);
  const head = captured.manifest.heads[chainId];
  if (!head || !Object.hasOwn(captured.manifest.heads, chainId)) throw new StorageInvalidCommandError('chain is outside the retained selection');
  const maximum = stagedLimits(core);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > maximum.maxEncodedBytes || limit > maximum.maxRecords) throw new StorageInvalidCommandError('retained page exceeds limits');
  if (!core.accessible(core.current(bound.scope), chainId)) return { outcome: 'inaccessible', records: [], nextCursor: null };
  const binding = { moduleId: core.kernel.moduleId, scope: bound.scope, incarnation: core.kernel.incarnation, provider: core.boundaryProvider };
  if (cursor !== null && cursor !== undefined) {
    const verified = core.boundaryProvider.verify(chainId, cursor, binding);
    if (verified === null) throw new StorageInvalidCommandError('invalid retained cursor');
    if (isUnknownCursorBoundary(verified)) return { outcome: 'incomplete', records: [], nextCursor: null };
    if (verified.head !== head.head || verified.allocation !== head.allocation || String(verified.seq) !== head.terminalSeq) throw new StorageInvalidCommandError('cursor belongs to another retained head');
  }
  return readPageFromScope(captured.root, chainId, limit, cursor, bytes, binding);
};
