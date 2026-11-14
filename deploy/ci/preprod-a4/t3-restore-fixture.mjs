import { restoreSql, aclSql } from './t3-restore.mjs';
// psql substitutes the catalogue captured by the fixture in the same database.
process.stdout.write(restoreSql('\\i /tmp/t3-source.sql', '\\i /tmp/t3-acl.sql', 'a'.repeat(64))
  .replace(`'${'a'.repeat(64)}'`, ":'baseline_acl'")
  .replace('SELECT 1 OPERATOR(pg_catalog./)', `\\o /tmp/t3-catalog-after\n${aclSql().split('SELECT pg_catalog.encode')[0]}SELECT * FROM entries ORDER BY kind,name;\n\\o\nSELECT 1 OPERATOR(pg_catalog./)`));
