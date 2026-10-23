// Test-only durable-state model; no backend or provider qualification.
export type Route = 'ordinary' | 'staged' | 'projection';
export type Phase = 'intent' | 'payload' | 'page' | 'seal' | 'before-commit' | 'after-commit';
export interface Proposal {
  op: string; scope: string; incarnation: string; epoch: number;
  expected: string; root: string; value: string; route: Route;
}
export interface Receipt { op: string; root: string; serial: number }
export type Awaitable<T> = T | Promise<T>;
// Fixtures project native receipts to a per-store monotonic serial plus operation/root.
export interface PublicationClient {
  prepare(p: Proposal, crash?: Phase): Promise<string>;
  publish(id: string, crash?: Phase, beforeDecision?: () => Awaitable<void>): Promise<Receipt>;
  read(kind: 'current' | 'historical' | 'manifest', id?: string): Awaitable<string>;
  inspect(id: string): Awaitable<{ published: false; ids: string[]; value: string }>;
  receipt(op: string): Awaitable<Receipt | undefined>;
  reserved(op: string): Awaitable<{ published: false; id: string } | undefined>;
}
export type Change = 'overwrite' | 'delete' | 'retention' | 'pending';
export type Proof = 'pass' | 'missing' | 'pending' | 'wrong-tuple' | 'stale';
// Refusals: conflict, denied, checkpoint, limit, corrupt, missing proof:<claim>, legacy fenced, minimum contract, downgrade, crash:<phase>, not committed, unqualified, namespace policy, missing change capture, access denied.
// Seed aliases: scopes/units a,b; excluded; initial=old; store-1/epoch1; b/consumer; protected bytes "protected". Epochs and serials are shim projections.
export interface PublicationFixture {
  client(scope: string): PublicationClient; reopen(): PublicationFixture;
  revoke(scope: string): Awaitable<void>; fence(): Awaitable<void>;
  bind(claim: string, proof: Proof): Awaitable<void>;
  scan(limit: number): Awaitable<{ checkpoint: string; done: boolean }>;
  change(unit: string, kind: Change, valid?: boolean, capture?: boolean): Awaitable<void>;
  // The race runs before the final parity/checkpoint/delta checks and atomic marker step.
  activate(checkpoint: string, maxDelta: number, crash?: 'before' | 'after', race?: () => Awaitable<void>): Awaitable<void>;
  marker(): Awaitable<string | undefined>;
  legacy(scope: string): Record<'write' | 'publish' | 'maintain' | 'collect', () => Awaitable<void>>;
  oldOpen(): Awaitable<void>; rollback(common: boolean): Awaitable<void>;
  unit(id: string): Awaitable<string>; policy(deny: boolean): Awaitable<void>;
  legacyObject(action: 'put' | 'collect' | 'delete'): Awaitable<void>;
  protectedBytes(): Awaitable<string>; catalog(root: string): Awaitable<void>;
  effects(): Awaitable<readonly string[]>;
  counters: { effects: number; scanned: number; delta: number; legacy: number };
}
export type PublicationFactory = () => PublicationFixture;
export const proposal = (op = 'op', scope = 'a', route: Route = 'ordinary'): Proposal => ({
  op, scope, route, incarnation: 'store-1', epoch: 1,
  expected: 'initial', root: 'root-' + op, value: 'value-' + op,
});

type Pending = { p: Proposal; commitment: string; sealed: boolean; receipt?: Receipt };
export type PublicationFault = 'M04' | 'M05' | 'M05-unsealed' | 'M06' | 'M14' | 'M14-parity' | 'M14-delta' | 'M14-namespace';
type Unit = { id: string; covered: boolean; valid: boolean; visited: boolean };
type State = {
  epoch: number; roots: Map<string, string>; values: Map<string, string>; pending: Map<string, Pending>;
  revoked: Set<string>; claims: Map<string, Proof>; units: Unit[]; changes: (Unit & { kind: Change })[]; effects: string[]; sequence: number;
  token: number; captured: number; offset: number; checkpoint: string; active?: string; deny: boolean; bytes: string; catalog?: string;
  counters: PublicationFixture['counters'];
};
const key = (scope: string, id: string): string => JSON.stringify([scope, id]);
let nextStore = 0;
const fresh = (): State => ({
  epoch: 1, roots: new Map([['a', 'initial'], ['b', 'initial']]),
  values: new Map([key('a', 'initial'), key('b', 'initial')].map((id) => [id, 'old'])),
  pending: new Map(), revoked: new Set(), claims: new Map([['a/consumer', 'pass'], ['b/consumer', 'pass']]),
  units: [{ id: 'a', covered: true, valid: true, visited: false }, { id: 'b', covered: true, valid: true, visited: false },
    { id: 'excluded', covered: false, valid: false, visited: false }],
  changes: [], effects: [], sequence: 0, token: ++nextStore, captured: 0, offset: 0, checkpoint: '', deny: true, bytes: 'protected',
  counters: { effects: 0, scanned: 0, delta: 0, legacy: 0 },
});
export const createPublicationReference = (s = fresh(), fault?: PublicationFault): PublicationFixture => {
  const crashAt = (wanted: string | undefined, at: string): void => {
    if (wanted === at) throw new Error('crash:' + at);
  };
  const authority = (scope: string): void => {
    if (!s.roots.has(scope) || s.revoked.has(scope)) throw new Error('denied');
  };
  const parity = (): void => {
    if (fault === 'M14-parity') return;
    for (const [claim, proof] of s.claims) if (proof !== 'pass') throw new Error('missing proof:' + claim);
  };
  const f: PublicationFixture = {
    counters: s.counters, effects: () => [...s.effects], reopen: () => createPublicationReference(s, fault),
    revoke: (scope) => { s.revoked.add(scope); }, fence: () => { s.epoch++; },
    client(scope) {
      const owned = (id: string): Pending => {
        authority(scope);
        const pending = s.pending.get(id);
        if (!pending || pending.p.scope !== scope) throw new Error('denied');
        return pending;
      };
      return {
        async prepare(input, crash) {
          authority(scope);
          const p = { ...input }, id = key(scope, p.op);
          const commitment = JSON.stringify([p.op, p.scope, p.incarnation, p.epoch, p.expected, p.root, p.value, p.route]);
          const previous = s.pending.get(id);
          if (previous && previous.commitment !== commitment) throw new Error('conflict');
          if (previous?.receipt) return id;
          if (p.scope !== scope || p.incarnation !== 'store-1' || p.epoch !== s.epoch ||
            s.values.has(key(scope, p.root))) throw new Error('conflict');
          const pending = previous ?? { p, commitment, sealed: false };
          s.pending.set(id, pending);
          for (const phase of ['intent', 'payload', 'page', 'seal']) {
            if (phase === 'seal') pending.sealed = true;
            crashAt(crash, phase);
          }
          return id;
        },
        async publish(id, crash, beforeDecision) {
          if (fault === 'M06') s.effects.push(owned(id).p.value); else owned(id);
          await beforeDecision?.(); // The fixture controls the final authority interleave.
          const pending = owned(id), p = pending.p;
          if (pending.receipt) return { ...pending.receipt };
          if (p.epoch !== s.epoch) throw new Error('conflict');
          if ((!pending.sealed && fault !== 'M05-unsealed') || p.expected !== s.roots.get(scope) || s.values.has(key(scope, p.root))) throw new Error('conflict');
          crashAt(crash, 'before-commit');
          // One synchronous authority step: root, history, effect and original receipt.
          const receipt = { op: p.op, root: p.root, serial: ++s.counters.effects };
          s.values.set(key(scope, p.root), p.value); s.roots.set(scope, p.root);
          if (fault !== 'M06') s.effects.push(p.value);
          if (fault !== 'M05') pending.receipt = receipt;
          crashAt(crash, 'after-commit');
          pending.receipt = receipt;
          return { ...receipt };
        },
        read(kind, id) {
          authority(scope);
          const value = s.values.get(key(scope, kind === 'current' ? s.roots.get(scope)! : id ?? ''));
          if (value === undefined) { if (fault === 'M04') return owned(id ?? '').p.value; throw new Error('not committed'); }
          return value;
        },
        inspect(id) {
          const { p } = owned(id);
          return { published: false, ids: [id, p.root, 'payload:' + id, 'page:' + id, 'token:' + id], value: p.value };
        },
        receipt(op) { authority(scope); const r = s.pending.get(key(scope, op))?.receipt; return r && { ...r }; },
        reserved(op) { authority(scope); const id = key(scope, op); return s.pending.has(id) ? { published: false as const, id } : undefined; },
      };
    },
    bind: (claim, proof) => { s.claims.set(claim, proof); },
    scan(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit');
      const end = Math.min(s.units.length, s.offset + limit);
      for (; s.offset < end; s.offset++) {
        const unit = s.units[s.offset];
        if (unit.covered) { s.counters.scanned++; if (!unit.valid) throw new Error('corrupt'); unit.visited = true; }
      }
      s.checkpoint = JSON.stringify(['store-1', s.token, 'rules-1', s.offset]);
      return { checkpoint: s.checkpoint, done: s.offset === s.units.length };
    },
    change(id, kind, valid = true, capture = true) {
      const unit = s.units.find((u) => u.id === id);
      if (!unit) throw new Error('unknown unit');
      unit.valid = valid;
      s.sequence++;
      // Validity describes the resulting inventory, including deletion tombstones.
      if (capture) { s.captured++; if (unit.covered && unit.visited) s.changes.push({ ...unit, kind }); }
    },
    async activate(checkpoint, maxDelta, crash, race) {
      parity(); await race?.(); parity();
      if (s.active || checkpoint !== s.checkpoint || !checkpoint || s.offset !== s.units.length) throw new Error('checkpoint');
      if (!s.deny) throw new Error('namespace policy');
      if (s.sequence !== s.captured) throw new Error('missing change capture');
      const delta = s.changes;
      if (delta.length > maxDelta || !Number.isSafeInteger(maxDelta) || maxDelta < 0) throw new Error('limit');
      s.counters.delta += delta.length;
      if (fault !== 'M14-delta' && delta.some((u) => !u.valid)) throw new Error('corrupt delta');
      crashAt(crash, 'before');
      s.active = JSON.stringify(['common-1', 'store-1', s.epoch + 1, checkpoint, [...s.claims], 'deny-policy-1']);
      s.epoch++; crashAt(crash, 'after');
    },
    marker: () => s.active,
    legacy(scope) {
      const mutate = (kind: Change) => async (): Promise<void> => {
        authority(scope); if (s.active && fault !== 'M14') throw new Error('legacy fenced');
        s.counters.legacy++; await f.change(scope, kind);
      };
      return { write: mutate('overwrite'), publish: mutate('pending'), maintain: mutate('retention'), collect: mutate('delete') };
    },
    oldOpen() { if (s.active) throw new Error('minimum contract'); },
    rollback(common) { if (s.active && !common) throw new Error('downgrade'); },
    unit(id) {
      const unit = s.units.find((u) => u.id === id);
      if (!s.active || !unit?.covered || !unit.valid) throw new Error('unqualified');
      return unit.id;
    },
    policy: (deny) => { s.deny = deny; },
    legacyObject(action) {
      if (s.deny && fault !== 'M14-namespace') throw new Error('access denied');
      s.bytes = action === 'put' ? 'unequal' : '';
    },
    protectedBytes: () => s.bytes,
    catalog: (root) => { s.catalog = root; },
  };
  return f;
};
