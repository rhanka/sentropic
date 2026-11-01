// T5-C5 review side (r6 §4.2): native-review requirement classification and the
// automated-translation attestation contract. An Actions-bot self-approval or an
// attestor equal to the PR author fails; a verified independent receipt translated
// by a distinct principal is accepted only for automation-permitted requirements,
// with the event disclosing the translation and binding the exact receipt digest;
// a person-owned token never satisfies a human-intent or unknown requirement.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AUTOMATED_TRANSLATION_PREFIX,
  assertAttestationEvent,
  assertPersonTokenApproval,
  classifyNativeReviewRequirement,
} from './review.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const pr = { repo: 'rhanka/sentropic', number: 900, head: 'H'.repeat(40), base: 'B'.repeat(40), tree: 'T'.repeat(40), author: 'github-actions[bot]' };
const patchDigest = 'p'.repeat(64);
const receipt = {
  uri: 'https://example.invalid/receipts/r1.json',
  sha256: sha256('receipt-bytes'),
  humanReviewIntent: false,
  normalizedPatchDigest: patchDigest,
  repo: pr.repo, pr: pr.number, head: pr.head, base: pr.base, tree: pr.tree,
  contributorModels: ['mistral-large-4'], reviewerModel: 'gpt-6-astra',
  attestorActor: 'review-attestor', expiresAt: Date.parse('2026-12-01T00:00:00Z'),
};
const goodEvent = {
  actor: 'review-attestor',
  body: `${AUTOMATED_TRANSLATION_PREFIX}\nreceipt: ${receipt.uri} sha256=${receipt.sha256} humanReviewIntent=false`,
  eventId: 42,
};

describe('T5-C5: native-review requirement classification', () => {
  it('classifies automation-permitted, human-intent and unknown', () => {
    assert.equal(classifyNativeReviewRequirement({ requiresReview: true, automationPermitted: true }), 'automation-permitted');
    assert.equal(classifyNativeReviewRequirement({ requiresReview: true, humanIntent: true }), 'human-intent');
    assert.equal(classifyNativeReviewRequirement({ requiresReview: true }), 'unknown');
    assert.equal(classifyNativeReviewRequirement({ requiresReview: false }), 'none');
  });
});

describe('T5-C5: automated translation of an independent model review', () => {
  it('accepts a disclosed translation event bound to the exact receipt by a distinct principal', () => {
    assert.doesNotThrow(() => assertAttestationEvent({ event: goodEvent, receipt, pr, patchDigest, nowMs: Date.parse('2026-11-01T00:00:00Z') }));
  });

  it('refuses bot self-approval and attestor equal to the PR author', () => {
    assert.throws(() => assertAttestationEvent({ event: { ...goodEvent, actor: 'github-actions[bot]' }, receipt, pr, patchDigest, nowMs: 1 }), /self-approval-refused/);
    assert.throws(() => assertAttestationEvent({ event: { ...goodEvent, actor: pr.author }, receipt: { ...receipt, attestorActor: pr.author }, pr, patchDigest, nowMs: 1 }), /self-approval-refused/);
  });

  it('refuses undisclosed automation, mismatched receipt, patch, H/B/T, expiry and non-independent reviewer', () => {
    const now = Date.parse('2026-11-01T00:00:00Z');
    assert.throws(() => assertAttestationEvent({ event: { ...goodEvent, body: 'LGTM' }, receipt, pr, patchDigest, nowMs: now }), /undisclosed-automation/);
    assert.throws(() => assertAttestationEvent({ event: goodEvent, receipt: { ...receipt, sha256: sha256('other') }, pr, patchDigest, nowMs: now }), /receipt-mismatch/);
    assert.throws(() => assertAttestationEvent({ event: goodEvent, receipt, pr, patchDigest: 'q'.repeat(64), nowMs: now }), /patch-mismatch/);
    assert.throws(() => assertAttestationEvent({ event: goodEvent, receipt: { ...receipt, head: 'X'.repeat(40) }, pr, patchDigest, nowMs: now }), /hbt-mismatch/);
    assert.throws(() => assertAttestationEvent({ event: goodEvent, receipt: { ...receipt, expiresAt: now - 1 }, pr, patchDigest, nowMs: now }), /receipt-expired/);
    assert.throws(() => assertAttestationEvent({ event: goodEvent, receipt: { ...receipt, reviewerModel: 'mistral-large-4' }, pr, patchDigest, nowMs: now }), /reviewer-not-independent/);
    assert.throws(() => assertAttestationEvent({ event: goodEvent, receipt: { ...receipt, humanReviewIntent: true }, pr, patchDigest, nowMs: now }), /human-intent-flag/);
  });
});

describe('T5-C5: person-owned tokens never satisfy human intent', () => {
  it('refuses a person-owned token against human-intent or unknown requirements even when the count passes', () => {
    assert.throws(() => assertPersonTokenApproval({ requirement: 'human-intent', tokenOwnerIsPerson: true, approvalCount: 1 }), /human-intent-not-satisfied-by-token/);
    assert.throws(() => assertPersonTokenApproval({ requirement: 'unknown', tokenOwnerIsPerson: true, approvalCount: 1 }), /human-intent-not-satisfied-by-token/);
    assert.doesNotThrow(() => assertPersonTokenApproval({ requirement: 'automation-permitted', tokenOwnerIsPerson: true, approvalCount: 1 }));
    assert.doesNotThrow(() => assertPersonTokenApproval({ requirement: 'human-intent', tokenOwnerIsPerson: false, approvalCount: 0 }));
  });
});
