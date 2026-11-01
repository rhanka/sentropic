// T6-P1 (r6 §7.3, §4.3.3; §6.4 row L9-F destination C/seat-public-execution.test.ts):
// per-provider public-execution disposition before first seat admission in the public
// rhanka/sentropic repository. Accepts only an explicit C1 D0.3 public-repository
// extension or current explicit provider proof; private-only, other-provider, expired
// or generic same-repo consent fails before any inference. A9 linkage is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitPublicExecution, validateDisposition, A9_RECORD, PUBLIC_REPOSITORY } from '../src/seat-public-execution.ts';

const NOW = Date.parse('2026-11-02T06:45:00Z');
const ctx = { provider: 'openai', route: 'chat:gpt-6-astra', client: 'CODEX', model: 'gpt-6-astra', now: NOW };

const base = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, kind: 'c1-d0-3-public-extension', provider: 'openai',
  route: 'chat:gpt-6-astra', client: 'CODEX', model: 'gpt-6-astra',
  publicRepository: PUBLIC_REPOSITORY,
  privateToPublicChange: 'execution moves to the public rhanka/sentropic repository; workflow logs and artifacts become public',
  evidenceDate: '2026-11-01T00:00:00Z', evidenceDigest: 'a'.repeat(64),
  validUntil: '2026-12-01T00:00:00Z', reviewTrigger: 'exposure or isolation change',
  dispositionSource: 'C1 D0.3 owner disposition', actor: 'owner', a9Record: A9_RECORD,
  affectedQualificationIds: ['Q-CODEX-1'],
  isolationControls: ['private-FD credential loading', 'no candidate provider egress', 'encrypted settlement envelopes'],
  providerFacts: ['provider terms permit public-repository CI execution for this route'],
  ...over,
});

test('T6-P1: a current exact-provider C1 D0.3 public-repository extension validates and admits', () => {
  const d = validateDisposition(base());
  assert.equal(d.kind, 'c1-d0-3-public-extension');
  assert.equal(d.publicRepository, 'rhanka/sentropic');
  assert.equal(d.a9Record, 'A9');
  assert.deepEqual(d.affectedQualificationIds, ['Q-CODEX-1']);
  const verdict = admitPublicExecution(base(), ctx);
  assert.equal(verdict.ok, true);
  if (verdict.ok) assert.equal(verdict.disposition.evidenceDigest, 'a'.repeat(64));
});

test('T6-P1: explicit provider proof permitting the public-repository route also admits', () => {
  const proof = base({ kind: 'provider-proof' });
  delete (proof as Record<string, unknown>).isolationControls;
  delete (proof as Record<string, unknown>).providerFacts;
  const verdict = admitPublicExecution(proof, ctx);
  assert.equal(verdict.ok, true);
});

test('T6-P1: private-only, generic same-repo consent and malformed dispositions refuse before inference', () => {
  for (const kind of ['c1-d0-3-private', 'generic-same-repo-consent', 'app-consent']) {
    const v = admitPublicExecution(base({ kind }), ctx);
    assert.deepEqual(v, { ok: false, code: 'disposition-kind' }, kind);
  }
  assert.deepEqual(admitPublicExecution(base({ publicRepository: 'rhanka/sentropic-seat-custody' }), ctx), { ok: false, code: 'public-repository' });
  assert.deepEqual(admitPublicExecution(base({ evidenceDigest: 'xyz' }), ctx), { ok: false, code: 'evidence-digest' });
  assert.deepEqual(admitPublicExecution(base({ a9Record: 'A8' }), ctx), { ok: false, code: 'a9-linkage' });
  assert.deepEqual(admitPublicExecution(base({ affectedQualificationIds: [] }), ctx), { ok: false, code: 'affected-qualifications' });
  assert.deepEqual(admitPublicExecution(base({ evidenceDate: '01/11/2026' }), ctx), { ok: false, code: 'disposition-date' });
  assert.deepEqual(admitPublicExecution(null, ctx), { ok: false, code: 'disposition-shape' });
});

test('T6-P1: extension without isolation controls or provider facts refuses', () => {
  const noIso = base();
  delete (noIso as Record<string, unknown>).isolationControls;
  assert.deepEqual(admitPublicExecution(noIso, ctx), { ok: false, code: 'isolation-controls-missing' });
  const noFacts = base();
  delete (noFacts as Record<string, unknown>).providerFacts;
  assert.deepEqual(admitPublicExecution(noFacts, ctx), { ok: false, code: 'provider-facts-missing' });
  assert.deepEqual(admitPublicExecution(base({ privateToPublicChange: 'no change' }), ctx), { ok: false, code: 'private-to-public-change' });
});

test('T6-P1: other-provider, route/client/model mismatch and expired evidence refuse', () => {
  assert.deepEqual(admitPublicExecution(base(), { ...ctx, provider: 'meta' }), { ok: false, code: 'provider-mismatch' });
  assert.deepEqual(admitPublicExecution(base(), { ...ctx, route: 'chat:other-model' }), { ok: false, code: 'route-mismatch' });
  assert.deepEqual(admitPublicExecution(base(), { ...ctx, client: 'VIBE' }), { ok: false, code: 'client-mismatch' });
  assert.deepEqual(admitPublicExecution(base(), { ...ctx, model: 'gpt-6.1-sol' }), { ok: false, code: 'model-mismatch' });
  assert.deepEqual(admitPublicExecution(base({ validUntil: '2026-11-02T06:45:00Z' }), ctx), { ok: false, code: 'evidence-expired' });
  assert.deepEqual(admitPublicExecution(base({ validUntil: '2026-11-01T00:00:00Z' }), ctx), { ok: false, code: 'evidence-expired' });
});

test('T6-P1: provider-mismatched or expired proof for another provider never admits this route', () => {
  const metaProof = base({ kind: 'provider-proof', provider: 'meta', route: 'chat:mistral-large-4', client: 'VIBE', model: 'mistral-large-4', affectedQualificationIds: ['Q-VIBE-1'] });
  assert.deepEqual(admitPublicExecution(metaProof, ctx), { ok: false, code: 'provider-mismatch' });
  const expiredMeta = base({ kind: 'provider-proof', provider: 'meta', route: 'chat:mistral-large-4', client: 'VIBE', model: 'mistral-large-4', validUntil: '2026-10-01T00:00:00Z' });
  assert.deepEqual(admitPublicExecution(expiredMeta, { ...ctx, provider: 'meta', route: 'chat:mistral-large-4', client: 'VIBE', model: 'mistral-large-4' }), { ok: false, code: 'evidence-expired' });
});
