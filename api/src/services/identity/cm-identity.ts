// Lot A4: app-side composition of the cluster-mesh identity domains over the
// app's own PostgreSQL. One schema (`cm_identity`) hosts every CM identity
// table (A2.1 core + A2.0b custody bundle in `identity_*`, A2.2 tenancy and
// A2.3 enforcement in `cm_*`). The DDL itself lands through the single control
// migration `api/drizzle/control/0014_app_cm_identity_cutover.sql`; this module
// only binds the frozen factories to the app pool. No dual writer: after the
// cutover every app identity read/write goes through this module.

import {
  applyPostgresIdentityCoreSchema,
  applyPostgresIdentitySchema,
  createAtomicPersonDeletionV2,
  createFreshDecisionProducer,
  createIdentityEnforcementPostgresStores,
  createInMemoryDivergenceMetrics,
  createPostgresCustodyStores,
  createPostgresIdentityCoreStores,
  createPostgresIdentityHostV1,
  createPostgresIdentityStores,
  createPostgresIdentityUnitOfWorkV1,
  createTenantMemberships,
  createTenantOAuth,
  createTenantRegistry,
  createTenantResolver,
  createTidIssuer,
  createWorkspaceDirectory,
  identityEnforcementPgSchema,
  type BusinessDeletionPortV1,
  type CustodyOpHost,
  type DecisionToolCatalog,
  type IdentityUnitOfWorkV1,
  type PostgresCustodyHandle,
  type PostgresStoreClient,
} from '@sentropic/cluster-mesh';
import type { InjectedPgDriver, PgSession, PgTransactionOptions } from '@sentropic/cluster-mesh/storage/postgres';

import { pool } from '../../db/client';
import { currentCmIdentityTransaction, type CmIdentityTransaction } from './cm-transaction';

export const CM_IDENTITY_SCHEMA = 'cm_identity';

/** Adapts the app pg pool to the frozen `InjectedPgDriver` protocol. */
const pgDriver: InjectedPgDriver = {
  async transaction<T>(options: PgTransactionOptions, operation: (session: PgSession) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      if (options.readOnly) await client.query('SET TRANSACTION READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${String(Math.max(1, Math.floor(options.deadlineMs)))}`);
      const session: PgSession = {
        execute: async (statement) => {
          const result = await client.query(statement.text, (statement.values ?? []) as unknown[]);
          return { rows: result.rows as readonly Record<string, unknown>[], rowCount: result.rowCount };
        },
      };
      const value = await operation(session);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection already broken; the original error is the signal
      }
      throw error;
    } finally {
      client.release();
    }
  },
};

const storeClient: PostgresStoreClient = {
  query: (text, values) => (currentCmIdentityTransaction()?.hostTransaction ?? pool)
    .query(text, [...values ?? []]),
};

/** Raw access for app-side reads/writes that are not part of the frozen CM
 *  store surface (e.g. business projections joined with CM identity rows). */
export const cmStoreClient = storeClient;
export const cmPgDriver = pgDriver;

/** In-process divergence metrics for the transition tooling (F12). */
const divergenceMetrics = createInMemoryDivergenceMetrics();

const core = createPostgresIdentityCoreStores({ driver: pgDriver, schema: CM_IDENTITY_SCHEMA });
const custody = createPostgresCustodyStores({ driver: pgDriver, schema: CM_IDENTITY_SCHEMA });
const host = createPostgresIdentityHostV1({ driver: pgDriver, schema: CM_IDENTITY_SCHEMA });
const unitOfWork: IdentityUnitOfWorkV1<PostgresCustodyHandle> = createPostgresIdentityUnitOfWorkV1({
  schema: CM_IDENTITY_SCHEMA,
  host,
});
const tenancy = createPostgresIdentityStores(storeClient, { schema: CM_IDENTITY_SCHEMA });
const enforcement = createIdentityEnforcementPostgresStores({ driver: pgDriver, schema: CM_IDENTITY_SCHEMA });

export interface CmIdentityComposition {
  readonly schema: string;
  readonly driver: InjectedPgDriver;
  readonly core: ReturnType<typeof createPostgresIdentityCoreStores>;
  readonly custody: ReturnType<typeof createPostgresCustodyStores>;
  readonly unitOfWork: IdentityUnitOfWorkV1<PostgresCustodyHandle>;
  readonly tenancy: ReturnType<typeof createPostgresIdentityStores>;
  readonly enforcement: ReturnType<typeof createIdentityEnforcementPostgresStores>;
  readonly tenants: ReturnType<typeof createTenantRegistry>;
  readonly memberships: ReturnType<typeof createTenantMemberships>;
  readonly workspaces: ReturnType<typeof createWorkspaceDirectory>;
  readonly resolver: ReturnType<typeof createTenantResolver>;
  readonly tid: ReturnType<typeof createTidIssuer>;
  readonly oauth: ReturnType<typeof createTenantOAuth>;
  readonly decision: ReturnType<typeof createFreshDecisionProducer>;
  createDeletion(business: BusinessDeletionPortV1<CustodyOpHost>): ReturnType<typeof createAtomicPersonDeletionV2>;
}

/** Idempotent DDL guard for environments where the control migration has not
 *  run yet (unit tests with a bare pool). Production always runs 0014 first. */
export const ensureCmIdentitySchema = async (): Promise<void> => {
  await applyPostgresIdentityCoreSchema({ driver: pgDriver, schema: CM_IDENTITY_SCHEMA });
  await applyPostgresIdentitySchema(storeClient, { schema: CM_IDENTITY_SCHEMA });
  await pgDriver.transaction(
    { isolation: 'serializable', readOnly: false, deadlineMs: 30_000 },
    async (session) => {
      await session.execute({ text: `CREATE SCHEMA IF NOT EXISTS "${CM_IDENTITY_SCHEMA}"`, values: [] });
      for (const ddl of identityEnforcementPgSchema(CM_IDENTITY_SCHEMA)) {
        await session.execute({ text: ddl, values: [] });
      }
    },
  );
};

export const createCmIdentityComposition = (catalog: DecisionToolCatalog): CmIdentityComposition => {
  const tenants = createTenantRegistry({
    tenants: tenancy.tenants,
    memberships: tenancy.memberships,
    sessions: core.sessions,
    audit: core.audit,
  });
  const memberships = createTenantMemberships({
    memberships: tenancy.memberships,
    tenants: tenancy.tenants,
    audit: core.audit,
  });
  const workspaces = createWorkspaceDirectory({
    workspaces: tenancy.workspaces,
    members: tenancy.workspaceMembers,
    audit: core.audit,
  });
  const resolver = createTenantResolver({
    workspaces: tenancy.workspaces,
    tenants: tenancy.tenants,
    memberships: tenancy.memberships,
    metrics: divergenceMetrics,
  });
  const tid = createTidIssuer({ memberships: tenancy.memberships, tenants: tenancy.tenants });
  const oauth = createTenantOAuth({ oauth: tenancy.oauth });
  const decision = createFreshDecisionProducer({
    accounts: core.accounts,
    sessions: core.sessions,
    tenants: tenancy.tenants,
    memberships: tenancy.memberships,
    workspaces: tenancy.workspaces,
    workspaceMembers: tenancy.workspaceMembers,
    conversations: enforcement.conversations,
    catalog,
  });
  const deletion = (business: BusinessDeletionPortV1<CustodyOpHost>) =>
    createAtomicPersonDeletionV2({ unitOfWork, business });
  return {
    schema: CM_IDENTITY_SCHEMA,
    driver: pgDriver,
    core,
    custody,
    unitOfWork,
    tenancy,
    enforcement,
    tenants,
    memberships,
    workspaces,
    resolver,
    tid,
    oauth,
    decision,
    createDeletion: deletion,
  };
};

let composition: CmIdentityComposition | undefined;
let catalogHolder: DecisionToolCatalog | null = null;

/** Installed once by the catalog service at boot; the F15 producer maps an
 *  allowed decision to the allowed tool set through it. */
export const setCmDecisionToolCatalog = (catalog: DecisionToolCatalog): void => {
  catalogHolder = catalog;
};

const lazyCatalog: DecisionToolCatalog = {
  toolsForDecision: (decision) => catalogHolder?.toolsForDecision(decision) ?? [],
};

/** Process-wide composition (no legacy fallback: every app identity read/write
 *  goes through this module after the A4 cutover). */
export const getCmIdentity = (): CmIdentityComposition => {
  const tx = currentCmIdentityTransaction();
  if (tx) return composeCmTransaction(tx);
  composition ??= createCmIdentityComposition(lazyCatalog);
  return composition;
};

/** Per-attempt domains use the combined r6 stores, never a root-pool adapter. */
const composeCmTransaction = (tx: CmIdentityTransaction): CmIdentityComposition => {
  const core = { accounts: tx.stores.accounts, proofs: tx.stores.proofs,
    invitations: tx.stores.invitations, deviceCodes: tx.stores.deviceCodes,
    sessions: tx.stores.sessions, audit: tx.stores.audit };
  const tenancy = { tenants: tx.stores.tenants, memberships: tx.stores.memberships,
    workspaces: tx.stores.workspaces, workspaceMembers: tx.stores.workspaceMembers, oauth: tx.stores.oauth };
  return {
    ...createCmIdentityComposition(lazyCatalog), core, custody: tx.custody, tenancy,
    enforcement: { conversations: tx.conversations, ledger: tx.ledger },
    tenants: createTenantRegistry({ ...core, ...tenancy }),
    memberships: createTenantMemberships({ ...tenancy, audit: tx.stores.audit }),
    workspaces: createWorkspaceDirectory({ ...tenancy, members: tenancy.workspaceMembers, audit: tx.stores.audit }),
    resolver: createTenantResolver({ ...tenancy, metrics: divergenceMetrics }),
    tid: createTidIssuer(tenancy), oauth: createTenantOAuth({ oauth: tenancy.oauth }),
    decision: createFreshDecisionProducer({ ...core, ...tenancy, conversations: tx.conversations, catalog: lazyCatalog }),
  };
};
