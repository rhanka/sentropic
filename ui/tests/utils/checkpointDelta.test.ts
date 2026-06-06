/**
 * Migrated from checkpointDelta.ts to @sentropic/chat-ui/checkpoints + sentropic adapter opts.
 * The generic module provides the core classifier; sentropic-specific opts (isMutatingTool,
 * isLocalToolName, humanizeMutation) come from the adapter hooks.
 */
import { describe, expect, it } from 'vitest';
import {
  getCheckpointMutationPreviewItems,
  hasCheckpointMutationDelta,
} from '@sentropic/chat-ui/checkpoints';

// Sentropic domain opts (mirrors checkpointHostAdapter.ts hooks, without network calls).
const MUTATING_TOOL_NAME_SUFFIXES = ['_create', '_update', '_delete'];
const isMutatingTool = (toolName: string, _argsText: string): boolean =>
  MUTATING_TOOL_NAME_SUFFIXES.some((suffix) => toolName.trim().toLowerCase().endsWith(suffix));

const humanizeMutation = (toolName: string, argsText: string): string | null => {
  let record: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(argsText.trim());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      record = parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  const entity = toolName.replace(/_(create|update|delete)$/i, '');
  const label = entity.replace(/_/g, ' ').trim();
  if (!label) return null;
  const idCandidate = String(
    record?.id ??
      record?.folderId ??
      record?.useCaseId ??
      record?.organizationId ??
      record?.workspaceId ??
      '',
  ).trim();
  const action = toolName.split('_').slice(-1)[0];
  return idCandidate ? `${label} ${action}: ${idCandidate}` : `${label} ${action}`;
};

const sentropicOpts = { isMutatingTool, humanizeMutation };

describe('checkpointDelta (migrated to @sentropic/chat-ui/checkpoints)', () => {
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
      sentropicOpts,
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
      sentropicOpts,
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
        sentropicOpts,
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
        sentropicOpts,
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
      sentropicOpts,
    );

    expect(preview).toEqual(['src/lib/chat.ts', 'folder update: fld_123']);
  });
});
