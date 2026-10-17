import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PostgresStorageError, PgSchemaDriftError } from './errors.js';
import { decodePgText } from './codec.js';
import { quotePgIdentifier, validatePgLayout, type PgLayout, type PgSession } from './protocol.js';
export interface PgAsset {
  readonly schemaRole?: 'comments';
  readonly id: string; readonly file: string; readonly order: number; readonly dialect: 'postgresql';
  readonly mode: 'transactional'; readonly fromVersion: number; readonly toVersion: number;
  readonly requires: readonly string[]; readonly checksum: string; readonly sql: string;
}
export interface PgMigrationReceipt extends Omit<PgAsset, 'sql' | 'file'> {
  readonly hostMigrationId: string; readonly hostChecksum: string; readonly appliedChecksum: string;
  readonly schemaFingerprint: string; readonly status: 'complete'; readonly conversionState: 'not-required';
}
// The host implements this against its existing migration history and holds
// its migration ownership. Both methods receive the caller's transaction.
export interface PgHostHistory {
  read(session: PgSession): Promise<readonly PgMigrationReceipt[]>;
  complete(session: PgSession, receipt: PgMigrationReceipt): Promise<void>;
  reattest?(session: PgSession, attestation: PgSchemaAttestation): Promise<void>;
}
export interface PgSchemaAttestation {
  readonly previousFingerprint: string;
  readonly schemaFingerprint: string;
  readonly hostMigrationId: string;
  readonly hostChecksum: string;
  readonly reason: string;
}
const digest = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');
const refuse = (): never => { throw new PostgresStorageError('configuration'); };
export const loadPgAssets = async (selected: { readonly comments?: boolean } = {}): Promise<readonly PgAsset[]> => {
  const directory = new URL('../../../assets/storage/postgres/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')) as { version: number; assets: Omit<PgAsset, 'sql'>[] };
  if (manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length === 0) refuse();
  if (selected.comments) {
    const module = JSON.parse(await readFile(new URL('comments/manifest.json', directory), 'utf8')) as typeof manifest;
    if (module.version !== 1 || !Array.isArray(module.assets)) refuse();
    manifest.assets.push(...module.assets);
  }
  const assets: PgAsset[] = [];
  for (const [index, asset] of manifest.assets.entries()) {
    if (!/^(comments\/)?\d{3}-[a-z-]+\.sql$/.test(asset.file) || asset.order !== index + 1 || asset.dialect !== 'postgresql' || asset.mode !== 'transactional' || asset.fromVersion !== index || asset.toVersion !== index + 1 ||
      JSON.stringify(asset.requires) !== JSON.stringify(index === 0 ? [] : [assets[index - 1]!.id])) refuse();
    const sql = await readFile(new URL(asset.file, directory), 'utf8');
    if (digest(sql) !== asset.checksum) refuse();
    assets.push(Object.freeze({ ...asset, requires: Object.freeze([...asset.requires]), sql }));
  }
  return Object.freeze(assets);
};
const fingerprint = async (session: PgSession, layout: PgLayout, assets: readonly PgAsset[]): Promise<string> => {
  const owned = assets.flatMap((asset) => [...asset.sql.matchAll(/CREATE (TABLE|FUNCTION) (__DATA_SCHEMA__|__COMMENTS_SCHEMA__)\.([a-z_]+)/g)]
    .map((match) => [match[2] === '__DATA_SCHEMA__' ? layout.dataSchema : layout.projectionSchemas.comments, match[3], match[1]]));
  const result = await session.execute({ text: `SELECT jsonb_agg(object ORDER BY object::text COLLATE "C")::text AS objects FROM (
    SELECT jsonb_build_array('column',c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,pg_get_expr(d.adbin,d.adrelid)) AS object
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
    UNION ALL SELECT jsonb_build_array('constraint',c.relname,k.conname,pg_get_constraintdef(k.oid)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
    UNION ALL SELECT jsonb_build_array('index',c.relname,pg_get_indexdef(i.indexrelid)) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
    UNION ALL SELECT jsonb_build_array('function',p.proname,pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind='f'
  ) AS definitions`.replaceAll('n.nspname=$1', `EXISTS (SELECT 1 FROM jsonb_array_elements($1::jsonb) owned WHERE owned->>0=n.nspname AND owned->>1=c.relname AND owned->>2='TABLE')`)
    .replace("owned->>1=c.relname AND owned->>2='TABLE') AND p.prokind='f'", "owned->>1=p.proname AND owned->>2='FUNCTION') AND p.prokind='f'")
    .replaceAll("jsonb_build_array('", "jsonb_build_array(n.nspname,'"), values: [JSON.stringify(owned)] });
  return digest(decodePgText(result.rows[0]?.objects));
};
const checkReceipts = (assets: readonly PgAsset[], rows: readonly PgMigrationReceipt[]): void => {
  if (rows.length !== assets.length) refuse();
  for (const [index, asset] of assets.entries()) {
    if (asset.order !== index + 1 || asset.fromVersion !== index || asset.toVersion !== index + 1 || digest(asset.sql) !== asset.checksum || JSON.stringify(asset.requires) !== JSON.stringify(index ? [assets[index - 1]!.id] : [])) refuse();
    const row = rows[index];
    if (!row || row.id !== asset.id || row.order !== asset.order || row.checksum !== asset.checksum || row.appliedChecksum !== asset.checksum || row.status !== 'complete' || row.conversionState !== 'not-required' ||
      row.dialect !== asset.dialect || row.mode !== asset.mode || row.fromVersion !== asset.fromVersion || row.toVersion !== asset.toVersion || !row.hostMigrationId || !/^[a-f0-9]{64}$/.test(row.hostChecksum) || JSON.stringify(row.requires) !== JSON.stringify(asset.requires)) refuse();
  }
};
export const verifyPgInstallation = async (session: PgSession, configured: PgLayout, assets: readonly PgAsset[], history: PgHostHistory): Promise<void> => {
  const layout = validatePgLayout(configured);
  const rows = await history.read(session);
  checkReceipts(assets, rows);
  const expected = rows.at(-1)?.schemaFingerprint ?? '';
  const actual = await fingerprint(session, layout, assets);
  if (expected !== actual) throw new PgSchemaDriftError(expected, actual);
};
export const reattestPgInstallation = async (
  session: PgSession, configured: PgLayout, assets: readonly PgAsset[], history: PgHostHistory,
  approval: Omit<PgSchemaAttestation, 'schemaFingerprint'> & { readonly referenceFingerprint: string },
): Promise<void> => {
  const layout = validatePgLayout(configured);
  const rows = await history.read(session);
  checkReceipts(assets, rows);
  if (!history.reattest || !approval.reason.trim() || !approval.hostMigrationId ||
    !/^[a-f0-9]{64}$/.test(approval.hostChecksum) ||
    rows.at(-1)?.schemaFingerprint !== approval.previousFingerprint) refuse();
  const actual = await fingerprint(session, layout, assets);
  if (actual !== approval.referenceFingerprint) throw new PgSchemaDriftError(approval.referenceFingerprint, actual);
  await history.reattest!(session, {
    previousFingerprint: approval.previousFingerprint, schemaFingerprint: actual,
    hostMigrationId: approval.hostMigrationId, hostChecksum: approval.hostChecksum, reason: approval.reason,
  });
  await verifyPgInstallation(session, layout, assets, history);
};
export const applyPgMigrations = async (session: PgSession, configured: PgLayout, assets: readonly PgAsset[], history: PgHostHistory, host: { readonly id: string; readonly checksum: string }): Promise<void> => {
  const layout = validatePgLayout(configured);
  if (!host.id || !/^[a-f0-9]{64}$/.test(host.checksum)) refuse();
  const applied = await history.read(session);
  if (applied.length > assets.length) refuse();
  if (applied.length > 0) await verifyPgInstallation(session, layout, assets.slice(0, applied.length), history);
  const schema = quotePgIdentifier(layout.dataSchema);
  for (const asset of assets.slice(applied.length)) {
    if (digest(asset.sql) !== asset.checksum) refuse();
    if (asset.schemaRole === 'comments' && !layout.projectionSchemas.comments) refuse();
    await session.execute({ text: asset.sql.replaceAll('__DATA_SCHEMA__', schema).replaceAll('__COMMENTS_SCHEMA__', quotePgIdentifier(layout.projectionSchemas.comments ?? layout.dataSchema)), values: [] });
    const { sql: _sql, file: _file, ...identity } = asset;
    await history.complete(session, { ...identity, hostMigrationId: host.id, hostChecksum: host.checksum, appliedChecksum: asset.checksum,
      schemaFingerprint: await fingerprint(session, layout, assets), status: 'complete', conversionState: 'not-required' });
  }
};
