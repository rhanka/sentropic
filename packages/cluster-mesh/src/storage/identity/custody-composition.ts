import type { IdentityTransactionV1 } from '../../identity-contracts/custody.js';
import type { CustodyOpHost } from './custody-host.js';
import type { PgSession, InjectedPgDriver, SqlValue } from '../postgres/protocol.js';
import type { SqliteConnection } from '../sqlite/connection.js';
import { createPostgresIdentityCoreStores } from './postgres.js';
import { createSqliteIdentityCoreStores } from './sqlite.js';
import { createPostgresIdentityStores } from '../../identity-stores/tenancy-postgres.js';
import { createSqliteIdentityStores } from '../../identity-stores/tenancy-sqlite.js';
import { createIdentityEnforcementPostgresStores } from '../../identity/postgres.js';
import { createIdentityEnforcementSqliteStores } from '../../identity/sqlite.js';
import { transactionOperationPorts } from './custody-transaction-ports.js';
import { registerIdentityTransaction } from './custody-transaction-guards.js';

export const composeIdentityTransaction = <H extends CustodyOpHost>(input: {
  readonly host: H; readonly transactionId: string; readonly readOnly: boolean;
  readonly check: (write?: boolean) => void;
}): IdentityTransactionV1<H> => {
  const { host, check } = input;
  const sqlPorts = transactionOperationPorts(host, () => check(true));
  const schema = host.schema ?? '';
  const session = host.raw as PgSession;
  const connection = host.raw as SqliteConnection;
  const driver: InjectedPgDriver = { transaction: async (options, operation) => { check(!options.readOnly); return operation(session); } };
  const core = host.profile === 'postgres'
    ? createPostgresIdentityCoreStores({ driver, schema, boundSession: session })
    : createSqliteIdentityCoreStores({ connection, transactionBound: true });
  const tenancy = host.profile === 'postgres'
    ? createPostgresIdentityStores({ query: (text, values) => session.execute({ text, values: (values ?? []) as readonly SqlValue[] }) }, { schema })
    : createSqliteIdentityStores(connection);
  const enforcement = host.profile === 'postgres'
    ? createIdentityEnforcementPostgresStores({ driver, schema })
    : createIdentityEnforcementSqliteStores({ db: connection, transactionBound: true });
  return registerIdentityTransaction({
    profile: host.profile, transactionId: input.transactionId, mode: input.readOnly ? 'read' : 'write',
    hostTransaction: host, stores: { ...core, ...tenancy, audit: enforcement.ledger },
    custody: host.stores, ...enforcement, ...sqlPorts,
  }, check, host);
};
