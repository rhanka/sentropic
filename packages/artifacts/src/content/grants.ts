/**
 * L-5d — content grants and activation tickets (spec-v8 §9 5d).
 *
 * Short signed grants authorize content reads on the separate content
 * domain: 55-second grant TTL inside a 60-second total cutoff budget
 * (grant + skew/propagation). Grants are HMAC-SHA256 signed with a
 * host-injected secret, bound to subject + artifact (+ pinned release),
 * and verified fail-closed (signature, shape, lifetime cap, expiry,
 * future-issued beyond the skew budget). Activation tickets are
 * single-use and bound the same way; ticket IDs come from an injected
 * port and MUST be unguessable (default: crypto UUIDs). A grant never
 * replaces the per-request ACL recheck in the content handler.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CONTENT_GRANT_TTL_SECONDS = 55;
export const CONTENT_CUTOFF_BUDGET_SECONDS = 60;
export const CONTENT_TICKET_TTL_SECONDS = 120;
const SKEW_MS = (CONTENT_CUTOFF_BUDGET_SECONDS - CONTENT_GRANT_TTL_SECONDS) * 1000;

export interface ContentGrantClaims {
  subjectId: string;
  artifactId: string;
  releaseId?: string;
  scope: 'read';
  issuedAt: number;
  expiresAt: number;
}

export interface GrantIssueInput {
  subjectId: string;
  artifactId: string;
  releaseId?: string;
}

export interface GrantSigner {
  issue(input: GrantIssueInput): string;
  verify(token: string): ContentGrantClaims;
}

function encodeClaims(claims: ContentGrantClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
}

function sign(secret: Uint8Array, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

/** Create an HMAC grant signer over an injected secret and clock. */
export function createHmacGrantSigner(options: {
  secret: string | Uint8Array;
  clock?: () => number;
  ttlSeconds?: number;
}): GrantSigner {
  const secret = typeof options.secret === 'string'
    ? new TextEncoder().encode(options.secret)
    : options.secret;
  if (secret.length === 0) throw new Error('invalid grant signer: empty secret');
  const clock = options.clock ?? (() => Date.now());
  const ttlMs = (options.ttlSeconds ?? CONTENT_GRANT_TTL_SECONDS) * 1000;
  return {
    issue(input: GrantIssueInput): string {
      if (input.subjectId.length === 0 || input.artifactId.length === 0) {
        throw new Error('invalid grant: empty subject or artifact');
      }
      const issuedAt = clock();
      const claims: ContentGrantClaims = {
        subjectId: input.subjectId,
        artifactId: input.artifactId,
        ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
        scope: 'read',
        issuedAt,
        expiresAt: issuedAt + ttlMs,
      };
      const payload = encodeClaims(claims);
      return `${payload}.${sign(secret, payload)}`;
    },
    verify(token: string): ContentGrantClaims {
      const parts = token.split('.');
      if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
        throw new Error('invalid grant: malformed token');
      }
      const expected = Buffer.from(sign(secret, parts[0]), 'utf8');
      const actual = Buffer.from(parts[1], 'utf8');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        throw new Error('invalid grant: signature mismatch');
      }
      let claims: ContentGrantClaims;
      try {
        claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as ContentGrantClaims;
      } catch {
        throw new Error('invalid grant: malformed claims');
      }
      if (
        typeof claims.subjectId !== 'string' || claims.subjectId.length === 0 ||
        typeof claims.artifactId !== 'string' || claims.artifactId.length === 0 ||
        claims.scope !== 'read' ||
        !Number.isFinite(claims.issuedAt) || !Number.isFinite(claims.expiresAt) ||
        claims.expiresAt <= claims.issuedAt ||
        claims.expiresAt - claims.issuedAt > CONTENT_GRANT_TTL_SECONDS * 1000
      ) {
        throw new Error('invalid grant: malformed claims');
      }
      const now = clock();
      if (claims.issuedAt > now + SKEW_MS) throw new Error('invalid grant: issued in the future');
      if (now > claims.expiresAt) throw new Error('grant expired');
      return claims;
    },
  };
}

export interface TicketRecord {
  ticketId: string;
  subjectId: string;
  artifactId: string;
  releaseId?: string;
  expiresAt: number;
}

export interface TicketStore {
  put(record: TicketRecord): Promise<void>;
  peek(ticketId: string): Promise<TicketRecord | undefined>;
  /** Atomically remove and return the record (single-use consumption). */
  take(ticketId: string): Promise<TicketRecord | undefined>;
  remove(ticketId: string): Promise<void>;
}

/** In-memory TicketStore double for unit tests. */
export function createMemoryTicketStore(): TicketStore {
  const tickets = new Map<string, TicketRecord>();
  return {
    put(record) { tickets.set(record.ticketId, record); return Promise.resolve(); },
    peek(ticketId) { return Promise.resolve(tickets.get(ticketId)); },
    take(ticketId) {
      const record = tickets.get(ticketId);
      tickets.delete(ticketId);
      return Promise.resolve(record);
    },
    remove(ticketId) { tickets.delete(ticketId); return Promise.resolve(); },
  };
}

export interface TicketService {
  issue(input: GrantIssueInput): Promise<{ ticketId: string; expiresAt: number }>;
  redeem(
    ticketId: string,
    expected: { subjectId: string; artifactId: string },
  ): Promise<TicketRecord>;
}

/** Single-use bound tickets; mismatched attempts do not consume the ticket. */
export function createTicketService(options: {
  store: TicketStore;
  clock?: () => number;
  ids?: () => string;
  ttlSeconds?: number;
}): TicketService {
  const clock = options.clock ?? (() => Date.now());
  const ids = options.ids ?? (() => crypto.randomUUID());
  const ttlMs = (options.ttlSeconds ?? CONTENT_TICKET_TTL_SECONDS) * 1000;
  return {
    async issue(input) {
      const ticketId = ids();
      const expiresAt = clock() + ttlMs;
      await options.store.put({
        ticketId,
        subjectId: input.subjectId,
        artifactId: input.artifactId,
        ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
        expiresAt,
      });
      return { ticketId, expiresAt };
    },
    async redeem(ticketId, expected) {
      const record = await options.store.peek(ticketId);
      if (record === undefined) throw new Error('invalid ticket');
      if (clock() > record.expiresAt) {
        await options.store.remove(ticketId);
        throw new Error('ticket expired');
      }
      if (record.subjectId !== expected.subjectId || record.artifactId !== expected.artifactId) {
        throw new Error('invalid ticket: binding mismatch');
      }
      const taken = await options.store.take(ticketId);
      if (taken === undefined) throw new Error('invalid ticket');
      return taken;
    },
  };
}
