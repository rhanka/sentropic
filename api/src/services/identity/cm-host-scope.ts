import type { PoolClient } from 'pg';
import { IdentityCustodyErrorV1, isSocialRaceRetry } from '@sentropic/cluster-mesh';

interface Scope { active: boolean; acceptingQueries: boolean; failure: unknown; inFlight: number }
const scopes = new WeakMap<PoolClient, Scope>();
const unbound = (): never => { throw new IdentityCustodyErrorV1('identity_transaction_unbound'); };

/** Read command keywords while honoring PostgreSQL's nested block comments. */
function commandPrefix(text: string): string {
  let at = 0;
  const words: string[] = [];
  while (at < text.length && words.length < 3) {
    if (/\s/.test(text[at]) || (words.length === 0 && text[at] === ';')) { at++; continue; }
    if (text.startsWith('--', at)) {
      const end = text.slice(at + 2).search(/[\r\n]/);
      at = end < 0 ? text.length : at + end + 3;
      continue;
    }
    if (text.startsWith('/*', at)) {
      let depth = 1; at += 2;
      while (at < text.length && depth) {
        if (text.startsWith('/*', at)) { depth++; at += 2; }
        else if (text.startsWith('*/', at)) { depth--; at += 2; }
        else at++;
      }
      continue;
    }
    const word = /^[A-Za-z_]+/.exec(text.slice(at))?.[0];
    if (!word) break;
    words.push(word); at += word.length;
  }
  return words.join(' ');
}

/** A fresh capability over the same real driver connection; no independent transaction. */
export function createCmScopedHostClient(client: PoolClient) {
  const scope: Scope = { active: true, acceptingQueries: true, failure: undefined, inFlight: 0 };
  const remember = (error: unknown) => { if (scope.failure === undefined) scope.failure = error; };
  const reject = (): never => {
    const error = new IdentityCustodyErrorV1('identity_transaction_unbound');
    if (scope.active && scope.acceptingQueries) remember(error);
    throw error;
  };
  const check = () => {
    if (!scope.active || !scope.acceptingQueries) reject();
    if (scope.failure !== undefined) throw scope.failure;
  };
  const scoped = new Proxy(client, {
    get(target, property) {
      if (property === 'release' || property === 'end' || property === 'connect') return reject;
      if (property === 'query') return (...supplied: unknown[]) => {
        check();
        const args = [...supplied], first = args[0];
        const text = typeof first === 'string' ? first : first && typeof first === 'object' && 'text' in first ? first.text : '';
        if (typeof text !== 'string' || /^(?:BEGIN|START|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE)\b|^PREPARE TRANSACTION\b|^SET (?:(?:LOCAL|SESSION) )?TRANSACTION\b/i.test(commandPrefix(text))) return reject();
        // Parse exactly one statement before execution; a hidden second COMMIT must never run.
        args[0] = { ...(typeof first === 'string' ? { text: first } : first as object), queryMode: 'extended' };
        scope.inFlight += 1;
        let finished = false;
        const finish = (error?: unknown) => {
          if (finished) return;
          finished = true; scope.inFlight -= 1;
          if (error !== undefined && error !== null) remember(error);
        };
        const callback = args.at(-1);
        if (typeof callback === 'function') args[args.length - 1] = (...values: unknown[]) => {
          finish(values[0]);
          return Reflect.apply(callback, undefined, values);
        };
        try {
          const result = Reflect.apply(target.query, target, args);
          if (result && typeof result.then === 'function') return result.then(
            (value: unknown) => { finish(); return value; },
            (error: unknown) => { finish(error); throw error; },
          );
          if (typeof callback !== 'function') { finish(); return reject(); }
          return result;
        } catch (error) { finish(error); throw error; }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  scopes.set(scoped, scope);
  return { client: scoped,
    seal() {
      check();
      if (scope.failure !== undefined) throw scope.failure;
      if (scope.inFlight !== 0) reject();
      scope.acceptingQueries = false;
    },
    assertCommitted() { if (scope.failure !== undefined) throw scope.failure; },
    expire() { scope.active = false; scope.acceptingQueries = false; scope.failure = undefined; },
  };
}

export const assertCmHostHealthy = (client: PoolClient): void => {
  const scope = scopes.get(client);
  if (!scope) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  if (!scope.active || !scope.acceptingQueries) unbound();
  if (scope.failure !== undefined) throw scope.failure;
};

/** Share one transaction scope with a derived host handle (same connection, no new capability). */
export const aliasCmHostScope = (client: PoolClient, alias: PoolClient): void => {
  const scope = scopes.get(client);
  if (scope) scopes.set(alias, scope);
};

/** Retained handlers may catch a port error; the callback must still roll back or restart. */
export function createCmPortFailureFence(client: PoolClient) {
  const copies = new WeakMap<object, object>();
  const fail = (error: unknown): never => {
    const scope = scopes.get(client);
    if (!scope?.active || !scope.acceptingQueries) return unbound();
    // Whole-callback retry signals are control instructions, never failures: the scoped
    // wrapper may already have remembered the raw driver error, but the signal must reach
    // the unit of work untouched so the callback restarts instead of surfacing raw SQL.
    if (isSocialRaceRetry(error)) throw error;
    if (scope.failure === undefined) scope.failure = error;
    throw scope.failure;
  };
  const capture = <T extends object>(port: T): T => {
    const existing = copies.get(port);
    if (existing) return existing as T;
    // A separate facade also supports frozen port objects without Proxy invariant violations.
    const facade = new Proxy(Object.create(null) as T, {
      ownKeys: () => Reflect.ownKeys(port),
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
      get(_target, key) {
        const value = Reflect.get(port, key, port);
        if (typeof value === 'function') return (...args: unknown[]) => {
          assertCmHostHealthy(client);
          try {
            const result = Reflect.apply(value, port, args);
            return result && typeof result.then === 'function' ? result.then(undefined, fail) : result;
          } catch (error) { return fail(error); }
        };
        return value && typeof value === 'object' && !Array.isArray(value) ? capture(value) : value;
      },
    });
    copies.set(port, facade); copies.set(facade, facade);
    return facade;
  };
  return capture;
}
