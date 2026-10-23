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
