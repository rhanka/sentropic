import { deriveDeadlineKey } from './report-format.mjs';

export const FIRST_DEADLINE = '2026-11-03T23:59:59Z';
export const FIRST_DATE = '2026-11-03';
export const DEADLINE_CRON = '30 7 * * *';
export const FALLBACK_REPO = 'rhanka/sentropic';
export const FALLBACK_ISSUE_TITLE = 'Daily cybersecurity activation: deadline and publication shortfalls';

export function secondDay({ firstDate, secondDate, m1, repositoryId = 123 }) {
  if (!(secondDate > firstDate)) return { ok: false, reason: 'delayed trigger cannot backdate or duplicate' };
  return {
    ok: true,
    m1,
    firstDeadlineKey: deriveDeadlineKey(repositoryId, firstDate),
    secondDeadlineKey: deriveDeadlineKey(repositoryId, secondDate),
  };
}

export function isSuppressed({ reviewDue, now }) {
  const instant = new Date(`${reviewDue}T00:00:00Z`).getTime() + 86400000;
  const at = new Date(now).getTime();
  return at < instant;
}

export function fallbackMarker({ date, deadlineKey }) {
  return `shortfall:${date}:${deadlineKey}`;
}

export function isDuplicateMarker(existing, marker) {
  return existing.includes(marker);
}
