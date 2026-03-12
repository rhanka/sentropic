import { describe, expect, it } from 'vitest';
import {
  getCheckpointMutationPreviewItems,
  hasCheckpointMutationDelta,
} from '../../src/lib/utils/checkpointDelta';

describe('checkpointDelta', () => {
  it('does not expose checkpoint restore for read-only assistant turns', () => {
    const result = hasCheckpointMutationDelta(
      { anchorSequence: 1 },
      [
        { id: 'user-1', role: 'user', sequence: 1 },
        { id: 'assistant-1', role: 'assistant', sequence: 2 },
      ],
      new Map([
        [
          'assistant-1',
          [
            {
              eventType: 'tool_call_start',
              sequence: 10,
              data: {
                tool_call_id: 'call-read',
                name: 'file_read',
                args: '{"path":"PLAN.md"}',
              },
            },
          ],
        ],
      ]),
    );

    expect(result).toBe(false);
  });

  it('exposes checkpoint restore when a mutating file edit happened after the anchor', () => {
    const result = hasCheckpointMutationDelta(
      { anchorSequence: 1 },
      [
        { id: 'user-1', role: 'user', sequence: 1 },
        { id: 'assistant-1', role: 'assistant', sequence: 2 },
      ],
      new Map([
        [
          'assistant-1',
          [
            {
              eventType: 'tool_call_start',
              sequence: 10,
              data: {
                tool_call_id: 'call-write',
                name: 'file_edit',
                args: '{"mode":"edit","path":"src/app.ts"}',
              },
            },
          ],
        ],
      ]),
    );

    expect(result).toBe(true);
  });

  it('treats git status as read-only and git commit as mutating', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'user-1', role: 'user', sequence: 1 },
          { id: 'assistant-git-read', role: 'assistant', sequence: 2 },
        ],
        new Map([
          [
            'assistant-git-read',
            [
              {
                eventType: 'tool_call_start',
                sequence: 10,
                data: {
                  tool_call_id: 'call-git-status',
                  name: 'git',
                  args: '{"action":"status"}',
                },
              },
            ],
          ],
        ]),
      ),
    ).toBe(false);

    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'user-1', role: 'user', sequence: 1 },
          { id: 'assistant-git-write', role: 'assistant', sequence: 2 },
        ],
        new Map([
          [
            'assistant-git-write',
            [
              {
                eventType: 'tool_call_start',
                sequence: 11,
                data: {
                  tool_call_id: 'call-git-commit',
                  name: 'git',
                  args: '{"action":"commit","message":"checkpoint"}',
                },
              },
            ],
          ],
        ]),
      ),
    ).toBe(true);
  });

  it('builds a compact preview list from file and object mutations', () => {
    const preview = getCheckpointMutationPreviewItems(
      { anchorSequence: 1 },
      [
        { id: 'user-1', role: 'user', sequence: 1 },
        { id: 'assistant-1', role: 'assistant', sequence: 2 },
        { id: 'assistant-2', role: 'assistant', sequence: 3 },
      ],
      new Map([
        [
          'assistant-1',
          [
            {
              eventType: 'tool_call_start',
              sequence: 10,
              data: {
                tool_call_id: 'call-write',
                name: 'file_edit',
                args: '{"mode":"edit","path":"src/lib/chat.ts"}',
              },
            },
          ],
        ],
        [
          'assistant-2',
          [
            {
              eventType: 'tool_call_start',
              sequence: 11,
              data: {
                tool_call_id: 'call-update',
                name: 'folder_update',
                args: '{"folderId":"fld_123","updates":[{"field":"name","value":"Code"}]}',
              },
            },
          ],
        ],
      ]),
    );

    expect(preview).toEqual(['src/lib/chat.ts', 'folder update: fld_123']);
  });
});
