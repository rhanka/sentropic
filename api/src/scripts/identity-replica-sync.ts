#!/usr/bin/env tsx
//
// Preprod sync replacement,_CM sync phase (a4-cm-gaps-r2 §9.2): validates the
// relay manifest, converges the CM replica batch over the app CM unit of work,
// and prints machine audit lines plus the termination JSON.
//
// --dry-run (default) opens a write attempt over the batch, captures the
// would-sync receipt, then rolls the attempt back with a terminal sentinel, so
// the database is byte-identical afterwards. --commit performs the real sync.
// Phase 2 (app protocol SQL) runs only after this runner succeeds; the job
// shell maps the exit codes below to its fail codes.
//
// Exit codes: 0 ok · 10 invalid_manifest · 11 integrity_failed · 12 stale_snapshot
// 13 manifest_mismatch · 14 empty_export · 20 identity_sync_conflict
// 21 identity_sync_invalid. The runner stays environment-agnostic: it syncs
// whatever database its environment points at (the lane dry-run uses a test env).
//

import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  IdentityReplicaSyncBatchV1,
  IdentityReplicaSyncReceiptV1,
} from '@sentropic/cluster-mesh';

const EXIT = {
  invalid_manifest: 10,
  integrity_failed: 11,
  stale_snapshot: 12,
  manifest_mismatch: 13,
  empty_export: 14,
  identity_sync_conflict: 20,
  identity_sync_invalid: 21,
} as const;

type FailCode = keyof typeof EXIT;

class RunnerFailure extends Error {
  readonly code: FailCode;
  constructor(code: FailCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

/** Terminal sentinel: unwinds the write attempt after capturing the receipt. */
class DryRunRollback extends Error {
  readonly receipt: IdentityReplicaSyncReceiptV1;
  constructor(receipt: IdentityReplicaSyncReceiptV1) {
    super('dry_run_rollback');
    this.receipt = receipt;
  }
}

const fail = (code: FailCode, detail?: string): never => { throw new RunnerFailure(code, detail); };

const countDataRows = (text: string, path: string): number => {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) fail('invalid_manifest', `empty relay file ${path}`);
  return lines.length - 1;
};

async function readRelay(relayDir: string, maxSnapshotAgeS: number): Promise<{
  batch: IdentityReplicaSyncBatchV1; exportedAt: string; fileCounts: Record<string, number>;
}> {
  let manifest: string;
  try {
    manifest = await readFile(join(relayDir, 'SHA256SUMS'), 'utf8');
  } catch { fail('invalid_manifest', 'SHA256SUMS missing'); }
  const entries = manifest!
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(/\s+/));
  const names = entries.map(([, name]) => name).sort();
  const expected = ['clients.csv', 'consents.csv', 'identity-replica-batch.json', 'replica-users.csv', 'snapshot.csv'];
  if (names.length !== expected.length || expected.some((name, i) => names[i] !== name)) {
    fail('invalid_manifest', `relay must hold exactly ${expected.join(',')}`);
  }
  for (const [digest, name] of entries) {
    if (!/^[a-f0-9]{64}$/.test(digest ?? '')) fail('invalid_manifest', `bad digest for ${name}`);
    let bytes: Buffer;
    try {
      bytes = await readFile(join(relayDir, name!));
    } catch { fail('integrity_failed', `missing relay file ${name}`); }
    const actual = createHash('sha256').update(bytes!).digest();
    const expectedDigest = Buffer.from(digest!, 'hex');
    if (actual.length !== expectedDigest.length || !timingSafeEqual(actual, expectedDigest)) {
      fail('integrity_failed', name);
    }
  }
  const files = Object.fromEntries(await Promise.all(
    expected.map(async (name) => [name, (await readFile(join(relayDir, name), 'utf8'))] as const),
  ));
  const snapshotFields = files['snapshot.csv'].trim().split(',');
  if (snapshotFields.length !== 5) fail('invalid_manifest', 'snapshot.csv must hold 5 fields');
  const [exportedAt, accounts, credentials, consents, clients] = snapshotFields;
  for (const [label, value] of [['accounts', accounts], ['credentials', credentials], ['consents', consents], ['clients', clients]] as const) {
    if (!/^\d+$/.test(value ?? '')) fail('manifest_mismatch', `snapshot ${label} not a count`);
  }
  const epoch = Date.parse(exportedAt!);
  if (Number.isNaN(epoch)) fail('invalid_manifest', 'snapshot exported_at unparseable');
  const ageS = (Date.now() - epoch) / 1000;
  if (ageS < 0 || ageS > maxSnapshotAgeS) fail('stale_snapshot', `age ${Math.round(ageS)}s`);
  if (accounts === '0') fail('empty_export', 'zero accounts');

  let batch: IdentityReplicaSyncBatchV1;
  try {
    batch = JSON.parse(files['identity-replica-batch.json']) as IdentityReplicaSyncBatchV1;
  } catch { fail('invalid_manifest', 'batch is not JSON'); }
  const rows = batch!.rows ?? [];
  const byEntity = (entity: string): number => rows.filter((row) => row.entity === entity).length;
  const fileCounts = {
    accounts: countDataRows(files['replica-users.csv'], 'replica-users.csv'),
    credentials: byEntity('credential'),
    consents: countDataRows(files['consents.csv'], 'consents.csv'),
    clients: countDataRows(files['clients.csv'], 'clients.csv'),
  };
  const batchAccounts = byEntity('account');
  if (batchAccounts !== Number(accounts) || byEntity('credential') !== Number(credentials)
    || fileCounts.consents !== Number(consents) || fileCounts.clients !== Number(clients)
    || fileCounts.accounts !== batchAccounts) {
    fail('manifest_mismatch', 'relay counts differ from the snapshot manifest');
  }
  return { batch: batch!, exportedAt: exportedAt!, fileCounts };
}

export interface ReplicaSyncResult {
  readonly outcome: 'committed' | 'rolled_back' | 'failed';
  readonly code?: string;
  readonly counts: Record<string, number>;
  readonly conflict_subject_ids?: string[];
}
