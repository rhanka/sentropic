/**
 * checkpoints.spec.ts — Deterministic parity proof for the checkpoints module.
 *
 * Tests:
 *   1. classifier.ts: git/bash/file_edit built-in classifiers
 *   2. classifier.ts: isMutatingTool hook override (domain tools)
 *   3. classifier.ts: isLocalToolName default ()=>false equivalence proof
 *      (demonstrates: with no local tools in status events, default is functionally
 *       identical to a local-tool-aware guard that returns false for all names)
 *   4. checkpointState.ts: applySessionCheckpoints, getCheckpointForUserMessage,
 *      openCheckpointPrompt
 *   5. index.ts: all exported symbols present
 *   6. Zero sentropic domain strings in src/checkpoints/ (runtime string scan)
 *
 * Runs in --environment node (no browser/Svelte dependencies).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  hasCheckpointMutationDelta,
  getCheckpointMutationPreviewItems,
  applySessionCheckpoints,
  getCheckpointForUserMessage,
  openCheckpointPrompt,
} from '../src/checkpoints/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type Msg = { id: string; role: string; sequence: number; _streamId?: string };
type Event = { eventType: string; data: unknown; sequence: number };

const makeEvents = (...entries: { id: string; events: Event[] }[]): Map<string, Event[]> =>
  new Map(entries.map(({ id, events }) => [id, events]));

const toolCallStartEvent = (toolCallId: string, name: string, args: string, seq = 10): Event => ({
  eventType: 'tool_call_start',
  data: { tool_call_id: toolCallId, name, args },
  sequence: seq,
});

const statusEventWithLocalTool = (
  toolCallId: string,
  name: string,
  args: unknown,
  seq = 20,
): Event => ({
  eventType: 'status',
  data: {
    state: 'awaiting_local_tool_results',
    pending_local_tool_calls: [{ tool_call_id: toolCallId, name, args }],
  },
  sequence: seq,
});

// ---------------------------------------------------------------------------
// 1. Built-in classifiers: git / bash / file_edit
// ---------------------------------------------------------------------------
describe('classifier — built-in git/bash/file_edit', () => {
  it('file_edit is always mutating', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'file_edit', '{"path":"a.ts"}')] }),
      ),
    ).toBe(true);
  });

  it('git status is read-only', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'git', '{"action":"status"}')] }),
      ),
    ).toBe(false);
  });

  it('git commit is mutating', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'git', '{"action":"commit","message":"x"}')] }),
      ),
    ).toBe(true);
  });

  it('git diff is read-only', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'git', '{"action":"diff"}')] }),
      ),
    ).toBe(false);
  });

  it('bash with rm is mutating', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'bash', '{"command":"rm -rf /tmp/x"}')] }),
      ),
    ).toBe(true);
  });

  it('bash with read-only command is not mutating', () => {
    expect(
      hasCheckpointMutationDelta(
