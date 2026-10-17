import type { ModuleDescriptor } from '../storage/descriptor.js';
import { loadPgAssets } from '../storage/postgres/migrations.js';
import { createPostgresKernel } from '../storage/postgres/index.js';
import type { PostgresStorageOptions } from '../storage/postgres/protocol.js';
import { COMMENTS_CHAIN_KINDS } from './storage-schema.js';
import { prepareCommentsProjection } from './postgres-projections.js';
import { commentsPgQuery } from './postgres-queries.js';
export const COMMENTS_CONTRACT_DIGEST = 'e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0';
export const COMMENTS_DESCRIPTOR: ModuleDescriptor = Object.freeze({
  contractVersion: 'contract-v1', contractDigest: COMMENTS_CONTRACT_DIGEST,
  schemaVersions: Object.freeze(['pg-core-5', 'comments-projections-1']),
  requiredProfiles: Object.freeze(['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1', 'staged-units-v1', 'visibility-barriers-v1', 'fenced-writers-v1', 'scope-outbox-v1']),
  optionalProfiles: Object.freeze(['purge-jobs-v1']), chainKinds: Object.freeze(Object.keys(COMMENTS_CHAIN_KINDS)),
  queryNames: Object.freeze(['by-resource', 'scope-chain-index', 'retained-headers']), boundaries: Object.freeze(['scope-root', 'exact-head']),
  pageLimits: Object.freeze({ maxRecords: 100, maxEncodedBytes: 1048576 }),
});
export const createCommentsPostgresRegistration = async () => Object.freeze({
  assets: await loadPgAssets({ comments: true }), descriptor: COMMENTS_DESCRIPTOR, projection: prepareCommentsProjection,
  queries: Object.freeze({ 'by-resource': commentsPgQuery('by-resource'), 'scope-chain-index': commentsPgQuery('scope-chain-index'), 'retained-headers': commentsPgQuery('retained-headers') }),
});
export const createCommentsPostgresStorage = async (options: Omit<PostgresStorageOptions, 'moduleId' | 'assets' | 'descriptor' | 'projection' | 'queries'>) =>
  createPostgresKernel({ ...options, moduleId: 'comments', ...await createCommentsPostgresRegistration() });
