import { readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { digest } from './guards.mjs';
import { aclStatements } from './t3-acl.mjs';
import { preCommitRollback, waitZeroPods } from './t3-rollback.mjs';
import { monoMs } from './t3-lib.mjs';

export const aclSql = () => readFileSync(new URL('./t3-acl.sql', import.meta.url), 'utf8');
const pg = (ctx, sql, extra = []) => ctx.call(['exec', ctx.config.postgresPod ?? 'postgres-0', '--',
  'psql', '-U', ctx.config.postgresUser ?? 'app', '-v', 'ON_ERROR_STOP=1', '-XqAt', ...extra], sql);
export function privateBytes(path) {
  const s = lstatSync(path);
  if (!s.isFile() || s.mode & 0o077 || s.uid !== process.getuid() || realpathSync(path) !== path) {
    throw new Error('private_file_invalid');
  }
  return readFileSync(path);
}
export function captureAcl(ctx, dir) {
  const dump = ctx.call(['exec', ctx.config.postgresPod ?? 'postgres-0', '--',
    'pg_dump', '-U', ctx.config.postgresUser ?? 'app', '--schema-only']);
  const sql = aclStatements(dump), hash = pg(ctx, aclSql()).trim();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('acl_capture_invalid');
  writeFileSync(`${dir}/acl.sql`, sql, { mode: 0o600 });
  const receipt = { aclCatalogSha256: hash, aclSqlSha256: digest(sql) };
  writeFileSync(`${dir}/acl.json`, JSON.stringify(receipt), { mode: 0o600 });
  return receipt;
}

export function restoreSql(dump, acl, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('acl_hash_invalid');
  return `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE datname=current_database() AND pid<>pg_backend_pid();
SELECT format('DROP SCHEMA %I CASCADE;',nspname) FROM pg_namespace
WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' ORDER BY nspname \\gexec
${/^CREATE SCHEMA public;/m.test(dump) ? '' : 'CREATE SCHEMA public;'}
${dump}
${acl}
SELECT public.oauth_refresh_invalidate_restore();
DELETE FROM public.oauth_tokens;
${aclSql().replace(/;\s*$/, ' \\gset')}
SELECT :'acl_sha256' = '${expectedHash}' AS acl_matches \\gset
\\if :acl_matches
\\else
\\quit 3
\\endif
`;
}

export async function restore(ctx, approval) {
  const { config, call } = ctx;
  const dumpBytes = privateBytes(config.restoreDumpFile), acl = privateBytes(config.restoreAclFile).toString();
  if (!approval?.ownerRef || /pending|TODO|<|>/i.test(approval.ownerRef)
    || approval.namespace !== config.namespace || approval.operationId !== config.request.operationId
    || approval.dumpSha256 !== digest(dumpBytes) || approval.aclSqlSha256 !== digest(acl)) {
    throw new Error('restore_not_authorized');
  }
  for (const name of ['api', 'auth-idp', 'ui']) {
    const d = JSON.parse(call(['get', 'deployment', name, '-o', 'json']));
    if (d.spec.replicas !== 0 || (d.status?.replicas ?? 0) !== 0) throw new Error('restore_not_fenced');
  }
  waitZeroPods(call, monoMs() + 30_000);
  for (const name of ['pgbackup', 'sentropic-idp-identity-export']) {
    const c = JSON.parse(call(['get', 'cronjob', name, '-o', 'json']));
    if (c.spec.suspend !== true || c.status?.active?.length) throw new Error('restore_cron_active');
  }
  for (const name of ['sentropic', 'auth-idp']) {
    const i = JSON.parse(call(['get', 'ingress', name, '-o', 'json']));
    if (i.metadata.annotations?.['traefik.ingress.kubernetes.io/router.middlewares']
      !== `${config.namespace}-a4-verification@kubernetescrd`) throw new Error('restore_ingress_open');
  }
  const dump = gunzipSync(dumpBytes).toString();
  pg(ctx, readFileSync(new URL('../artifact-data-guard/refuse-artifact-data.sql', import.meta.url), 'utf8'));
  pg(ctx, restoreSql(dump, acl, approval.aclCatalogSha256), ['--single-transaction']);
  if (pg(ctx, aclSql()).trim() !== approval.aclCatalogSha256) throw new Error('restore_acl_mismatch');
  return preCommitRollback({ ...ctx, revisions: config.revisions, preCmDir: config.preCmDir,
    healthUrl: config.endpoints.appHealth, jwksUrl: config.endpoints.idpJwks, witness: config.witness });
}
