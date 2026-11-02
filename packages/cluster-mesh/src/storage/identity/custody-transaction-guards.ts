import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import type { IdentityRunOptionsV1 } from '../../identity-contracts/custody.js';
import type { PgSession } from '../postgres/protocol.js';
import type { SqliteConnection } from '../sqlite/connection.js';

export const requireIdentityRunOptions = (options: IdentityRunOptionsV1): void => {
  if (!['read', 'write'].includes(options.mode) || !['request', 'import', 'delete', 'delivery'].includes(options.purpose)) {
    throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  }
  if (!Number.isSafeInteger(options.deadlineMs) || options.deadlineMs <= 0 || ![1, 2, 3].includes(options.maxAttempts)) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
};

export const identityTransactionGuard = (readOnly: boolean, deadline: number) => {
  let active = true;
  const check = (write = false): void => {
    if (!active || Date.now() >= deadline || (write && readOnly)) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  };
  const sql = (text: string): void => check(!/^\s*SELECT\b/i.test(text) || /\bFOR\s+UPDATE\b/i.test(text));
  return {
    check, close: () => { active = false; },
    postgres: (session: PgSession): PgSession => ({ execute: async (statement) => { sql(statement.text); return session.execute(statement); } }),
    sqlite: (connection: SqliteConnection): SqliteConnection => ({
      ownerPid: connection.ownerPid,
      exec: (text) => { sql(text); connection.exec(text); },
      prepare: (text) => {
        check();
        const statement = connection.prepare(text);
        return {
          all: (...values) => { sql(text); return Reflect.apply(statement.all, statement, values); },
          get: (...values) => { sql(text); return Reflect.apply(statement.get, statement, values); },
          run: (...values) => { check(true); return Reflect.apply(statement.run, statement, values); },
        };
      },
      close: () => { throw new IdentityCustodyErrorV1('identity_transaction_unbound'); },
      function: () => { throw new IdentityCustodyErrorV1('identity_transaction_unbound'); },
    }),
  };
};
