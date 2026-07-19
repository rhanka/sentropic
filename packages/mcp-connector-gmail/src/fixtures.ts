/**
 * BR-72 Wave-1 — SYNTHETIC Gmail fixtures (benchmark proof).
 *
 * No real Gmail data, no PII, no secrets, no network calls. Every value below
 * is invented sample data used purely to exercise the adapter contract.
 */

export type SyntheticThreadSummary = {
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
};

export type SyntheticMessage = {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  snippet: string;
  bodyText: string;
};

export type SyntheticDraftSummary = {
  draftId: string;
  messageId: string;
  subject: string;
  snippet: string;
};

export type SyntheticDraft = {
  draftId: string;
  messageId: string;
  subject: string;
  to: string[];
  bodyText: string;
};

export const searchThreadsFixture: SyntheticThreadSummary[] = [
  {
    threadId: 'thread-synthetic-001',
    subject: 'Synthetic thread: quarterly planning notes',
    snippet: 'Placeholder snippet for a synthetic fixture thread.',
    from: 'sample.sender@example.invalid',
    date: '2026-07-01T09:00:00.000Z',
  },
  {
    threadId: 'thread-synthetic-002',
    subject: 'Synthetic thread: sample follow-up',
    snippet: 'Another placeholder snippet, no real content.',
    from: 'other.sample@example.invalid',
    date: '2026-07-05T14:30:00.000Z',
  },
];

export const getMessageFixture: Record<string, SyntheticMessage> = {
  'message-synthetic-001': {
    messageId: 'message-synthetic-001',
    threadId: 'thread-synthetic-001',
    subject: 'Synthetic thread: quarterly planning notes',
    from: 'sample.sender@example.invalid',
    to: ['sample.recipient@example.invalid'],
    date: '2026-07-01T09:00:00.000Z',
    snippet: 'Placeholder snippet for a synthetic fixture thread.',
    bodyText: 'This is entirely synthetic sample body text used only for the BR-72 benchmark proof.',
  },
};

export const listDraftsFixture: SyntheticDraftSummary[] = [
  {
    draftId: 'draft-synthetic-001',
    messageId: 'message-synthetic-draft-001',
    subject: 'Synthetic draft: sample reply',
    snippet: 'Placeholder draft snippet, no real content.',
  },
];

export const getDraftFixture: Record<string, SyntheticDraft> = {
  'draft-synthetic-001': {
    draftId: 'draft-synthetic-001',
    messageId: 'message-synthetic-draft-001',
    subject: 'Synthetic draft: sample reply',
    to: ['sample.recipient@example.invalid'],
    bodyText: 'This is entirely synthetic sample draft body text for the BR-72 benchmark proof.',
  },
};
