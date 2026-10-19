import { AsyncLocalStorage } from 'node:async_hooks';
import type { VerifiedMcpRequest } from './stateful-contracts.js';

// Same request-local pattern as #689; this mode never installs a subject-token store.
export const combineMcpSignals = (signals: AbortSignal[]): AbortSignal =>
  (AbortSignal as typeof AbortSignal & { any(values: AbortSignal[]): AbortSignal }).any(signals);

function frozenJson(value: unknown, active = new Set<object>(), depth = 0): unknown {
  if (depth > 64) throw new TypeError('Invalid verified attributes');
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value !== 'object' || value === null || active.has(value)
    || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) {
    throw new TypeError('Invalid verified attributes');
  }
  active.add(value);
  const entries = Object.entries(value).map(([key, child]) => {
    if (/^(authorization|access_?token|refresh_?token|subject_?token|bearer)$/i.test(key)) {
      throw new TypeError('Credentials are forbidden in verified attributes');
    }
    return [key, frozenJson(child, active, depth + 1)] as const;
  });
  active.delete(value);
  return Object.freeze(Array.isArray(value) ? entries.map(([, child]) => child) : Object.fromEntries(entries));
}

/** One authority store per composer; never attach the most recent caller to a session. */
export function createStatefulAuthority(verifiedClaimNames: readonly string[]) {
  const storage = new AsyncLocalStorage<VerifiedMcpRequest>();
  const labels = new Set(verifiedClaimNames);
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
  return {
    current: () => storage.getStore(),
    async run<T>(authority: VerifiedMcpRequest, next: () => Promise<T>): Promise<T> {
      const p = authority?.principal;
      if (!p || !text(p.issuer) || !text(p.sub) || !text(authority.resource)
        || !text(authority.correlationId) || !(authority.signal instanceof AbortSignal)
        || !strings(p.scopes) || !strings(p.claims) || p.claims.some(label => !labels.has(label))
        || (p.clientId !== undefined && !text(p.clientId)) || (p.tid !== undefined && !text(p.tid))
        || typeof p.attributes !== 'object' || p.attributes === null || Array.isArray(p.attributes)) {
        throw new TypeError('Invalid verified MCP request');
      }
      const snapshot: VerifiedMcpRequest = Object.freeze({
        principal: Object.freeze({
          issuer: p.issuer, sub: p.sub,
          ...(p.clientId === undefined ? {} : { clientId: p.clientId }),
          ...(p.tid === undefined ? {} : { tid: p.tid }),
          scopes: Object.freeze([...p.scopes]), claims: Object.freeze([...p.claims]),
          attributes: frozenJson(p.attributes) as Readonly<Record<string, unknown>>,
        }),
        resource: authority.resource, correlationId: authority.correlationId, signal: authority.signal,
      });
      snapshot.signal.throwIfAborted();
      return storage.run(snapshot, next);
    },
  };
}
