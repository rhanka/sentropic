import { computeMemoryMutationOperationDigestV1, type McpMemoryProviderOptions } from '@sentropic/engram/mcp-memory';
import type { memoryPgHost } from './pg-host.js';
type Port = McpMemoryProviderOptions['writeHost']['reservation'];
type Entry = Extract<Awaited<ReturnType<Port['reserveOrLoad']>>, { ok: true }>['value'];
const ok = (value: Entry) => ({ ok: true as const, value });
const fail = (error_code: 'NOT_FOUND' | 'INVALID_SCHEMA' | 'MUTATION_OUTCOME_UNKNOWN') =>
  ({ ok: false as const, error_code, message: 'test host recovery refused' });

/** A durable test host ledger, separate from the canonical memory journal. */
export async function mcpRecovery(pg: Awaited<ReturnType<typeof memoryPgHost>>): Promise<Port> {
  const table = `"${pg.name}".mcp_reservations`;
  await pg.tx.run(false, session => session.execute({ text:
    `CREATE TABLE ${table}(lookup_key text PRIMARY KEY,ref text UNIQUE NOT NULL,entry jsonb NOT NULL)`, values: [] }));
  const change = async (ref: string, update: (entry: Entry) => Entry | undefined) => pg.tx.run(false, async session => {
    const row = (await session.execute({ text: `SELECT entry FROM ${table} WHERE ref=$1 FOR UPDATE`, values: [ref] })).rows[0];
    if (!row) return fail('NOT_FOUND');
    const next = update(row.entry as Entry);
    if (!next) return fail('INVALID_SCHEMA');
    await session.execute({ text: `UPDATE ${table} SET entry=$2::jsonb WHERE ref=$1`, values: [ref, JSON.stringify(next)] });
    return ok(next);
  });
  return {
    reserveOrLoad: async (lookup_key, preimage) => pg.tx.run(false, async session => {
      const digest = computeMemoryMutationOperationDigestV1(preimage);
      if (!digest.ok) return digest;
      const entry: Entry = { lookup_key, preimage, operation_digest: digest.value.operation_digest,
        policy_versions: digest.value.policy_versions, audit_id: 'memory-test-reservation-audit', execution_generation: '0',
        recovery_state: ['engram_memory_withdraw', 'engram_memory_forget'].includes(preimage.tool_name)
          ? 'pending_confirmation' : 'authorized_uncommitted' };
      const key = JSON.stringify(lookup_key);
      await session.execute({ text: `INSERT INTO ${table} VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`,
        values: [key, preimage.reservation_ref, JSON.stringify(entry)] });
      const rows = await session.execute({ text: `SELECT entry FROM ${table} WHERE lookup_key=$1`, values: [key] });
      return ok(rows.rows[0]!.entry as Entry);
    }),
    attachConfirmation: (ref, confirmation_ref, digest) => change(ref, entry => entry.operation_digest === digest
      ? { ...entry, confirmation_ref, recovery_state: entry.recovery_state === 'pending_confirmation' ? 'authorized_uncommitted' : entry.recovery_state } : undefined),
    claimFencedExecution: (ref, execution_generation) => change(ref, entry => entry.recovery_state === 'authorized_uncommitted'
      ? { ...entry, execution_generation, recovery_state: 'executing_unknown_outcome' } : undefined),
    reconcileCanonicalOutcome: (ref, canonical_replay_ref) => change(ref, entry =>
      ({ ...entry, canonical_replay_ref, recovery_state: 'canonical_committed_receipt' })),
    recordCompletion: (ref, stored_output) => change(ref, entry => entry.recovery_state === 'canonical_committed_receipt'
      ? { ...entry, stored_output, recovery_state: 'completed_response' } : undefined),
  };
}
