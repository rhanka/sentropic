import { describe, expect, it } from 'vitest';

import { conformanceCapacity, conformanceScope } from './conformance/comments-conformance.js';
import {
  REVIEW_ACTIONS,
  REVIEW_DECISION_OUTCOMES,
  ReviewValidationError,
  createReviewEvent,
  projectReviewState,
  type ReviewEventRecord,
} from '../src/reviews.js';

const scope = conformanceScope();
const capacity = conformanceCapacity();
const head = 'a'.repeat(64);
const older = 'b'.repeat(64);

const input = (
  action: 'submit' | 'validate' | 'contest' | 'resolve-contest' | 'withdraw',
  revisionHash: string,
  extra: Partial<{ referencesEventHash: string | null; decision: { principal: string; outcome: 'accept' | 'reject' | 'abstain' } | null; proposal: { agent: string; proposalDigest: string } | null; executor: { service: string; run: string } | null }> = {},
) => ({
  scope,
  annotationId: 'ann_1',
  action,
  revisionHash,
  referencesEventHash: null,
  actor: { principal: 'reviewer_1' },
  decision: null,
  proposal: null,
  executor: null,
  ...extra,
});

describe('annotation reviews', () => {
  it('closes the action and decision-outcome sets', () => {
    expect(REVIEW_ACTIONS).toEqual(['submit', 'validate', 'contest', 'resolve-contest', 'withdraw']);
    expect(REVIEW_DECISION_OUTCOMES).toEqual(['accept', 'reject', 'abstain']);
  });

  it('runs the conservative submit/validate/contest/resolve lifecycle', () => {
    const chain: ReviewEventRecord[] = [];
    const submit = createReviewEvent(chain, input('submit', head), capacity);
    chain.push(submit);
    expect(projectReviewState(chain, head).state).toBe('submitted');

    expect(() => createReviewEvent(chain, input('contest', head), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );

    const validation = createReviewEvent(chain, input('validate', head, { decision: { principal: 'reviewer_1', outcome: 'accept' } }), capacity);
    chain.push(validation);
    expect(projectReviewState(chain, head).state).toBe('validated');

    const contest = createReviewEvent(chain, input('contest', head, { referencesEventHash: validation.hash }), capacity);
    chain.push(contest);
    expect(projectReviewState(chain, head).state).toBe('contested');
    expect(projectReviewState(chain, head).contests[0]).toMatchObject({
      eventHash: contest.hash,
      contestsEventHash: validation.hash,
      resolvedByEventHash: null,
    });

    const resolution = createReviewEvent(chain, input('resolve-contest', head, { referencesEventHash: contest.hash, decision: { principal: 'reviewer_2', outcome: 'accept' } }), capacity);
    chain.push(resolution);
    const resolved = projectReviewState(chain, head);
    expect(resolved.state).toBe('contested');
    expect(resolved.requiresRenewedValidation).toBe(true);
    expect(resolved.contests[0].resolvedByEventHash).toBe(resolution.hash);

    const renewed = createReviewEvent(chain, input('validate', head, { decision: { principal: 'reviewer_3', outcome: 'accept' } }), capacity);
    chain.push(renewed);
    expect(projectReviewState(chain, head).state).toBe('validated');
    expect(projectReviewState(chain, head).requiresRenewedValidation).toBe(false);
  });

  it('marks events pinned to superseded revisions as stale', () => {
    const chain: ReviewEventRecord[] = [];
    chain.push(createReviewEvent(chain, input('submit', older), capacity));
    chain.push(createReviewEvent(chain, input('submit', head), capacity));
    const stale = projectReviewState(chain, head);
    expect(stale.state).toBe('submitted');
    expect(stale.staleEventHashes).toEqual([chain[0].hash]);
    const absent = projectReviewState(chain, null);
    expect(absent.state).toBe('none');
    expect(absent.staleEventHashes).toHaveLength(2);
  });

  it('requires exact references for contests and resolutions', () => {
    const chain: ReviewEventRecord[] = [];
    chain.push(createReviewEvent(chain, input('submit', head), capacity));
    const validation = createReviewEvent(chain, input('validate', head, { decision: { principal: 'reviewer_1', outcome: 'accept' } }), capacity);
    chain.push(validation);
    expect(() => createReviewEvent(chain, input('contest', head, { referencesEventHash: head }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-reference' }),
    );
    const otherRevisionValidation = 'c'.repeat(64);
    expect(() => createReviewEvent(chain, input('contest', head, { referencesEventHash: otherRevisionValidation }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-reference' }),
    );
    const contest = createReviewEvent(chain, input('contest', head, { referencesEventHash: validation.hash }), capacity);
    chain.push(contest);
    expect(() => createReviewEvent(chain, input('resolve-contest', head, { referencesEventHash: validation.hash }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-reference' }),
    );
    expect(() => createReviewEvent(chain, input('resolve-contest', head, { referencesEventHash: contest.hash }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-audit' }),
    );
  });

  it('withdraws open reviews and enforces chain scoping', () => {
    const chain: ReviewEventRecord[] = [];
    chain.push(createReviewEvent(chain, input('submit', head), capacity));
    chain.push(createReviewEvent(chain, input('withdraw', head), capacity));
    expect(projectReviewState(chain, head).state).toBe('withdrawn');
    expect(() => createReviewEvent(chain, input('withdraw', head), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );
    const otherScope = { ...input('submit', head), scope: { tenantId: 'tenant-other', workspaceId: 'ws-a' } };
    expect(() => createReviewEvent(chain, otherScope, capacity)).toThrowError(ReviewValidationError);
    expect(() => createReviewEvent(chain, { ...input('submit', head), annotationId: '' }, capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-pin' }),
    );
    expect(() => createReviewEvent(chain, { ...input('unknown' as never, head) }, capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-action' }),
    );
  });

  it('audits decision, proposal and executor separately', () => {
    const chain: ReviewEventRecord[] = [];
    chain.push(createReviewEvent(chain, input('submit', head), capacity));
    const validation = createReviewEvent(chain, input('validate', head, {
      decision: { principal: 'reviewer_1', outcome: 'reject' },
      proposal: { agent: 'agent_1', proposalDigest: 'd'.repeat(64) },
      executor: { service: 'svc_1', run: 'run_1' },
    }), capacity);
    chain.push(validation);
    expect(validation.decision).toEqual({ principal: 'reviewer_1', outcome: 'reject' });
    expect(validation.proposal).toEqual({ agent: 'agent_1', proposalDigest: 'd'.repeat(64) });
    expect(validation.executor).toEqual({ service: 'svc_1', run: 'run_1' });
    expect(() => createReviewEvent(chain, input('validate', head, { decision: { principal: 'reviewer_1', outcome: 'maybe' as never } }), capacity)).toThrow();
    expect(() => createReviewEvent(chain, input('validate', head, { proposal: { agent: '', proposalDigest: 'd' } }), capacity)).toThrowError(
      expect.objectContaining({ code: 'invalid-audit' }),
    );
  });

  it('fails closed when the capacity descriptor is missing or invalid', () => {
    expect(() => createReviewEvent([], input('submit', head), undefined as never)).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
    const broken = { ...capacity, body: undefined } as never;
    expect(() => createReviewEvent([], input('submit', head), broken)).toThrowError(
      expect.objectContaining({ code: 'invalid-capacity' }),
    );
  });
});
