import type { Pool, PoolClient } from 'pg';
import type {
  LiveBaseline, LiveCheckpoint, LiveCommit, LiveDocumentIdentity, LiveDocumentState,
  LiveDocumentStore, LiveJournalEntry,
} from '../../../../packages/chat-core/src/live-document-port';
import { canonical, commitDigest, duplicate, validateCommit } from './journal';
import { verifyCheckpoint } from './persistence';

type CrashPoint = 'before-journal' | 'after-journal' | 'before-checkpoint' | 'after-checkpoint' | 'after-commit';
const scope = (id: LiveDocumentIdentity) => [id.tenantId, id.workspaceId, id.documentId];
const predicate = 'tenant_id=$1 AND workspace_id=$2 AND document_id=$3';
type DocumentRow = { baseline: LiveBaseline; schema_epoch: string; head: number; checkpoint: LiveCheckpoint | null };

/** No eager singleton: H1's authenticated registry and H3's codec own composition.
 * Row locking serializes writers, duplicate decisions and coherent recovery reads. */
export class PgLiveDocumentStore implements LiveDocumentStore {
  constructor(private readonly pool: Pool, private readonly fault: (point: CrashPoint) => void = () => {}) {}
  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL synchronous_commit = on');
      const result = await run(client);
      await client.query('COMMIT');
      committed = true;
      this.fault('after-commit');
      return result;
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  private async read(client: PoolClient, identity: LiveDocumentIdentity): Promise<LiveDocumentState> {
    const params = scope(identity);
    if (!params.every(v => typeof v === 'string' && v.length > 0)) throw new Error('invalid-document-identity');
    const rows = await client.query<DocumentRow>(`SELECT baseline, schema_epoch, head, checkpoint
      FROM canvas_live_documents WHERE ${predicate} FOR UPDATE`, params);
    const row = rows.rows[0];
    if (!row) throw new Error('document-missing');
    const entries = await client.query<{ body: LiveJournalEntry }>(`SELECT body FROM canvas_live_journal
      WHERE ${predicate} ORDER BY seq`, params);
    return { identity: { ...identity }, baseline: row.baseline, schemaEpoch: row.schema_epoch,
      head: row.head, checkpoint: row.checkpoint, journal: entries.rows.map(r => r.body) };
  }
  open(identity: LiveDocumentIdentity, baseline: LiveBaseline, schemaEpoch: string): Promise<LiveDocumentState> {
    return this.transaction(async client => {
      await client.query(`INSERT INTO canvas_live_documents (tenant_id,workspace_id,document_id,baseline,schema_epoch)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [...scope(identity), JSON.stringify(baseline), schemaEpoch]);
      const state = await this.read(client, identity);
      if (state.schemaEpoch !== schemaEpoch) throw new Error('schema-epoch-conflict');
      return state;
    });
  }
  load(identity: LiveDocumentIdentity): Promise<LiveDocumentState> {
    return this.transaction(client => this.read(client, identity));
  }
  commit(identity: LiveDocumentIdentity, expectedHead: number, input: LiveCommit): Promise<LiveJournalEntry> {
    const frozen = structuredClone(input);
    validateCommit(identity, frozen);
    return this.transaction(async client => {
      const state = await this.read(client, identity);
      const previous = duplicate(state.journal, frozen);
      if (previous) return previous;
      if (state.head !== expectedHead) throw new Error('head-conflict');
      const entry: LiveJournalEntry = { ...frozen, seq: state.head + 1, digest: commitDigest(frozen) };
      this.fault('before-journal');
      await client.query(`INSERT INTO canvas_live_journal (tenant_id,workspace_id,document_id,seq,body)
        VALUES ($1,$2,$3,$4,$5)`, [...scope(identity), entry.seq, JSON.stringify(entry)]);
      this.fault('after-journal');
      await client.query(`UPDATE canvas_live_documents SET head=$4 WHERE ${predicate}`, [...scope(identity), entry.seq]);
      return entry;
    });
  }
  checkpoint(identity: LiveDocumentIdentity, expectedHead: number, input: LiveCheckpoint): Promise<void> {
    const frozen = structuredClone(input);
    return this.transaction(async client => {
      const state = await this.read(client, identity);
      if (state.head !== expectedHead || frozen.journalWatermark !== expectedHead) throw new Error('head-conflict');
      verifyCheckpoint(frozen, state);
      this.fault('before-checkpoint');
      const existing = await client.query<{ body: LiveCheckpoint }>(`SELECT body FROM canvas_live_checkpoints
        WHERE ${predicate} AND checkpoint_id=$4`, [...scope(identity), frozen.checkpointId]);
      if (existing.rows[0] && canonical(existing.rows[0].body) !== canonical(frozen)) throw new Error('checkpoint-id-reuse');
      await client.query(`INSERT INTO canvas_live_checkpoints (tenant_id,workspace_id,document_id,checkpoint_id,body)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [...scope(identity), frozen.checkpointId, JSON.stringify(frozen)]);
      await client.query(`UPDATE canvas_live_documents SET checkpoint=$4 WHERE ${predicate}`, [...scope(identity), JSON.stringify(frozen)]);
      this.fault('after-checkpoint');
    });
  }
}
