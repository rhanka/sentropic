import type { ScopeGrant } from '../authority.js';
import { StorageDeniedError, StorageInvalidCommandError } from '../errors.js';
import type { ReadPage } from '../readers.js';
import type { EncodedValue, PageLimits } from '../contracts.js';
import { isUnknownCursorBoundary } from '../tokens.js';
import type { PgCore, PgTx } from './core.js';
import type { PgSession } from './protocol.js';
import { chainRecordKey, type PgChain, type PgChainRef, type PgRecordRef } from './effects.js';
import { decodePgJson, decodePgUtf8 } from './codec.js';
const pageSize = (page: ReadPage): number => Buffer.byteLength(JSON.stringify(page), 'utf8');
export const readPgPage = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  root: string | null,
  chainId: string,
  limit: number,
  cursor: unknown,
  budget: number,
): Promise<ReadPage> => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024 || !Number.isSafeInteger(budget) || budget < 1)
    throw new StorageInvalidCommandError('invalid page bounds');
  try {
    await core.visible(session, root, chainId);
  } catch (error) {
    if (error instanceof StorageDeniedError) return { outcome: 'inaccessible', records: [], nextCursor: null };
    throw error;
  }
  const binding = { moduleId: core.options.moduleId, scope: grant.scope, incarnation: core.incarnation };
  const verified = cursor == null ? undefined : core.provider.verify(chainId, cursor, binding);
  if (verified === null) throw new StorageInvalidCommandError('invalid cursor');
  if (isUnknownCursorBoundary(verified)) return { outcome: 'incomplete', records: [], nextCursor: null };
  const chain = await core.roots.get<PgChain>(session, root, 'chain', chainId);
  if (chain?.disposed) return { outcome: 'inaccessible', records: [], nextCursor: null };
  const start = verified?.position ?? 0;
  const seq = verified?.seq ?? (chain?.count ?? 0) - 1;
  const head = verified?.head ?? chain?.head;
  const allocation = verified?.allocation ?? chain?.allocation;
  if (head === undefined || allocation === undefined) return { outcome: 'page', records: [], nextCursor: null };
  const terminal = await core.roots.get<PgChainRef>(session, root, 'chain-record', chainRecordKey(chainId, seq));
  if (!terminal || terminal.hash !== head || (chain && BigInt(chain.allocation) < BigInt(allocation))) {
    const page: ReadPage = {
      outcome: 'incomplete',
      records: [],
      nextCursor: typeof cursor === 'string' ? cursor : null,
    };
    return pageSize(page) <= budget ? page : { ...page, nextCursor: null };
  }
  const mint = (position: number) =>
    core.provider.mint({ ...binding, selection: chainId, position, seq, head, allocation });
  const records: { id: string; seq: number; hash: string; bytes: string }[] = [];
  const trim = (): ReadPage => {
    while (
      records.length &&
      pageSize({ outcome: 'incomplete', records, nextCursor: mint(start + records.length) }) > budget
    )
      records.pop();
    return { outcome: 'incomplete', records, nextCursor: records.length ? mint(start + records.length) : null };
  };
  for (let position = start; position <= seq; position += 1) {
    if (records.length === limit) {
      const page: ReadPage = { outcome: 'page', records, nextCursor: mint(position) };
      return pageSize(page) <= budget ? page : trim();
    }
    const entry = await core.roots.get<PgChainRef>(session, root, 'chain-record', chainRecordKey(chainId, position));
    if (!entry) return trim();
    const record = {
      id: entry.id,
      seq: entry.seq,
      hash: entry.hash,
      bytes: decodePgUtf8(await core.roots.readPayload(session, grant.scope, entry.payload)),
    };
    const next = position < seq ? mint(position + 1) : null;
    if (pageSize({ outcome: 'page', records: [...records, record], nextCursor: next }) > budget) return trim();
    records.push(record);
  }
  return { outcome: 'page', records, nextCursor: null };
};
export class PgView {
  constructor(
    private readonly core: PgCore,
    private readonly session: PgSession,
    private readonly grant: ScopeGrant<unknown>,
    private readonly initial: string | null,
    private readonly active?: PgTx,
  ) {}
  private async root(target?: string): Promise<string | null> {
    if (this.active?.closed) throw new StorageInvalidCommandError('transaction is closed');
    await this.core.check(this.session, this.grant, 'read');
    const root = this.active ? this.active.root : this.initial;
    if (target !== undefined) await this.core.visible(this.session, root, target);
    return root;
  }
  async readHead(chainId: string): Promise<string | null> {
    return (await this.core.roots.get<PgChain>(this.session, await this.root(chainId), 'chain', chainId))?.head ?? null;
  }
  async readRecord(key: string): Promise<{ bytes: EncodedValue; contentHash: string } | null> {
    const ref = await this.core.roots.get<PgRecordRef>(this.session, await this.root(key), 'record', key);
    return ref
      ? {
          contentHash: ref.contentHash,
          bytes: decodePgJson<EncodedValue>(
            decodePgUtf8(await this.core.roots.readPayload(this.session, this.grant.scope, ref.payload)),
          ),
        }
      : null;
  }
  async readAggregate(key: string): Promise<{ version: number; value: EncodedValue } | null> {
    const ref = await this.core.roots.get<{ version: number; payload: string }>(
      this.session,
      await this.root(key),
      'aggregate',
      key,
    );
    return ref
      ? {
          version: ref.version,
          value: decodePgJson<EncodedValue>(
            decodePgUtf8(await this.core.roots.readPayload(this.session, this.grant.scope, ref.payload)),
          ),
        }
      : null;
  }
  async findIdempotency(selector: { key: string }) {
    return this.core.roots.get<{ digest: string; resultIds: readonly string[]; resultHash: string | null }>(
      this.session,
      await this.root(selector.key),
      'index',
      selector.key,
    );
  }
  async readChain(input: {
    chainId: string;
    limit: number;
    cursor?: unknown;
    maxEncodedBytes: number;
  }): Promise<ReadPage> {
    const page = await readPgPage(
      this.core,
      this.session,
      this.grant,
      await this.root(),
      input.chainId,
      input.limit,
      input.cursor,
      input.maxEncodedBytes,
    );
    await this.core.check(this.session, this.grant, 'read');
    return page;
  }
  async readRecords(keys: readonly string[], limits: PageLimits) {
    if (
      !Number.isSafeInteger(limits.maxRecords) ||
      !Number.isSafeInteger(limits.maxEncodedBytes) ||
      limits.maxRecords < 1 ||
      limits.maxEncodedBytes < 1 ||
      keys.length > limits.maxRecords
    )
      throw new StorageInvalidCommandError('invalid record read bounds');
    const rows = [];
    for (const key of [...new Set(keys)].sort()) {
      const value = await this.readRecord(key);
      if (value) rows.push({ key, ...value });
    }
    if (Buffer.byteLength(JSON.stringify(rows), 'utf8') > limits.maxEncodedBytes)
      throw new StorageInvalidCommandError('record result exceeds byte budget');
    return rows;
  }
}
