import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = new URL('../../assets/storage/postgres/', import.meta.url);
const files = ['001-core.sql', '002-map.sql', '003-staged.sql', '004-queries.sql', '005-cleanup.sql', '006-staged-coverage.sql'];
const assets = [];
for (const [index, file] of files.entries()) {
  const sql = await readFile(new URL(file, directory));
  assets.push({ id: `cluster-mesh-pg/${file.slice(0, -4)}@1`, file, order: index + 1, dialect: 'postgresql', mode: 'transactional',
    fromVersion: index, toVersion: index + 1, requires: index === 0 ? [] : [assets[index - 1].id], checksum: createHash('sha256').update(sql).digest('hex') });
}
await writeFile(new URL('manifest.json', directory), `${JSON.stringify({ version: 1, assets }, null, 2)}\n`);
const modules = [];
for (const file of ['comments/001-projections.sql', 'comments/002-transport.sql', 'comments/003-exports.sql', 'comments/004-authority.sql']) {
  const sql = await readFile(new URL(file, directory)); const version = assets.length + modules.length;
  modules.push({ id: `cluster-mesh-pg/${file.slice(0, -4)}@1`, file, order: version + 1, dialect: 'postgresql', mode: 'transactional',
    fromVersion: version, toVersion: version + 1, requires: [(modules.at(-1) ?? assets.at(-1)).id], schemaRole: 'comments', checksum: createHash('sha256').update(sql).digest('hex') });
}
await writeFile(new URL('comments/manifest.json', directory), `${JSON.stringify({ version: 1, assets: modules }, null, 2)}\n`);
