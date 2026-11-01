import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_DEADLINE,
  DEADLINE_CRON,
  FALLBACK_ISSUE_TITLE,
  FALLBACK_REPO,
  secondDay,
  isSuppressed,
  fallbackMarker,
  isDuplicateMarker,
} from './deadline-report.mjs';

describe('L8-I: first and second dated shortfalls', () => {
  it('first deadline and 07:30 cron are frozen', () => {
    assert.equal(FIRST_DEADLINE, '2026-11-03T23:59:59Z');
    assert.equal(DEADLINE_CRON, '30 7 * * *');
    assert.equal(FALLBACK_REPO, 'rhanka/sentropic');
    assert.equal(FALLBACK_ISSUE_TITLE, 'Daily cybersecurity activation: deadline and publication shortfalls');
  });

  it('second day produces a distinct dated record without M1', () => {
    const outcome = secondDay({ firstDate: '2026-11-03', secondDate: '2026-11-04', m1: false });
    assert.equal(outcome.ok, true);
    assert.notEqual(outcome.secondDeadlineKey, outcome.firstDeadlineKey);
  });

  it('backdated or duplicate delivery does not add a logical record', () => {
    assert.equal(secondDay({ firstDate: '2026-11-04', secondDate: '2026-11-03', m1: false }).ok, false);
    assert.equal(secondDay({ firstDate: '2026-11-04', secondDate: '2026-11-04', m1: false }).ok, false);
  });

  it('fallback marker is idempotent per date and key', () => {
    const marker = fallbackMarker({ date: '2026-11-03', deadlineKey: 'd1:abc' });
    assert.equal(isDuplicateMarker([marker], marker), true);
    assert.equal(isDuplicateMarker([], marker), false);
  });
});

describe('L8-I: review_due unsuppression instant', () => {
  it('2026-11-20 rows stay within date, 2026-11-21 rows unsuppress', () => {
    assert.equal(isSuppressed({ reviewDue: '2026-11-20', now: '2026-11-20T23:59:59Z' }), true);
    assert.equal(isSuppressed({ reviewDue: '2026-11-20', now: '2026-11-21T00:00:00Z' }), false);
  });
});
