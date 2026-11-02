// r6 §4.3.1 fixed durable state store: CustodyStateV1 in security-seat-writer only,
// two reusable 16-segment banks plus a HEAD pointer published last, fenced by SeatStateFenceV1.
import { createHash, randomUUID } from 'node:crypto';
import { SEAT_STATE_HEAD, MAX_SLOTS } from './seat-workflow-contract.ts';
import { SyntheticEnvironmentApi, sealSecret } from './seat-environment-custody.ts';

export const STATE_SCHEMA_VERSION = 1;
export const WRITER_ENV = 'security-seat-writer';
export const ENVELOPE_LIMIT_BYTES = 40 * 1024;
export const CHUNK_LIMIT_BYTES = 24 * 1024;
export const HEAD_LIMIT_BYTES = 8 * 1024;
export const MAX_SEGMENTS = 16;
export const MAX_STATE_SECRETS = 33;
export const AGGREGATE_LIMIT_BYTES = 1_318_912;
export const DECODED_LIMIT_BYTES = 384 * 1024;
export const FENCE_MAX_RESERVATIONS = 128;
export const FENCE_LIMIT_BYTES = 16 * 1024;

export const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

export type Reservation = {
  ref: string; family: string; credentialGeneration: number;
  capacity: number; held: number; status: 'active' | 'fenced';
  // ACT-L06a additive fields: day/cli/accountRef bind the reservation to its
  // admission cycle for cap accounting; settled marks a once-only settlement.
  day?: string; cli?: string; accountRef?: string; settled?: boolean;
};

export type RosterEntryV1 = {
  account: string; cli: string; slot: string;
  // ACT-L06a additive fields (r4 §3.1 roster records): provider, display name,
  // alias references, quota/refresh family refs and the removal tombstone flag.
  provider?: string; displayName?: string; aliases?: string[];
  quotaFamilyRef?: string; refreshFamilyRef?: string; tombstoned?: boolean;
};

export type AdmissionV1 = { reviewInputKey: string; accountRef: string; reservationRef: string; outcome: string };
export type SkipV1 = { code: string; accountRef: string; provider: string; at: string };

export type CustodyStateV1 = {
  schemaVersion: 1; storeEpoch: number; generation: number; transactionSeq: number; allocationSeq: number;
  priorCommittedGeneration: number; rosterRevision: number;
  roster: RosterEntryV1[];
  tombstones: string[]; routeQualifications: unknown[]; cursors: Record<string, number>;
  refreshIntents: string[]; reservations: Reservation[];
  // ACT-L06a additive durable fields (r4 §3.1: admissions and refusal skips persist).
  admissions: AdmissionV1[]; skips: SkipV1[];
  accounting: { authorized: number; held: number; spent: number; released: number };
  counters: { day: Record<string, number>; fleet: number };
  journals: { transactionId: string; outcome: string }[]; uncertainty: string[];
};

export type HeadPointer = {
  schemaVersion: 1; storeEpoch: number; generation: number; transactionId: string; bank: 'A' | 'B';
  segmentCount: number; totalBytes: number; chunkDigests: string[]; stateDigest: string;
  previousCommittedGeneration: number; writerRunId: string; writerRunAttempt: number;
};

export class InterruptedAt extends Error {
  point: string;
  constructor(point: string) { super(`interrupted:${point}`); this.name = 'InterruptedAt'; this.point = point; }
}

export function makeGenesisState(overrides: Partial<CustodyStateV1> = {}): CustodyStateV1 {
  return {
    schemaVersion: STATE_SCHEMA_VERSION, storeEpoch: 1, generation: 1, transactionSeq: 1, allocationSeq: 0,
    priorCommittedGeneration: 0, rosterRevision: 0,
    roster: [], tombstones: [], routeQualifications: [], cursors: {}, refreshIntents: [],
    reservations: [], admissions: [], skips: [],
    accounting: { authorized: 0, held: 0, spent: 0, released: 0 },
    counters: { day: {}, fleet: 0 }, journals: [], uncertainty: [],
    ...overrides,
  };
}

export function serializeState(state: CustodyStateV1): Buffer {
  return Buffer.from(JSON.stringify(state), 'utf8');
}

export function validateState(s: unknown): CustodyStateV1 {
  const state = s as CustodyStateV1;
  if (!state || state.schemaVersion !== STATE_SCHEMA_VERSION) throw new Error('schema-version');
  if (!Number.isSafeInteger(state.storeEpoch) || state.storeEpoch < 1) throw new Error('store-epoch');
  if (!Number.isSafeInteger(state.generation) || state.generation < 1) throw new Error('generation');
  if (!Number.isSafeInteger(state.priorCommittedGeneration) || state.priorCommittedGeneration >= state.generation) {
    throw new Error('prior-generation');
  }
  if (!Array.isArray(state.roster) || state.roster.length > MAX_SLOTS) throw new Error('slot-limit');
  const slots = new Set(state.roster.map(r => r.slot));
  if (slots.size !== state.roster.length) throw new Error('slot-duplicate');
  if (!Array.isArray(state.reservations)) throw new Error('reservations');
  const refs = new Set<string>();
  for (const r of state.reservations) {
    if (refs.has(r.ref)) throw new Error('reservation-duplicate');
    refs.add(r.ref);
    if (r.status !== 'active' && r.status !== 'fenced') throw new Error('reservation-status');
    if (!(r.capacity >= r.held && r.held >= 0)) throw new Error('reservation-capacity');
  }
  const a = state.accounting;
  if (!(a.authorized === a.held + a.spent + a.released)) throw new Error('conservation');
  const heldSum = state.reservations.reduce((n, r) => n + r.held, 0);
  if (heldSum > a.held) throw new Error('conservation-held');
  // ACT-L06a: durable admissions/refusal skips (r4 §3.1) validate additively.
  const admissions = state.admissions ?? [];
  const skips = state.skips ?? [];
  if (!Array.isArray(admissions) || !Array.isArray(skips)) throw new Error('admissions-skips');
  if (new Set(admissions.map(x => x?.reviewInputKey)).size !== admissions.length) throw new Error('admission-duplicate');
  for (const s of skips) if (!s || typeof s.code !== 'string' || s.code.length === 0) throw new Error('skip-shape');
  for (const e of state.roster) if (e.provider !== undefined && typeof e.provider !== 'string') throw new Error('roster-provider');
  if (serializeState(state).length > DECODED_LIMIT_BYTES) throw new Error('decoded-limit');
  return state;
}

export function chunkBuffer(buf: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buf.length || chunks.length === 0; offset += CHUNK_LIMIT_BYTES) {
    chunks.push(buf.subarray(offset, offset + CHUNK_LIMIT_BYTES));
    if (chunks.length > MAX_SEGMENTS) throw new Error('segment-limit');
    if (offset + CHUNK_LIMIT_BYTES >= buf.length) break;
  }
  return chunks;
}

export function buildEnvelope(opts: {
  storeEpoch: number; generation: number; transactionId: string; bank: 'A' | 'B';
  index: number; count: number; stateDigest: string; chunk: Buffer;
}): string {
  const envelope = {
    schemaVersion: STATE_SCHEMA_VERSION, storeEpoch: opts.storeEpoch, generation: opts.generation,
    transactionId: opts.transactionId, bank: opts.bank, index: opts.index, count: opts.count,
    stateDigest: opts.stateDigest, chunkDigest: sha256hex(opts.chunk), chunk: opts.chunk.toString('base64'),
  };
  const text = JSON.stringify(envelope);
  if (Buffer.byteLength(text) > ENVELOPE_LIMIT_BYTES) throw new Error('envelope-limit');
  return text;
}

export function buildHead(opts: Omit<HeadPointer, 'schemaVersion'>): string {
  const text = JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, ...opts });
  if (Buffer.byteLength(text) > HEAD_LIMIT_BYTES) throw new Error('head-limit');
  return text;
}

export function parseHead(text: string): HeadPointer {
  if (Buffer.byteLength(text) > HEAD_LIMIT_BYTES) throw new Error('head-limit');
  let head: HeadPointer;
  try { head = JSON.parse(text) as HeadPointer; } catch { throw new Error('head-parse'); }
  if (head.schemaVersion !== STATE_SCHEMA_VERSION) throw new Error('schema-version');
  if (head.bank !== 'A' && head.bank !== 'B') throw new Error('head-bank');
  if (!Number.isSafeInteger(head.segmentCount) || head.segmentCount < 1 || head.segmentCount > MAX_SEGMENTS) {
    throw new Error('segment-count');
  }
  if (!Number.isSafeInteger(head.totalBytes) || head.totalBytes > DECODED_LIMIT_BYTES) throw new Error('decoded-limit');
  if (!Array.isArray(head.chunkDigests) || head.chunkDigests.length !== head.segmentCount
    || head.chunkDigests.some(d => !/^[0-9a-f]{64}$/.test(d))) throw new Error('segment-count');
  return head;
}

export function validateAggregate(bankBytes: number, headBytes: number): true {
  if (bankBytes + headBytes > AGGREGATE_LIMIT_BYTES) throw new Error('aggregate-limit');
  return true;
}

// Test helper: seal and PUT a raw JSON object into a writer state name.
export const sealForTest = Object.assign(
  async (api: SyntheticEnvironmentApi, runId: string, name: string, obj: unknown): Promise<void> => {
    const key = await api.publicKey(WRITER_ENV);
    await api.putSealed(WRITER_ENV, name, sealSecret(key, JSON.stringify(obj)), {
      runId, runAttempt: 1, repository: api.repository,
    });
  },
  { seal: sealSecret },
);

export class SeatStateFenceV1 {
  committedSeq = 0;
  highWater = 0;
  pending: { transactionId: string; nextSeq: number; phase: string; writerRunId: string } | null = null;
  reservations = new Map<string, { family: string; credentialGeneration: number; status: 'active' | 'fenced' }>();
  storeEpoch: number;
  constructor(opts: { storeEpoch: number }) { this.storeEpoch = opts.storeEpoch; }

  genesis(seq: number): void {
    if (this.pending) throw new Error('pending-exists');
    this.committedSeq = seq;
    this.highWater = seq;
  }

  casReserve(transactionId: string, writerRunId: string): number {
    if (this.pending) throw new Error('pending-exists');
    const nextSeq = this.committedSeq + 1;
    this.pending = { transactionId, nextSeq, phase: 'intent', writerRunId };
    return nextSeq;
  }

  phase(phase: string): void {
    if (!this.pending) throw new Error('no-pending');
    this.pending.phase = phase;
  }

  cancel(transactionId: string): void {
    if (this.pending?.transactionId !== transactionId) throw new Error('pending-mismatch');
    this.pending = null;
  }

  commit(transactionId: string): void {
    if (!this.pending || this.pending.transactionId !== transactionId) throw new Error('pending-mismatch');
    if (this.committedSeq >= this.pending.nextSeq) throw new Error('commit-twice');
    this.committedSeq = this.pending.nextSeq;
    this.highWater = Math.max(this.highWater, this.committedSeq);
    this.pending = null;
  }

  checkGeneration(generation: number): void {
    if (generation < this.highWater) throw new Error('stale-high-water');
    if (this.pending && generation > this.highWater) throw new Error('fenced-pending');
  }

  fenceFamily(family: string | 'all'): void {
    for (const r of this.reservations.values()) if (family === 'all' || r.family === family) r.status = 'fenced';
  }

  project(): string {
    if (this.reservations.size > FENCE_MAX_RESERVATIONS) throw new Error('fence-reservation-limit');
    const projection = {
      schemaVersion: STATE_SCHEMA_VERSION, storeEpoch: this.storeEpoch,
      committedSeq: this.committedSeq, highWater: this.highWater, pending: this.pending,
      reservations: [...this.reservations.entries()].map(([ref, r]) => ({ ref, ...r })),
    };
    const text = JSON.stringify(projection);
    if (Buffer.byteLength(text) > FENCE_LIMIT_BYTES) throw new Error('fence-limit');
    return text;
  }
}

export type TxInput = {
  transactionId?: string;
  mutate: (state: CustodyStateV1) => CustodyStateV1;
  interruptAt?: string;
  rotate?: { cli: string; slot: string };
  impact?: string[] | 'unknown';
};

export type TxResult = {
  trace: string[]; committed: boolean; generation: number; transactionId: string;
  queuedRunId?: string; resumed?: boolean;
};

const segName = (bank: 'A' | 'B', index: number) => `SEAT_STATE_${bank}_${String(index).padStart(2, '0')}`;

export class CustodyStateStore {
  private api: SyntheticEnvironmentApi;
  private fence: SeatStateFenceV1;
  constructor(api: SyntheticEnvironmentApi, fence: SeatStateFenceV1) { this.api = api; this.fence = fence; }

  async readHead(runId: string): Promise<HeadPointer> {
    return parseHead(await this.api.readSecret(WRITER_ENV, SEAT_STATE_HEAD, runId));
  }

  async readCommitted(runId: string): Promise<CustodyStateV1> {
    const head = await this.readHead(runId);
    const chunks: Buffer[] = [];
    for (let i = 0; i < head.segmentCount; i++) {
      const raw = await this.api.readSecret(WRITER_ENV, segName(head.bank, i), runId);
      if (Buffer.byteLength(raw) > ENVELOPE_LIMIT_BYTES) throw new Error('envelope-limit');
      let envelope: ReturnType<typeof JSON.parse>;
      try { envelope = JSON.parse(raw); } catch { throw new Error('envelope-parse'); }
      if (envelope.schemaVersion !== STATE_SCHEMA_VERSION || envelope.storeEpoch !== head.storeEpoch
        || envelope.generation !== head.generation || envelope.transactionId !== head.transactionId
        || envelope.bank !== head.bank || envelope.index !== i || envelope.count !== head.segmentCount) {
        throw new Error('mixed-generation-segment');
      }
      if (envelope.stateDigest !== head.stateDigest || envelope.chunkDigest !== head.chunkDigests[i]) {
        throw new Error('segment-digest-mismatch');
      }
      const chunk = Buffer.from(envelope.chunk, 'base64');
      if (chunk.length > CHUNK_LIMIT_BYTES) throw new Error('chunk-limit');
      if (sha256hex(chunk) !== envelope.chunkDigest) throw new Error('chunk-digest-mismatch');
      chunks.push(chunk);
    }
    const full = Buffer.concat(chunks);
    if (full.length > DECODED_LIMIT_BYTES || full.length !== head.totalBytes) throw new Error('decoded-limit');
    if (sha256hex(full) !== head.stateDigest) throw new Error('state-digest-mismatch');
    const state = validateState(JSON.parse(full.toString('utf8')));
    if (state.generation !== head.generation || state.storeEpoch !== head.storeEpoch) throw new Error('generation-mismatch');
    return state;
  }

  private async writeBank(bank: 'A' | 'B', opts: {
    transactionId: string; state: CustodyStateV1; runId: string; runAttempt: number; interruptAt?: string;
  }): Promise<HeadPointer> {
    const serialized = serializeState(opts.state);
    if (serialized.length > DECODED_LIMIT_BYTES) throw new Error('decoded-limit');
    const chunks = chunkBuffer(serialized);
    const stateDigest = sha256hex(serialized);
    const key = await this.api.publicKey(WRITER_ENV);
    const ctx = { runId: opts.runId, runAttempt: opts.runAttempt, repository: this.api.repository };
    for (let i = 0; i < chunks.length; i++) {
      const text = buildEnvelope({
        storeEpoch: opts.state.storeEpoch, generation: opts.state.generation, transactionId: opts.transactionId,
        bank, index: i, count: chunks.length, stateDigest, chunk: chunks[i],
      });
      await this.api.putSealed(WRITER_ENV, segName(bank, i), sealSecret(key, text), ctx);
      if (opts.interruptAt === `after-segment:${i}`) throw new InterruptedAt(`after-segment:${i}`);
    }
    if (opts.interruptAt === 'before-head') throw new InterruptedAt('before-head');
    const headText = buildHead({
      storeEpoch: opts.state.storeEpoch, generation: opts.state.generation, transactionId: opts.transactionId,
      bank, segmentCount: chunks.length, totalBytes: serialized.length,
      chunkDigests: chunks.map(c => sha256hex(c)), stateDigest,
      previousCommittedGeneration: opts.state.priorCommittedGeneration,
      writerRunId: opts.runId, writerRunAttempt: opts.runAttempt,
    });
    await this.api.putSealed(WRITER_ENV, SEAT_STATE_HEAD, sealSecret(key, headText), ctx);
    if (opts.interruptAt === 'after-head') throw new InterruptedAt('after-head');
    return parseHead(headText);
  }

  // Separately reviewed storeEpoch genesis under global off; never auto-created.
  async initialize(state: CustodyStateV1, runId: string, runAttempt: number): Promise<HeadPointer> {
    const existing = await this.api.readSecret(WRITER_ENV, SEAT_STATE_HEAD, runId).catch(() => null);
    if (existing !== null) throw new Error('already-initialized');
    validateState(state);
    if (state.generation !== 1) throw new Error('genesis-generation');
    return this.writeBank('A', { transactionId: 'genesis', state, runId, runAttempt });
  }

  async writeNext(opts: {
    transactionId: string; next: CustodyStateV1; runId: string; runAttempt: number; interruptAt?: string;
  }): Promise<HeadPointer> {
    if (this.fence.pending?.transactionId !== opts.transactionId) throw new Error('not-pending-owner');
    const head = await this.readHead(opts.runId);
    if (head.generation < this.fence.highWater) throw new Error('stale-high-water');
    const nextGen = this.fence.highWater + 1;
    if (head.generation !== this.fence.highWater
      && !(head.generation === nextGen && head.transactionId === opts.transactionId)) {
      throw new Error('uncommitted-head');
    }
    const current = await this.readCommitted(opts.runId);
    if (opts.next.storeEpoch !== this.fence.storeEpoch) throw new Error('store-epoch-mismatch');
    if (opts.next.generation !== nextGen) throw new Error('generation-mismatch');
    if (opts.next.priorCommittedGeneration !== current.generation) throw new Error('prior-generation-mismatch');
    validateState(opts.next);
    const bank: 'A' | 'B' = head.bank === 'A' ? 'B' : 'A';
    const headProbe = await this.writeBank(bank, {
      transactionId: opts.transactionId, state: opts.next, runId: opts.runId, runAttempt: opts.runAttempt,
      interruptAt: opts.interruptAt,
    });
    validateAggregate(head.totalBytes + serializeState(opts.next).length, Buffer.byteLength(JSON.stringify(headProbe)));
    return headProbe;
  }

  async executeTransaction(input: TxInput): Promise<TxResult> {
    const trace: string[] = [];
    const transactionId = input.transactionId ?? randomUUID();
    const run1 = await this.api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
    const headNow = await this.readHead(run1.runId);
    if (headNow.transactionId === transactionId && this.fence.pending === null) {
      return { trace: ['resumed-committed'], committed: true, generation: headNow.generation, transactionId, resumed: true };
    }
    const resuming = this.fence.pending?.transactionId === transactionId;
    if (!resuming) this.fence.casReserve(transactionId, run1.runId);
    trace.push('state-intent');
    if (input.interruptAt === 'after-fence-cas') throw new InterruptedAt('after-fence-cas');

    let next: CustodyStateV1;
    let nextHead: HeadPointer;
    const alreadyWritten = resuming && headNow.generation === this.fence.highWater + 1 && headNow.transactionId === transactionId;
    if (alreadyWritten) {
      nextHead = headNow;
      next = await this.readCommitted(run1.runId);
    } else {
      const base = await this.readCommitted(run1.runId);
      next = input.mutate(structuredClone(base));
      next.transactionSeq = base.transactionSeq + 1;
      next.journals = [...base.journals, { transactionId, outcome: 'pending' }];
      nextHead = await this.writeNext({
        transactionId, next, runId: run1.runId, runAttempt: 1, interruptAt: input.interruptAt,
      });
    }
    trace.push('state-write-allocate');

    if (input.rotate) {
      const cli = input.rotate.cli.toUpperCase();
      const canonicalName = `SEAT_${cli}_${input.rotate.slot}`;
      const projectionName = `SEAT_USE_${cli}_${input.rotate.slot}`;
      const mk = await this.api.publicKey('security-seat-maintenance');
      await this.api.putSealed('security-seat-maintenance', canonicalName,
        sealSecret(mk, `canonical-${input.rotate.cli}-${input.rotate.slot}`),
        { runId: run1.runId, runAttempt: 1, repository: this.api.repository });
      const nk = await this.api.publicKey('security-nightly');
      await this.api.putSealed('security-nightly', projectionName,
        sealSecret(nk, `projection-${input.rotate.cli}-${input.rotate.slot}`),
        { runId: run1.runId, runAttempt: 1, repository: this.api.repository });
    }

    if (input.interruptAt === 'before-queue') throw new InterruptedAt('before-queue');
    const run2 = await this.api.queueWorkflow({ workflowId: 'security-seat-verify.yml', ref: 'refs/heads/main' });
    trace.push('seat-continuation-dispatch');
    if (input.interruptAt === 'after-queue') throw new InterruptedAt('after-queue');

    if (input.interruptAt === 'before-verify') throw new InterruptedAt('before-verify');
    const verified = await this.readCommitted(run2.runId);
    if (verified.generation !== nextHead.generation) throw new Error('verify-generation-mismatch');
    trace.push('state-verify');
    if (input.interruptAt === 'after-verify') throw new InterruptedAt('after-verify');

    if (input.rotate) {
      const cli = input.rotate.cli.toUpperCase();
      const c = await this.api.readSecret('security-seat-maintenance', `SEAT_${cli}_${input.rotate.slot}`, run2.runId);
      const p = await this.api.readSecret('security-nightly', `SEAT_USE_${cli}_${input.rotate.slot}`, run2.runId);
      if (c !== `canonical-${input.rotate.cli}-${input.rotate.slot}`
        || p !== `projection-${input.rotate.cli}-${input.rotate.slot}`) throw new Error('readback-mismatch');
    }
    trace.push('verify-canonical', 'verify-projection');

    if (input.interruptAt === 'before-commit') throw new InterruptedAt('before-commit');
    this.fence.commit(transactionId);
    trace.push('state-commit');
    if (input.interruptAt === 'after-commit') throw new InterruptedAt('after-commit');

    if (input.interruptAt === 'before-dispatch') throw new InterruptedAt('before-dispatch');
    await this.api.queueWorkflow({ workflowId: 'security-seat-continuation.yml', ref: 'refs/heads/main' });
    trace.push('continuation-dispatch');
    if (input.interruptAt === 'after-dispatch') throw new InterruptedAt('after-dispatch');

    for (const r of next.reservations) {
      this.fence.reservations.set(r.ref, { family: r.family, credentialGeneration: r.credentialGeneration, status: r.status });
    }
    if (input.impact === 'unknown') this.fence.fenceFamily('all');
    else if (input.impact) for (const f of input.impact) this.fence.fenceFamily(f);

    return { trace, committed: true, generation: nextHead.generation, transactionId, queuedRunId: run2.runId };
  }
}
