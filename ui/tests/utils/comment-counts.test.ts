import { describe, expect, it } from 'vitest';
import { buildOpenCommentCounts } from '../../src/lib/utils/comment-counts';

describe('buildOpenCommentCounts', () => {
  it('aggregates open thread comments by section key', () => {
    const counts = buildOpenCommentCounts([
      { thread_id: 't1', status: 'open', section_key: 'constraints' },
      { thread_id: 't1', status: 'open', section_key: 'constraints' },
      { thread_id: 't2', status: 'open', section_key: 'domain' },
    ]);

    expect(counts).toEqual({
      constraints: 2,
      domain: 1,
    });
  });

  it('excludes closed threads and falls back to root section key', () => {
    const counts = buildOpenCommentCounts([
      { thread_id: 't1', status: 'closed', section_key: 'constraints' },
      { thread_id: 't1', status: 'closed', section_key: 'constraints' },
      { thread_id: 't2', status: 'open', section_key: null },
      { thread_id: 't2', status: 'open', section_key: null },
    ]);

    expect(counts).toEqual({
      root: 2,
    });
  });
});
