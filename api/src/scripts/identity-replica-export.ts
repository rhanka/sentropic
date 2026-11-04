#!/usr/bin/env tsx
//
// Preprod sync replacement, PROD export leg (a4-cm-gaps-r2 §9.2): emits the CM
// identity replica batch plus the relay CSVs. Runs inside the api image (no new
// image) against the source DB; the S3 relay upload stays in the CronJob.
//
// Relay layout in RELAY_DIR (default '.'); the SQL leg runs first and writes the
// protocol CSVs, then the runner adds the CM files:
//   identity-replica-batch.json  the CM batch (accounts, credentials, consents)
//   replica-users.csv            batch account user ids (scopes phase-2 convergence)
//   snapshot.csv                 exported_at,accounts,credentials,consents,clients (no header)
//   consents.csv                 app protocol consents, SQL leg (scopes live here, not in CM)
//   clients.csv                  app protocol clients, SQL leg (secret presence only)
//   SHA256SUMS                   over the five files above
//
// Required env: SOURCE_PLACEMENT. Run options come from the protected
// CM_IDENTITY_DELETION_BUDGETS_JSON (`replicaExport` entry + receipt) — the same
// pattern as deletion budgets, never a request default.
//

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createIdentityReplicaExporterV1 } from '@sentropic/cluster-mesh';

import { pool } from '../db/client';
import { cmIdentityUnitOfWork } from '../services/identity/cm-transaction';
import { loadReplicaRunOptions } from '../services/identity/cm-deletion-options';

export interface ReplicaExportCounts {
  readonly accounts: number;
  readonly credentials: number;
  readonly consents: number;
  readonly clients: number;
}

const requireEnv = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = source[name];
  if (!value || value.trim() === '') throw new Error(`Missing required env ${name}`);
  return value.trim();
};

const csvCell = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const countDataRows = async (path: string): Promise<number> => {
  const text = await readFile(path, 'utf8');
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) throw new Error(`Empty relay file ${path}`);
  return lines.length - 1;
};

export async function runReplicaExport(options: {
  readonly relayDir?: string;
  readonly placement?: string;
  readonly syncId?: string;
  readonly source?: NodeJS.ProcessEnv;
} = {}): Promise<ReplicaExportCounts & { readonly exportedAt: string }> {
  const source = options.source ?? process.env;
  const relayDir = options.relayDir ?? source.RELAY_DIR ?? '.';
  const placement = options.placement ?? requireEnv(source, 'SOURCE_PLACEMENT');
  const syncId = options.syncId ?? `replica-export-${Date.now()}`;
  const { export: exportOptions } = loadReplicaRunOptions(source);

  const exporter = createIdentityReplicaExporterV1({
    unitOfWork: cmIdentityUnitOfWork,
    clock: () => new Date().toISOString(),
    exportOptions,
  });
  const batch = await exporter.exportBatch({ syncId, sourcePlacement: placement, sourceSnapshotRef: 'snapshot.csv' });

  // Protocol CSVs (consents with scopes, clients) come from the SQL leg, which runs
  // first; the runner counts the shipped files so the snapshot matches them exactly.
  let accounts = 0;
  let credentials = 0;
  const userLines = ['id'];
  for (const row of batch.rows) {
    if (row.entity === 'account') {
      accounts += 1;
      userLines.push(csvCell(row.record.userId));
    } else if (row.entity === 'credential') {
      credentials += 1;
    }
  }

  const [consents, clients] = await Promise.all([
    countDataRows(join(relayDir, 'consents.csv')),
    countDataRows(join(relayDir, 'clients.csv')),
  ]);
  await writeFile(join(relayDir, 'identity-replica-batch.json'), `${JSON.stringify(batch, null, 2)}\n`);
  await writeFile(join(relayDir, 'replica-users.csv'), `${userLines.join('\n')}\n`);
  const exportedAt = batch.exportedAt;
  await writeFile(
    join(relayDir, 'snapshot.csv'),
    `${exportedAt},${accounts},${credentials},${consents},${clients}\n`,
  );

  const sums: string[] = [];
  for (const file of ['identity-replica-batch.json', 'consents.csv', 'replica-users.csv', 'snapshot.csv', 'clients.csv']) {
    const bytes = await readFile(join(relayDir, file));
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}\n`);
  }
  await writeFile(join(relayDir, 'SHA256SUMS'), sums.join(''));

  return { accounts, credentials, consents, clients, exportedAt };
}

async function main(): Promise<void> {
  const counts = await runReplicaExport();
  console.log(JSON.stringify(counts));
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream('/dev/termination-log', { flags: 'w' });
    stream.on('error', reject);
    stream.end(`${JSON.stringify(counts)}\n`, () => resolve());
  }).catch(() => undefined);
}

// Only run the export when executed directly (kubectl Job / `npm run`); importing
// this module (e.g. from a unit test of `runReplicaExport`) is side-effect-free.
const entrypoint = process.argv[1];
const invokedDirectly = entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;

if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error('Identity replica export failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
