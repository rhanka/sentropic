import { randomBytes } from 'node:crypto';

/**
 * BR-39e Lot 2 — the server-side PENDING-federation store for the email-verification challenge (D9).
 *
 * When a GitHub login yields no usable verified email, NO user/identity row is written; instead the
 * pending provider identity (`provider` + `providerSubject`) is stashed HERE and referenced by an
 * opaque id carried in a bound `HttpOnly; Secure; SameSite=Lax` cookie, exactly like the flow-state
 * pointer (D5). After the user proves an email locally (magic-link / email code), the completion route
 * dereferences the pointer, verify-and-DELETES it (single-use + TTL), and finishes via the broker.
 *
 * It holds ONLY {provider, subject, tenant, continuation-pointer} — never a user row, never a token.
 * The default implementation is in-memory (single-writer auth-idp process); a durable adapter can
 * replace it later behind the same interface without touching the routes or the broker.
 */

export interface PendingFederationRecord {
  provider: string;
  providerSubject: string;
  providerTenant: string | null;
  /** The sealed OAuth continuation pointer captured at the original callback (D11), or null. */
  continuation: string | null;
  expiresAt: Date;
}

export interface PendingFederationStore {
  /** Stash a pending identity; returns the opaque pointer id for the bound cookie. */
  put(record: Omit<PendingFederationRecord, 'expiresAt'>, expiresAt: Date): string;
  /** Verify-and-DELETE by id (single-use + TTL); `null` if missing / expired / already consumed. */
  consume(id: string, now: Date): PendingFederationRecord | null;
}

export const createInMemoryPendingFederationStore = (): PendingFederationStore => {
  const records = new Map<string, PendingFederationRecord>();

  return {
    consume(id, now) {
      const record = records.get(id);
      if (!record) return null;
      // Single-use: always delete on lookup so a replay of a still-valid id cannot be reused.
      records.delete(id);
      if (record.expiresAt <= now) return null; // TTL: expired never resolves.
      return record;
    },
    put(record, expiresAt) {
      const id = randomBytes(32).toString('base64url');
      records.set(id, { ...record, expiresAt });
      return id;
    },
  };
};

/** Process-wide singleton used by the federation routes. */
export const pendingFederationStore: PendingFederationStore = createInMemoryPendingFederationStore();
