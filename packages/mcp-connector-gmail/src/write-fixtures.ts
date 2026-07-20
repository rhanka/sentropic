/**
 * BR-72 Wave-2 Lot 3 — SYNTHETIC Gmail write-tool fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the write adapter can return a
 * canned "mutation succeeded" output once `assertMutationGate` clears an
 * invocation — no real Gmail API is ever reached.
 */

export const gmailWriteFixtures = {
  tools: {
    send_email: {
      messageId: 'msg-sent-001',
      threadId: 'thread-sent-001',
      status: 'sent',
      sentAt: '2026-07-19T14:00:00Z',
    },
    create_draft: {
      draftId: 'draft-created-001',
      messageId: 'msg-draft-001',
      subject: 'Draft subject',
      status: 'created',
    },
    update_draft: {
      draftId: 'draft-created-001',
      messageId: 'msg-draft-001',
      subject: 'Draft subject (updated)',
      status: 'updated',
    },
    delete_draft: {
      deleted: true,
      draftId: 'draft-created-001',
    },
    create_label: {
      labelId: 'label-custom-001',
      name: 'Work/Sentropic',
      type: 'user',
    },
    add_label_to_email: {
      messageId: 'msg-synthetic-001',
      labelIds: ['UNREAD', 'INBOX', 'label-custom-001'],
    },
    move_to_trash: {
      messageId: 'msg-synthetic-001',
      labelIds: ['TRASH'],
    },
    create_filter: {
      filterId: 'filter-synthetic-001',
      criteria: {
        from: 'alerts@sent-tech.ca',
      },
      action: {
        addLabelIds: ['label-custom-001'],
      },
    },
  },
} as const;

export type GmailWriteToolCapabilityName = keyof typeof gmailWriteFixtures.tools;

export function getWriteToolFixture(capabilityRef: string): unknown | undefined {
  return (gmailWriteFixtures.tools as Record<string, unknown>)[capabilityRef];
}
