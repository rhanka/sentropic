import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalRecordBytes, RECORD_KINDS } from '@sentropic/comments';
import { chainIdentity, decodeRecord, selectionForRecord, validateRecordHash } from '../src/comments/storage-schema.js';
describe('packaged frozen comments hash vectors', () => {
  it('preserves canonical bytes/hashes and typed identities for all eleven kinds', async () => {
    const vectors = JSON.parse(await readFile(new URL('../assets/storage/comments/oracle/revision-hash-v1.json', import.meta.url), 'utf8'));
    expect([...new Set(vectors.records.map((vector) => vector.kind))].sort()).toEqual([...RECORD_KINDS].sort());
    for (const vector of vectors.records) {
      expect(canonicalRecordBytes(vector.kind, vector.envelope), vector.id).toBe(vector.canonical);
      const record = { kind: vector.kind, ...vector.envelope, hash: vector.digest }; validateRecordHash(record);
      expect(decodeRecord(canonicalJson(record), vector.digest), vector.id).toEqual(record);
      expect(chainIdentity(selectionForRecord(record)).kind).toBe(vector.kind);
    }
  });
});
