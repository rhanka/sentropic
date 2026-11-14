import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fencedReceipt,parseOriginalRehearsal } from './t3-rehearsal.mjs';
import { qualifiedReceipt } from './t3-rehearsal.test.mjs';
const { z } = createRequire(process.env.T3_ZOD_PACKAGE)('zod');
const source = readFileSync(new URL('../../../api/src/scripts/cm-preprod-contract.ts',import.meta.url),'utf8');
const statement = name => {
  const start = source.indexOf(`const ${name} = `), end = source.indexOf('\n',start);
  assert.ok(start >= 0); return source.slice(start,end);
};
const object = name => {
  const start = source.indexOf(`const ${name} = `), end = source.indexOf('}).strict();',start);
  assert.ok(start >= 0 && end > start); return source.slice(start,end+12);
};
// Execute the exact W6 schema declarations, without importing DB/configuration side effects.
const schema = new Function('z',`${statement('digest')}\n${statement('ref')}\n${object('requestFields')}\n${object('rehearsalSchema')}\nreturn rehearsalSchema;`)(z);
const original = qualifiedReceipt();
assert.deepEqual(parseOriginalRehearsal(original),schema.parse(original));
const fenced = fencedReceipt(original,{ ...original,sourceContentSha256: 'e'.repeat(64) },
  { allowedChanges: ['sourceContentSha256'],reviewRef: 'track:fenced-review' });
assert.deepEqual(parseOriginalRehearsal(fenced),schema.parse(fenced));
for (const key of Object.keys(original)) {
  const missing = { ...original }; delete missing[key];
  assert.equal(schema.safeParse(missing).success,false,key);
  assert.throws(() => parseOriginalRehearsal(missing),key);
}
for (const patch of [{ extra: true },{ isolatedRestoreRef: 'pending' },{ restoredBackupSha256: 'bad' }]) {
  assert.equal(schema.safeParse({ ...original,...patch }).success,false);
  assert.throws(() => parseOriginalRehearsal({ ...original,...patch }));
}
for (const key of ['candidateCommit','candidateImage','restoredBackupSha256',...Object.keys(original).filter(k => k.endsWith('Sha256') || k === 'remoteSnapshotDigest')]) {
  const malformed = { ...original,[key]: [original[key]] };
  assert.equal(schema.safeParse(malformed).success,false,key);
  assert.throws(() => parseOriginalRehearsal(malformed),key);
}
console.log('PASS: complete original and fenced receipts accepted by the actual W6 Zod schema; all missing fields refused before fence');
