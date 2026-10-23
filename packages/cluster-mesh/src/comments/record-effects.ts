import { canonicalJson } from '@sentropic/comments';
import type { CanonicalChainRecord, CanonicalReadSelection } from '@sentropic/comments';
import type { AtomicUnit } from '../storage/atomic.js';
import { emptyEffects } from '../storage/staged-preparation.js';
import { canonicalRecordKey, chainIdentity } from './storage-schema.js';
import { commentsRelationships } from './relationships.js';
export const commentsRecordEffects = (
  selection: CanonicalReadSelection,
  record: CanonicalChainRecord,
  previousHash: string | null,
): AtomicUnit => {
  const chain = chainIdentity(selection).key;
  const key = canonicalRecordKey(chain, record.hash);
  const bytes = canonicalJson(record);
  return {
    ...emptyEffects(),
    relationships: commentsRelationships(record, chain, key),
    records: [{ key, contentHash: record.hash, bytes: { format: 'utf8', data: bytes } }],
    appends: [
      {
        chainId: chain,
        record: { id: record.hash, hash: record.hash, bytes },
        expectation: previousHash === null ? { kind: 'absent', allocation: '0' } : { kind: 'head', hash: previousHash },
      },
    ],
  };
};
