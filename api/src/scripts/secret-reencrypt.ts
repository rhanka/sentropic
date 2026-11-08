// At-rest re-encryption: moves every stored envelope from a SOURCE key to the provisioned
// SECRET_ENCRYPTION_KEY (docs/secrets.md, « SECRET_ENCRYPTION_KEY re-encryption »).
//
// Run in the target namespace's api image: `node dist/index.js --secret-reencrypt [--apply]`.
// Source: `--from-development-seed` (envelopes a deployed image sealed without a key) or
// SECRET_REENCRYPT_SOURCE_KEY (a previous key); exactly one. Target: SECRET_ENCRYPTION_KEY.
// Dry run by default; --apply writes in ONE transaction, rows locked, compare-and-set on the old ciphertext.
// Idempotent: an envelope the target already opens is `current`. One that neither key opens is listed
// by identifier as `unreadable` (record it as lost). Output: one JSON line; never a value or a key.
// Exit 0: done; 2: some envelopes unreadable; 1: refused or failed (rolled back).
// Out of scope: the SG0-app custody, sealed only under a provisioned key (github-app-host.ts gate).
import { DEVELOPMENT_SECRET_SEED, isProvisionedDeploymentSecret } from '../config/deployment-secrets';
import { resealConnectorEnvelope, type ConnectorCustodyEnvelope } from '../services/identity/cm-connector-envelope';
import { deriveConnectorRevocationKey, deriveV1Key, openSecretWithKey, sealSecretWithKey } from '../services/secret-crypto';

export interface ReencryptKeys { readonly source: Buffer; readonly target: Buffer }
export type ReencryptQuery = (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
interface CustodyRow { custody_ref: string; delivery_id: string; connector_account_id: string; provider: string;
  envelope_version: '1'; key_ref: string; nonce: string; ciphertext: string; auth_tag: string; created_at: string }
export interface StoreReport {
  store: string; present: boolean; scanned: number; current: number; moved: number; unreadable: string[];
}
type Outcome<T> = { outcome: 'current' | 'unreadable' } | { outcome: 'moved'; next: T };

class ReencryptRefusal extends Error {}

export const parseSecretReencryptRequest = (env: NodeJS.ProcessEnv, argv: readonly string[]) => {
  const target = env.SECRET_ENCRYPTION_KEY;
  if (!isProvisionedDeploymentSecret(target)) {
    throw new ReencryptRefusal('SECRET_ENCRYPTION_KEY must hold the provisioned target key.');
  }
  const fromSeed = argv.includes('--from-development-seed');
  const sourceKey = env.SECRET_REENCRYPT_SOURCE_KEY || undefined;
  if (fromSeed === (sourceKey !== undefined)) {
    throw new ReencryptRefusal('Give exactly one source: --from-development-seed or SECRET_REENCRYPT_SOURCE_KEY.');
  }
  const source = fromSeed ? DEVELOPMENT_SECRET_SEED : (sourceKey as string);
  if (source === target) throw new ReencryptRefusal('Source and target keys are identical.');
  return { keys: { source: deriveV1Key(source), target: deriveV1Key(target as string) }, apply: argv.includes('--apply') };
};

const opens = (open: () => unknown): boolean => { try { open(); return true; } catch { return false; } };

export const reencryptSecretValue = (value: string, keys: ReencryptKeys): Outcome<string> => {
  if (opens(() => openSecretWithKey(value, keys.target))) return { outcome: 'current' };
  let plaintext: string;
  try { plaintext = openSecretWithKey(value, keys.source); } catch { return { outcome: 'unreadable' }; }
  return { outcome: 'moved', next: sealSecretWithKey(plaintext, keys.target) };
};

export const reencryptConnectorEnvelope = (envelope: ConnectorCustodyEnvelope, keys: ReencryptKeys): Outcome<ConnectorCustodyEnvelope> => {
  if (envelope.keyRef !== 'secret-crypto:v1') return { outcome: 'unreadable' };
  const source = deriveConnectorRevocationKey(keys.source), target = deriveConnectorRevocationKey(keys.target);
  try {
    if (resealConnectorEnvelope(envelope, target, target)) return { outcome: 'current' };
    const next = resealConnectorEnvelope(envelope, source, target);
    return next ? { outcome: 'moved', next } : { outcome: 'unreadable' };
  } finally { source.fill(0); target.fill(0); }
};

/** Column stores of `enc:` values. Identifiers are constants, never input. */
const VALUE_STORES = [
  { store: 'public.settings', column: 'value', id: "key || coalesce('@' || user_id, '')" },
  { store: 'public.document_connector_accounts', column: 'token_secret', id: 'id' },
  { store: 'public.llm_provider_accounts', column: 'token_secret', id: 'id' },
] as const;
const CUSTODY = 'control.connector_revocation_custody';

const tally = (report: StoreReport, id: string, outcome: Outcome<unknown>['outcome']) => {
  report.scanned += 1;
  if (outcome === 'unreadable') report.unreadable.push(id); else report[outcome] += 1;
};
const swapped = (rowCount: number | null, store: string) => {
  if (rowCount !== 1) throw new ReencryptRefusal(`Compare-and-set missed a row in ${store}.`);
};

export async function runSecretReencrypt(query: ReencryptQuery, keys: ReencryptKeys, apply: boolean): Promise<StoreReport[]> {
  const lock = apply ? ' FOR UPDATE' : '';
  const reports: StoreReport[] = [];
  const begin = async (store: string) => {
    const present = (await query('SELECT to_regclass($1) IS NOT NULL AS present', [store])).rows[0]?.present === true;
    const report: StoreReport = { store, present, scanned: 0, current: 0, moved: 0, unreadable: [] };
    reports.push(report);
    return report;
  };
  for (const { store, column, id } of VALUE_STORES) {
    const report = await begin(store);
    if (!report.present) continue;
    const { rows } = await query(`SELECT ctid::text AS row_ref, ${id} AS id, ${column} AS value FROM ${store}
      WHERE ${column} LIKE 'enc:%' ORDER BY 2${lock}`);
    for (const row of rows as Array<{ row_ref: string; id: string; value: string }>) {
      const result = reencryptSecretValue(row.value, keys);
      tally(report, row.id, result.outcome);
      if (apply && result.outcome === 'moved') {
        swapped((await query(`UPDATE ${store} SET ${column} = $3 WHERE ctid = $1::tid AND ${column} = $2`,
          [row.row_ref, row.value, result.next])).rowCount, store);
      }
    }
  }
  const report = await begin(CUSTODY);
  if (report.present) {
    const { rows } = await query(`SELECT custody_ref, delivery_id, connector_account_id, provider, envelope_version, key_ref,
      nonce, ciphertext, auth_tag, created_at FROM ${CUSTODY} ORDER BY custody_ref${lock}`);
    for (const row of rows as unknown as CustodyRow[]) {
      const envelope: ConnectorCustodyEnvelope = { custodyRef: row.custody_ref, deliveryId: row.delivery_id,
        connectorAccountId: row.connector_account_id, provider: row.provider, envelopeVersion: row.envelope_version,
        keyRef: row.key_ref, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, createdAt: row.created_at };
      const result = reencryptConnectorEnvelope(envelope, keys);
      tally(report, envelope.custodyRef, result.outcome);
      if (apply && result.outcome === 'moved') {
        swapped((await query(`UPDATE ${CUSTODY} SET nonce = $2, ciphertext = $3, auth_tag = $4 WHERE custody_ref = $1 AND ciphertext = $5`,
          [envelope.custodyRef, result.next.nonce, result.next.ciphertext, result.next.authTag, envelope.ciphertext])).rowCount, CUSTODY);
      }
    }
  }
  return reports;
}

export async function runSecretReencryptCli(): Promise<void> {
  const { pool } = await import('../db/client');
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let apply = false;
  try {
    const request = parseSecretReencryptRequest(process.env, process.argv);
    apply = request.apply;
    client = await pool.connect();
    const db = client;
    await db.query(apply ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN READ ONLY');
    const stores = await runSecretReencrypt((text, params) => db.query(text, params), request.keys, apply);
    await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    const unreadable = stores.reduce((sum, store) => sum + store.unreadable.length, 0);
    console.log(JSON.stringify({ status: unreadable ? 'unreadable' : 'done', mode: apply ? 'apply' : 'dry-run', stores }));
    process.exitCode = unreadable ? 2 : 0;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    const reason = error instanceof ReencryptRefusal ? error.message : `${(error as Error)?.name ?? 'Error'} ${(error as { code?: string })?.code ?? ''}`.trim();
    console.error(JSON.stringify({ status: 'failed', mode: apply ? 'apply' : 'dry-run', reason }));
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
