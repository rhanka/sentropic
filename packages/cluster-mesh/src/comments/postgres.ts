import type { ModuleDescriptor } from '../storage/descriptor.js';
import { loadPgAssets } from '../storage/postgres/migrations.js';
import { createPostgresKernel } from '../storage/postgres/index.js';
import type { PostgresStorageOptions } from '../storage/postgres/protocol.js';
import { COMMENTS_CHAIN_KINDS } from './storage-schema.js';
import { prepareCommentsProjection } from './postgres-projections.js';
import { commentsPgQuery } from './postgres-queries.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { pinCommentsServices } from './authority.js';
import { executeCommentsLifecycle } from './lifecycle.js';
import { authorizeCommentsPurge, finalizeCommentsPurge } from './purge.js';
import type { PgInstalledOperation } from '../storage/postgres/installed-contracts.js';
import { COMMENTS_CONTRACT_DIGEST } from './contract.js';
import { COMMENTS_IMPORT_CONTRACT_DIGEST } from './import-state.js';
import { prepareCommentsImport } from './import-prepare.js';
import { inspectCommentsImport, recoverCommentsReceipts } from './import-recovery.js';
import { commentsImportPolicy } from './import-policy.js';
import { validateCommentsImportProjection } from './import-projection.js';
export { COMMENTS_CONTRACT_DIGEST } from './contract.js';
export const COMMENTS_DESCRIPTOR: ModuleDescriptor = Object.freeze({
  contractVersion: 'contract-v1', contractDigest: COMMENTS_CONTRACT_DIGEST,
  schemaVersions: Object.freeze(['pg-core-6', 'comments-projections-1', 'comments-transport-1']),
  requiredProfiles: Object.freeze(['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1', 'staged-units-v1', 'visibility-barriers-v1', 'fenced-writers-v1', 'scope-outbox-v1']),
  optionalProfiles: Object.freeze(['purge-jobs-v1']), chainKinds: Object.freeze(Object.keys(COMMENTS_CHAIN_KINDS)),
  queryNames: Object.freeze(['by-resource', 'scope-chain-index', 'retained-headers']), boundaries: Object.freeze(['scope-root', 'exact-head']),
  pageLimits: Object.freeze({ maxRecords: 100, maxEncodedBytes: 1048576 }),
});
export const createCommentsPostgresRegistration = async (options: { readonly services?: CommentsServiceOptions } = {}) => {
  const services = options.services ? pinCommentsServices(options.services) : undefined;
  const operations = Object.freeze<Record<string, PgInstalledOperation>>(services ? {
    'comments.lifecycle': { operation: 'write', execute: (input, context) => executeCommentsLifecycle(services, context, input) },
    'comments.import.prepare': { operation: 'write', execute: (input, context) => prepareCommentsImport(services, context, input) },
    'comments.import.inspect': { operation: 'write', execute: (input, context) => inspectCommentsImport(services, context, input) },
    'comments.import.recover': { operation: 'write', execute: (input, context) => recoverCommentsReceipts(services, context, input) },
  } : {});
  return Object.freeze({
  assets: await loadPgAssets({ comments: true }), descriptor: COMMENTS_DESCRIPTOR,
  projection: async (effects: Parameters<typeof prepareCommentsProjection>[0], context: Parameters<typeof prepareCommentsProjection>[1]) => {
    if (services) await validateCommentsImportProjection(services, effects, context);
    await prepareCommentsProjection(effects, context);
  },
  queries: Object.freeze({ 'by-resource': commentsPgQuery('by-resource'), 'scope-chain-index': commentsPgQuery('scope-chain-index'), 'retained-headers': commentsPgQuery('retained-headers') }),
  operations,
  stagedModules: services ? Object.freeze({ [COMMENTS_IMPORT_CONTRACT_DIGEST]: commentsImportPolicy(services) }) : undefined,
  purgeAuthorize: services ? authorizeCommentsPurge(services) : undefined, purgeFinalizer: services ? finalizeCommentsPurge(services) : undefined,
  });
};
export const createCommentsPostgresStorage = async (options: Omit<PostgresStorageOptions, 'moduleId' | 'assets' | 'descriptor' | 'projection' | 'queries' | 'operations' | 'purgeAuthorize' | 'purgeFinalizer'> & { readonly services?: CommentsServiceOptions }) => {
  const { services, ...storage } = options;
  return createPostgresKernel({ ...storage, moduleId: 'comments', ...await createCommentsPostgresRegistration({ services }) });
};
