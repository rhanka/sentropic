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
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'bash', '{"command":"cat package.json"}')] }),
      ),
    ).toBe(false);
  });

  it('plan tool is never mutating', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'plan', '{}')] }),
      ),
    ).toBe(false);
  });

  it('returns false when checkpoint is null', () => {
    expect(hasCheckpointMutationDelta(null, [], new Map())).toBe(false);
  });

  it('returns false when anchorSequence is 0 or negative', () => {
    expect(
      hasCheckpointMutationDelta({ anchorSequence: 0 }, [], new Map()),
    ).toBe(false);
    expect(
      hasCheckpointMutationDelta({ anchorSequence: -1 }, [], new Map()),
    ).toBe(false);
  });

  it('only scans assistant messages after the anchor sequence', () => {
    // The file_edit is on sequence 1 (same as anchor) — not "after", so false.
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 2 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'file_edit', '{"path":"x"}')] }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. isMutatingTool hook override (domain tools)
// ---------------------------------------------------------------------------
describe('classifier — isMutatingTool hook override', () => {
  const domainOpts = {
    isMutatingTool: (name: string) =>
      ['_create', '_update', '_delete'].some((s) => name.toLowerCase().endsWith(s)),
  };

  it('marks folder_create as mutating via hook', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'folder_create', '{}')] }),
        domainOpts,
      ),
    ).toBe(true);
  });

  it('marks folder_update as mutating via hook', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'folder_update', '{"folderId":"f1"}')] }),
        domainOpts,
      ),
    ).toBe(true);
  });

  it('does NOT mark folder_create without the hook (unknown tool, falls through)', () => {
    expect(
      hasCheckpointMutationDelta(
        { anchorSequence: 1 },
        [
          { id: 'u1', role: 'user', sequence: 1 },
          { id: 'a1', role: 'assistant', sequence: 2 },
        ],
        makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'folder_create', '{}')] }),
        // No isMutatingTool hook — folder_create is unknown, treated as non-mutating
      ),
    ).toBe(false);
  });

  it('humanizeMutation hook produces labelled preview items', () => {
    const preview = getCheckpointMutationPreviewItems(
      { anchorSequence: 1 },
      [
        { id: 'u1', role: 'user', sequence: 1 },
        { id: 'a1', role: 'assistant', sequence: 2 },
      ],
      makeEvents({ id: 'a1', events: [toolCallStartEvent('tc1', 'folder_update', '{"folderId":"fld_42"}')] }),
      {
        ...domainOpts,
        humanizeMutation: (toolName, argsText) => {
          let record: Record<string, unknown> | null = null;
          try {
            const p: unknown = JSON.parse(argsText);
            if (p && typeof p === 'object' && !Array.isArray(p)) record = p as Record<string, unknown>;
          } catch { /**/ }
          const entity = toolName.replace(/_(create|update|delete)$/i, '');
          const label = entity.replace(/_/g, ' ').trim();
          const idCandidate = String(record?.folderId ?? record?.id ?? '').trim();
          const action = toolName.split('_').pop() ?? '';
          return idCandidate ? `${label} ${action}: ${idCandidate}` : `${label} ${action}`;
        },
      },
    );
    expect(preview).toEqual(['folder update: fld_42']);
  });
});

// ---------------------------------------------------------------------------
// 3. isLocalToolName default ()=>false equivalence proof
// ---------------------------------------------------------------------------
describe('classifier — isLocalToolName default equivalence', () => {
  /**
   * PROOF: isLocalToolName defaults to () => false.
   * parsePendingLocalToolCallsFromStatusPayload filters by isLocalToolName:
   * any status event with pending_local_tool_calls will produce ZERO calls when
   * isLocalToolName = ()=>false, regardless of the tool name.
   *
