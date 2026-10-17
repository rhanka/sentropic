import { createHash } from 'node:crypto';
import type { ScopeGrant } from '../authority.js';
import type { RootManifestRequest } from '../root-manifest.js';
import { buildManifest, digestManifest, type ExportManifest, type ManifestChainHead } from '../manifest.js';
import { encodeStagedCommitRoot } from '../staged-codec.js';
import type { StagedCommitRoot } from '../staged-units.js';
import { StorageDeniedError, StorageInvalidCommandError } from '../errors.js';
import { isUnknownCursorBoundary } from '../tokens.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
import type { PgChain } from './effects.js';
import { ownPgValue } from './ordinary-transactions.js';
import { readPgBoundary, retainPgBoundary } from './queries.js';
import { readPgPage } from './readers.js';
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const token = (grant: ScopeGrant<unknown>, digest: string) => `manifest:${hash(grant.principalId)}:${digest}`;
const retained = async (core: PgCore, session: PgSession, grant: ScopeGrant<unknown>, digest: string) => {
  await core.check(session, grant, 'read');
  const captured = await readPgBoundary(core, session, grant, token(grant, digest));
  const manifest = captured.metadata.manifest as ExportManifest;
  if (captured.metadata.kind !== 'manifest' || digestManifest(manifest) !== digest) throw new StorageInvalidCommandError('retained manifest binding differs');
  return { captured, manifest };
};
export const capturePgManifest = async (core: PgCore, grant: ScopeGrant<unknown>, supplied: RootManifestRequest) => {
  const input = ownPgValue(supplied); const limits = core.work();
  if (!Array.isArray(input.selections) || input.selections.length === 0 || input.selections.length > limits.maxRecords || (input.operationKeys?.length ?? 0) > limits.maxRecords || Buffer.byteLength(JSON.stringify(input), 'utf8') > limits.maxEncodedBytes) throw new StorageInvalidCommandError('manifest selection exceeds admission limits');
  return core.tx.run(false, async (session) => {
    await core.check(session, grant, 'read'); const base = await core.roots.capture(session, grant.scope);
    const heads: Record<string, ManifestChainHead> = Object.create(null) as Record<string, ManifestChainHead>;
    for (const selection of input.selections) {
      await core.visible(session, base.root, selection);
      const chain = await core.roots.get<PgChain>(session, base.root, 'chain', selection);
      if (!chain?.head) throw new StorageInvalidCommandError('manifest selection has no committed head');
      heads[selection] = { head: chain.head, allocation: chain.allocation, terminalSeq: String(chain.count - 1) };
    }
    const unitRoots: string[] = [];
    for (const key of input.operationKeys ?? []) {
      const committed = await core.roots.get<StagedCommitRoot>(session, base.root, 'unit-root', key);
      if (!committed) throw new StorageInvalidCommandError('manifest operation is not committed');
      unitRoots.push(hash(encodeStagedCommitRoot(committed)));
    }
    const manifest = buildManifest({ scope: grant.scope, selections: input.selections, heads, unitRoots, descriptorVersion: core.options.descriptor?.contractVersion ?? 'storage-v1', encodingVersion: 'storage-canonical-v1', storeIncarnation: core.incarnation, rootVersion: base.version,
      terminal: { count: String(new Set(input.selections).size), complete: true } });
    const digest = digestManifest(manifest);
    await retainPgBoundary(core, session, grant, base, { kind: 'manifest', manifest }, token(grant, digest));
    const previous = await retained(core, session, grant, digest);
    if (previous.captured.root !== base.root || previous.captured.version !== base.version) throw new StorageInvalidCommandError('manifest identity collision');
    return { digest, manifest: ownPgValue(manifest) };
  });
};
export const verifyPgManifest = async (core: PgCore, grant: ScopeGrant<unknown>, digest: string): Promise<ExportManifest> => core.tx.run(false, async (session) => {
  const { manifest } = await retained(core, session, grant, digest); const current = await core.roots.capture(session, grant.scope);
  for (const selection of manifest.selections) await core.visible(session, current.root, selection);
  return ownPgValue(manifest);
});
export const readPgManifestPage = async (core: PgCore, grant: ScopeGrant<unknown>, digest: string, chainId: string, limit: number, cursor: unknown, bytes: number) => core.tx.run(false, async (session) => {
  if (limit > core.work().maxRecords || bytes > core.work().maxEncodedBytes) throw new StorageInvalidCommandError('retained page exceeds declared limits');
  const { manifest, captured } = await retained(core, session, grant, digest);
  if (!Object.hasOwn(manifest.heads, chainId)) throw new StorageInvalidCommandError('chain is outside retained selection');
  const current = await core.roots.capture(session, grant.scope);
  try { await core.visible(session, current.root, chainId); }
  catch (error) { if (error instanceof StorageDeniedError) return { outcome: 'inaccessible' as const, records: [], nextCursor: null }; throw error; }
  if (cursor != null) {
    const verified = core.provider.verify(chainId, cursor, { moduleId: core.options.moduleId, scope: grant.scope, incarnation: core.incarnation });
    if (verified === null) throw new StorageInvalidCommandError('invalid retained cursor');
    if (isUnknownCursorBoundary(verified)) return { outcome: 'incomplete' as const, records: [], nextCursor: null };
    const head = manifest.heads[chainId]!;
    if (head.head !== verified.head || head.allocation !== verified.allocation || head.terminalSeq !== String(verified.seq)) throw new StorageInvalidCommandError('cursor belongs to another retained head');
  }
  return readPgPage(core, session, grant, captured.root, chainId, limit, cursor, bytes);
});
