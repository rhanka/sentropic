// Host maintenance binding (lot E7, E8 answers): a distinct host-issued
// maintain grant/binding owns fence access/checks, consumer
// checkpoint/poison/retry, resync and snapshot maintenance. Engram's
// neutral handle stays exactly ['read','write']: maintenance through the
// memory handle is denied at runtime and by types. The durable ledger
// (candidate/store/scope/invocation mapping, envelope binding,
// reservation/terminal/ambiguous state, receipt/cursor reconciliation),
// the continuation grant (fresh host authn/authz against retained
// authority) and proof-only recovery (no second effect, unknown/foreign
// refused, empty ledger refuses) are covered here.

import { describe, it } from 'vitest';

describe('host maintenance binding', () => {
  it.todo('issues a host-only maintain binding separate from the memory handle');
  it.todo('denies maintenance operations through the neutral memory handle');
  it.todo('refuses expired, revoked or foreign-scope maintain grants');
  it.todo('checks fences and checkpoints through the host-only binding');
  it.todo('retries and poisons consumers without a second effect');
  it.todo('resyncs scope-chain-index and snapshots through maintenance ports');
  it.todo('keeps the durable ledger across reopen (rehydration re-establishes authority)');
  it.todo('refuses on an empty ledger until rehydration');
  it.todo('recovers proof-only: authorized capture-proof reads, no second effect');
});
