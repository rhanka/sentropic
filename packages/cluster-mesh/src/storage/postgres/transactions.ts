import { decodePgText } from './codec.js';
import { classifyPgFailure, PostgresStorageError } from './errors.js';
import type { InjectedPgDriver, PgBudgets, PgSession, SqlStatement } from './protocol.js';
import { StorageInvalidCommandError } from '../errors.js';

// Frozen specification candidate values. These are finite defaults, not a
// latency/throughput qualification or a whole-history admission ceiling.
export const DEFAULT_PG_BUDGETS: PgBudgets = Object.freeze({
  lockWaitMs: 250,
  statementMs: 1500,
  idleMs: 1000,
  flushMs: 2000,
  attempts: 3,
});
/**
 * Driver-level timeout guard (G-P1). `PgTransactions.run` applies its
 * `SET LOCAL` timeouts only inside its own callback — but wrappers stacked
 * between `driver.transaction` and that callback (the E4 ownership
 * retained-session renew/verify) would otherwise run with the server
 * defaults (all timeouts disabled) and hang until the flush deadline
 * destroys the connection. Setting the three wait timeouts right after
 * BEGIN covers every statement of the transaction, including wrapper
 * pre-work; `run` keeps its own (idempotent) application afterwards.
 */
export const withPgTxTimeouts = (driver: InjectedPgDriver, budgets: PgBudgets): InjectedPgDriver => ({
  transaction: async <T>(
    options: Parameters<InjectedPgDriver['transaction']>[0],
    operation: (session: PgSession) => Promise<T>,
  ): Promise<T> =>
    driver.transaction(options, async (session) => {
      await session.execute({
        text: `SELECT set_config('lock_timeout', $1, true),
          set_config('statement_timeout', $2, true),
          set_config('idle_in_transaction_session_timeout', $3, true)`,
        values: [`${budgets.lockWaitMs}ms`, `${budgets.statementMs}ms`, `${budgets.idleMs}ms`],
      });
      return operation(session);
    }),
});

export class PgTransactions {
  readonly budgets: PgBudgets;
  constructor(
    private readonly driver: InjectedPgDriver,
    budgets: Partial<PgBudgets> = {},
  ) {
    this.budgets = Object.freeze({ ...DEFAULT_PG_BUDGETS, ...budgets });
    if (
      !driver ||
      typeof driver.transaction !== 'function' ||
      Object.values(this.budgets).some((value) => !Number.isSafeInteger(value) || value <= 0)
    ) {
      throw new StorageInvalidCommandError('invalid injected Postgres transaction policy');
    }
  }
  async run<T>(readOnly: boolean, operation: (session: PgSession) => Promise<T>, immutableFlush = false): Promise<T> {
    const deadline = Date.now() + this.budgets.flushMs;
    for (let attempt = 1; ; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new PostgresStorageError('timeout');
      try {
        return await this.driver.transaction(
          { isolation: 'serializable', readOnly, deadlineMs: remaining },
          async (raw) => {
            if (!raw || typeof raw.execute !== 'function') throw new PostgresStorageError('configuration');
            let closed = false;
            const session: PgSession = Object.freeze({
              execute: async (statement: SqlStatement) => {
                if (closed || Date.now() >= deadline) throw new PostgresStorageError('timeout');
                const result = await raw.execute(statement);
                if (Date.now() >= deadline) throw new PostgresStorageError('timeout');
                return result;
              },
            });
            try {
              const settings = await session.execute({ text: 'SHOW synchronous_commit', values: [] });
              const durability = decodePgText(settings.rows[0]?.synchronous_commit);
              if (!['on', 'remote_apply', 'off', 'local', 'remote_write'].includes(durability))
                throw new PostgresStorageError('configuration');
              if (durability !== 'on' && durability !== 'remote_apply')
                await session.execute({ text: "SET LOCAL synchronous_commit = 'on'", values: [] });
              await session.execute({
                text: `SELECT set_config('TimeZone', $1, true), set_config('DateStyle', $2, true),
                  set_config('lock_timeout', $3, true), set_config('statement_timeout', $4, true),
                  set_config('idle_in_transaction_session_timeout', $5, true)`,
                values: [
                  'UTC',
                  'ISO, YMD',
                  `${this.budgets.lockWaitMs}ms`,
                  `${this.budgets.statementMs}ms`,
                  `${this.budgets.idleMs}ms`,
                ],
              });
              return await operation(session);
            } finally {
              closed = true;
            }
          },
        );
      } catch (error) {
        const mapped = classifyPgFailure(error);
        if (mapped !== error) Object.defineProperty(mapped, 'cause', { value: error, configurable: true });
        if (
          !immutableFlush ||
          !(mapped instanceof PostgresStorageError) ||
          !mapped.retryable ||
          attempt >= this.budgets.attempts ||
          Date.now() >= deadline
        )
          throw mapped;
      }
    }
  }
}
