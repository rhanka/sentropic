import { describe, expect, it } from 'vitest';

import { createInMemoryPendingFederationStore } from '../../../src/services/auth/federation/pending-store';

/**
 * BR-39e Lot 2 — the pending-federation store (email-challenge handoff, D9). It mirrors the flow-state
 * single-use + TTL discipline: a pointer resolves at most once and never after expiry.
 */

const NOW = new Date('2026-07-11T00:00:00.000Z');
const record = { continuation: null, provider: 'github', providerSubject: 'gh-1', providerTenant: null };

describe('pending federation store (BR-39e Lot 2)', () => {
  it('resolves a stashed pending identity by its opaque pointer', () => {
    const store = createInMemoryPendingFederationStore();
    const id = store.put(record, new Date(NOW.getTime() + 60_000));
    expect(id).not.toBe('gh-1'); // opaque, not the subject
    expect(store.consume(id, NOW)).toMatchObject({ provider: 'github', providerSubject: 'gh-1' });
  });

  it('is single-use — a second consume returns null', () => {
    const store = createInMemoryPendingFederationStore();
    const id = store.put(record, new Date(NOW.getTime() + 60_000));
    expect(store.consume(id, NOW)).not.toBeNull();
    expect(store.consume(id, NOW)).toBeNull();
  });

  it('never resolves an expired pointer (and still deletes it)', () => {
    const store = createInMemoryPendingFederationStore();
    const id = store.put(record, new Date(NOW.getTime() - 1));
    expect(store.consume(id, NOW)).toBeNull();
    expect(store.consume(id, NOW)).toBeNull();
  });

  it('returns null for an unknown pointer', () => {
    const store = createInMemoryPendingFederationStore();
    expect(store.consume('does-not-exist', NOW)).toBeNull();
  });
});
