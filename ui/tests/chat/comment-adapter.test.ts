import { describe, expect, it } from 'vitest';
import {
  buildCommentThreads,
  findAssignedMentionFromText,
  formatCommentTimestamp,
  getCommentAuthorLabel,
  getCommentSectionLabel,
  getInitials,
  getMentionCandidate,
  getMentionLabel,
  getMentionMatches,
  isCommentByUser,
} from '$lib/chat/comment-adapter';

const members = [
  { userId: 'u_ada', email: 'ada@example.com', displayName: 'Ada Lovelace' },
  { userId: 'u_bob', email: 'bob@example.com', displayName: 'Bob Stone' },
  { userId: 'u_cam', email: 'cam@example.com', displayName: null },
];

describe('chat comment adapter', () => {
  it('normalizes display labels and current-user checks', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL');
    expect(getInitials('')).toBe('?');
    expect(getMentionLabel(members[2])).toBe('cam@example.com');
    expect(
      getCommentAuthorLabel({
        created_by: 'u_ada',
        created_by_user: { displayName: 'Ada L.', email: 'ada@example.com' },
      }),
    ).toBe('Ada L.');
    expect(
      isCommentByUser(
        { created_by: 'ada@example.com', created_by_user: { id: 'u_ada' } },
        { id: 'u_ada', email: 'ada@example.com' },
      ),
    ).toBe(true);
  });

  it('detects and ranks mention candidates', () => {
    expect(getMentionCandidate('please ask @Ad')).toEqual({
      start: 11,
      end: 14,
      query: 'Ad',
    });
    expect(getMentionCandidate('please ask @Ad ')).toBeNull();
    expect(getMentionMatches(members, 'bo')).toEqual([members[1]]);
    expect(getMentionMatches(members, '')).toHaveLength(3);
    expect(findAssignedMentionFromText('cc @Ada Lovelace then @Bob Stone', members)).toEqual(
      members[1],
    );
  });

  it('builds sorted comment thread summaries and item maps', () => {
    const { threads, map } = buildCommentThreads([
      {
        id: 'c_2',
        thread_id: 't_1',
        section_key: 'problem',
        content: 'Second',
        status: 'open',
        assigned_to: 'u_bob',
        created_by: 'u_bob',
        created_at: '2024-01-01T10:01:00Z',
        created_by_user: { displayName: 'Bob Stone' },
      },
      {
        id: 'c_1',
        thread_id: 't_1',
        section_key: 'problem',
        content: 'First',
        status: 'open',
        assigned_to: 'u_bob',
        created_by: 'u_ada',
        created_at: '2024-01-01T10:00:00Z',
        created_by_user: { displayName: 'Ada Lovelace' },
      },
      {
        id: 'c_3',
        thread_id: 't_2',
        section_key: null,
        content: 'Latest',
        status: 'closed',
        assigned_to: null,
        created_by: 'u_cam',
        created_at: '2024-01-01T11:00:00Z',
      },
    ]);

    expect(threads.map((thread) => thread.id)).toEqual(['t_2', 't_1']);
    expect(threads[1]).toMatchObject({
      count: 2,
      preview: 'Second',
      authorLabel: 'Bob Stone',
      status: 'open',
      assignedTo: 'u_bob',
      rootId: 'c_1',
    });
    expect(map.get('t_1')?.map((comment) => comment.id)).toEqual(['c_1', 'c_2']);
  });

  it('keeps section and timestamp formatting outside the Svelte component', () => {
    expect(getCommentSectionLabel('usecase', 'problem', (key) => `i18n:${key}`)).toBe(
      'i18n:chat.sections.usecase.problem',
    );
    expect(getCommentSectionLabel('usecase', 'custom', (key) => `i18n:${key}`)).toBe(
      'custom',
    );
    expect(
      formatCommentTimestamp({
        value: '2024-01-02T09:30:00Z',
        now: new Date('2024-01-02T12:00:00Z'),
        yesterdayLabel: 'Yesterday',
        timeFormatter: { format: () => '09:30' },
        dateFormatter: { format: () => '02/01/2024' },
      }),
    ).toBe('09:30');
  });
});
