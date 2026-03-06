import { describe, expect, it } from 'vitest';
import { isLocalToolName } from '../../src/lib/stores/localTools';
import {
  filterPermissionPromptsForPendingStream,
  parsePendingLocalToolCallsFromStatusPayload,
  shouldResetLocalToolStateForFreshRound,
} from '../../src/lib/utils/localToolStreamSync';

describe('localToolStreamSync', () => {
  it('parses pending local tool calls from awaiting status payload', () => {
    const calls = parsePendingLocalToolCallsFromStatusPayload(
      'stream-1',
      42,
      {
        state: 'awaiting_local_tool_results',
        pending_local_tool_calls: [
          {
            tool_call_id: 'call-1',
            name: 'bash',
            args: { command: 'pwd' },
          },
          {
            tool_call_id: 'call-2',
            name: 'unknown_tool',
            args: { foo: 'bar' },
          },
          {
            tool_call_id: 'call-1',
            name: 'bash',
            args: { command: 'pwd' },
          },
        ],
      },
      isLocalToolName,
    );

    expect(calls).toEqual([
      {
        toolCallId: 'call-1',
        name: 'bash',
        argsText: '{"command":"pwd"}',
        streamId: 'stream-1',
        sequence: 42,
      },
    ]);
  });

  it('drops stale permission prompts for a stream while keeping current ones', () => {
    const prompts = [
      { toolCallId: 'call-1', streamId: 'stream-1' },
      { toolCallId: 'call-2', streamId: 'stream-1' },
      { toolCallId: 'call-9', streamId: 'stream-2' },
    ];

    const next = filterPermissionPromptsForPendingStream(
      prompts,
      'stream-1',
      new Set(['call-2']),
    );

    expect(next).toEqual([
      { toolCallId: 'call-2', streamId: 'stream-1' },
      { toolCallId: 'call-9', streamId: 'stream-2' },
    ]);
  });

  it('resets execution state when the same tool_call_id is reused in a later round', () => {
    expect(
      shouldResetLocalToolStateForFreshRound(
        { executed: true, lastSequence: 10 },
        15,
      ),
    ).toBe(true);
    expect(
      shouldResetLocalToolStateForFreshRound(
        { executed: false, lastSequence: 10 },
        15,
      ),
    ).toBe(false);
    expect(
      shouldResetLocalToolStateForFreshRound(
        { executed: true, lastSequence: 10 },
        9,
      ),
    ).toBe(false);
  });
});
