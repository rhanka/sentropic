// r6 §6 L3-J/L3-A: the admitted broker. Routes come only from the injected qualified
// operation→model map; historical Luna examples and retired IDs confer no authority.
import { createHash, verify as ed25519Verify, type KeyObject } from 'node:crypto';
import { appendFile, open, readFile } from 'node:fs/promises';
import { ensure } from './seat-admission.ts';

export const RETIRED_MODELS = ['gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14'];
export const HISTORICAL_MODELS = ['gpt-6-luna', 'gpt-5.6-luna'];
export const NANO_MODEL = 'gpt-5.4-nano';
export const NANO_CUTOFF = '2027-04-01T00:00:00Z';
export const DEFAULT_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

export type OperationModels = Record<string, string>;

export function assertQualifiedModel(model: unknown, operationModels: OperationModels, operation: string, now: number): string {
  ensure(typeof model === 'string' && model.length > 0, 'model-missing');
  if (RETIRED_MODELS.includes(model)) throw new Error('model-retired');
  if (HISTORICAL_MODELS.includes(model)) throw new Error('model-historical-no-route-authority');
  if (model === NANO_MODEL && now >= Date.parse(NANO_CUTOFF)) throw new Error('model-cutoff');
  const qualified = operationModels[operation];
  ensure(typeof qualified === 'string' && qualified === model, 'model-not-qualified-route');
  return model;
}

export type JournalRecord = { requestId: string; ticketDigest: string; at: number };

// Append-only, fsync-before-send, per-line integrity journal. A forged or tampered
// line refuses the whole load; a replayed requestId refuses the send.
export class BrokerJournal {
  records: JournalRecord[] = [];
  private constructor(private file: string, private syncFailure: () => boolean) {}

  static async create(file: string, syncFailure: () => boolean = () => false): Promise<BrokerJournal> {
    const journal = new BrokerJournal(file, syncFailure);
    let text = '';
    try { text = await readFile(file, 'utf8'); } catch { /* genesis */ }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let entry: { record: JournalRecord; lineDigest: string };
      try { entry = JSON.parse(line); } catch { throw new Error('journal-corrupt'); }
      const recordJson = JSON.stringify(entry.record);
      if (createHash('sha256').update(recordJson).digest('hex') !== entry.lineDigest) throw new Error('journal-corrupt');
      journal.records.push(entry.record);
    }
    if (new Set(journal.records.map(r => r.requestId)).size !== journal.records.length) throw new Error('journal-corrupt');
    return journal;
  }

  async append(record: JournalRecord): Promise<void> {
    ensure(!this.records.some(r => r.requestId === record.requestId), 'journal-replay');
    ensure(/^[0-9a-f]{64}$/.test(record.ticketDigest), 'journal-digest');
    if (this.syncFailure()) throw new Error('journal-fsync');
    const recordJson = JSON.stringify(record);
    const line = JSON.stringify({ record, lineDigest: createHash('sha256').update(recordJson).digest('hex') }) + '\n';
    const fh = await open(this.file, 'a');
    try {
      await fh.appendFile(line);
      await fh.sync();
    } finally {
      await fh.close();
    }
    this.records.push(record);
  }
}

export type BrokerTicketClaims = {
  version: number; purpose: string; caseId: string; route: string;
  binding: Record<string, string>; runId: string; runAttempt: number;
  reservation: string; generation: number; operations: Record<string, string>;
  attempts: number; deadline: number;
};

export type BrokerRequest = {
  ticket: string; requestId: string; operation: string;
  url: string; method: string; headers: Record<string, string>; body: string;
};

export type BrokerOpts = {
  publicKey: KeyObject; binding: Record<string, string>; runId: string; runAttempt: number;
  reservation: { id: string; units: number; generation: number; day: string };
  journal: BrokerJournal; qualified: boolean; billing: boolean; expiresAt: number;
  quota: () => Promise<{ observedAt: number; remaining: number[]; generation: number }>;
  send: (url: string, options: unknown) => Promise<Response>;
  accessToken: string; accountId: string;
  operationModels: OperationModels;
  endpoint?: string; now?: () => number;
};

export class SeatBroker {
  private unitsLeft: number;
  private endpoint: string;
  private now: () => number;
  constructor(private opts: BrokerOpts) {
    const now = (opts.now ?? Date.now)();
    ensure(opts.qualified && opts.billing, 'broker-not-qualified');
    ensure(opts.expiresAt > now, 'broker-expired');
    ensure(Number.isSafeInteger(opts.reservation.units) && opts.reservation.units > 0, 'reservation-units');
    this.unitsLeft = opts.reservation.units;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.now = opts.now ?? Date.now;
  }

  private verifyTicket(ticket: string): BrokerTicketClaims {
    const parts = ticket.split('.');
    ensure(parts.length === 2, 'ticket-forged');
    let ok = false;
    try {
      ok = ed25519Verify(null, Buffer.from(parts[0]), this.opts.publicKey, Buffer.from(parts[1], 'base64url'));
    } catch { ok = false; }
    ensure(ok, 'ticket-forged');
    let claims: BrokerTicketClaims;
    try { claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new Error('ticket-forged'); }
    ensure(claims.version === 1 && claims.purpose === 'ci-test', 'ticket-forged');
    return claims;
  }

  async submit(req: BrokerRequest): Promise<Response> {
    const now = this.now();
    const claims = this.verifyTicket(req.ticket);
    for (const [key, value] of Object.entries(this.opts.binding)) {
      ensure(claims.binding?.[key] === value, `binding-mismatch:${key}`);
    }
    ensure(claims.runId === this.opts.runId && claims.runAttempt === this.opts.runAttempt, 'run-mismatch');
    ensure(claims.reservation === this.opts.reservation.id && claims.generation === this.opts.reservation.generation, 'reservation-mismatch');
    ensure(Number.isSafeInteger(claims.deadline) && claims.deadline > now, 'deadline-past');
    ensure(req.operation === 'chat' && typeof claims.operations?.chat === 'string', 'operation-unsupported');
    ensure(req.url === this.endpoint && !/refresh/i.test(req.url), 'endpoint-refused');
    ensure(req.headers.authorization === `Bearer ${this.opts.accessToken}`, 'token-stolen-refused');
    let body: { model?: unknown };
    try { body = JSON.parse(req.body); } catch { throw new Error('body-parse'); }
    assertQualifiedModel(body.model, this.opts.operationModels, req.operation, now);
    ensure(claims.operations.chat === body.model, 'ticket-body-model-mismatch');
    const quota = await this.opts.quota();
    ensure(quota.generation === this.opts.reservation.generation, 'quota-generation-stale');
    ensure(quota.remaining.length > 0 && quota.remaining[0] > 0, 'quota-exhausted');
    ensure(this.unitsLeft > 0, 'exhausted');
    // fsync'd debit precedes any upstream send; replay and fsync failure send nothing.
    await this.opts.journal.append({
      requestId: req.requestId,
      ticketDigest: createHash('sha256').update(req.ticket).digest('hex'),
      at: now,
    });
    this.unitsLeft -= 1;
    return this.opts.send(req.url, { method: req.method, headers: req.headers, body: req.body });
  }
}
