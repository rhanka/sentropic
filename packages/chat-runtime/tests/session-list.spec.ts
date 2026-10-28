/**
 * session-list.spec.ts — node-environment tests for sessionList pure helpers.
 *
 * Tests: projectSessionList (list sorting, edge cases) and
 * projectRestoredTimeline (history restore, content_delta collapse,
 * empty filtering).
 *
 * Environment: node (standard test-chat-ui target, no jsdom needed).
 */
import { describe, expect, it } from 'vitest';

import {
  type HistoryPayload,
  type SessionRow,
  projectRestoredTimeline,
  projectSessionList,
} from '../src/state/sessionList.js';

// ---------------------------------------------------------------------------
// projectSessionList
// ---------------------------------------------------------------------------

describe('projectSessionList — list sorting', () => {
  it('should return an empty array when given no rows', () => {
    expect(projectSessionList([])).toEqual([]);
  });

  it('should map a single row to a SessionListEntry', () => {
    const rows: SessionRow[] = [
      { id: 'abc', title: 'My session', createdAt: '2026-01-01T00:00:00Z' },
    ];
    const result = projectSessionList(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'abc',
      title: 'My session',
    });
    expect(typeof result[0]!.lastActivity).toBe('number');
    expect(result[0]!.lastActivity).toBeGreaterThan(0);
  });

  it('should sort sessions descending by lastActivity (most recent first)', () => {
    const rows: SessionRow[] = [
      { id: 'old', title: 'Old', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'new', title: 'New', createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' },
      { id: 'mid', title: 'Mid', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' },
    ];
    const result = projectSessionList(rows);
    expect(result.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('should use updatedAt over createdAt for lastActivity when present', () => {
    const rows: SessionRow[] = [
      {
        id: 'a',
        title: 'A',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-06-01T00:00:00Z', // recently updated
      },
      {
        id: 'b',
        title: 'B',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: null, // no updatedAt — falls back to createdAt
      },
    ];
    const result = projectSessionList(rows);
    // 'a' was last updated in June, 'b' was created in May → 'a' first
    expect(result[0]!.id).toBe('a');
    expect(result[1]!.id).toBe('b');
  });

  it('should return null title when row title is null', () => {
    const rows: SessionRow[] = [
      { id: 'x', title: null, createdAt: '2026-01-01T00:00:00Z' },
    ];
    const result = projectSessionList(rows);
    expect(result[0]!.title).toBeNull();
  });

  it('should return null title when row title is undefined', () => {
    const rows: SessionRow[] = [
      { id: 'x', createdAt: '2026-01-01T00:00:00Z' },
    ];
    const result = projectSessionList(rows);
    expect(result[0]!.title).toBeNull();
  });

  it('should handle Date objects in createdAt', () => {
    const rows: SessionRow[] = [
      { id: 'a', createdAt: new Date('2026-06-01T00:00:00Z') },
      { id: 'b', createdAt: new Date('2026-01-01T00:00:00Z') },
    ];
    const result = projectSessionList(rows);
    expect(result[0]!.id).toBe('a');
  });

  it('should produce a stable sort (same lastActivity preserves insertion order)', () => {
    const ts = '2026-01-01T00:00:00Z';
    const rows: SessionRow[] = [
      { id: 'first', createdAt: ts },
      { id: 'second', createdAt: ts },
    ];
    const result = projectSessionList(rows);
    // Both have same time — Array.prototype.sort is stable; original order preserved.
    expect(result.map((r) => r.id)).toEqual(['first', 'second']);
  });
});

// ---------------------------------------------------------------------------
// projectRestoredTimeline
// ---------------------------------------------------------------------------

describe('projectRestoredTimeline — history restore', () => {
  it('should return an empty array for an empty payload', () => {
    const payload: HistoryPayload = { messages: [] };
    expect(projectRestoredTimeline(payload)).toEqual([]);
  });

  it('should project a user message as kind user-message', () => {
    const payload: HistoryPayload = {
      messages: [{ id: 'u1', role: 'user', content: 'Hello' }],
    };
    const result = projectRestoredTimeline(payload);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('user-message');
    expect(result[0]!.key).toBe('message:u1');
  });

  it('should skip a user message with no content', () => {
    const payload: HistoryPayload = {
      messages: [{ id: 'u1', role: 'user', content: null }],
    };
    expect(projectRestoredTimeline(payload)).toHaveLength(0);
  });

  it('should project an assistant message as kind assistant-message', () => {
    const payload: HistoryPayload = {
      messages: [{ id: 'a1', role: 'assistant', content: 'Hi!' }],
      eventsByMessageId: {},
    };
    const result = projectRestoredTimeline(payload);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('assistant-message');
    if (result[0]!.kind === 'assistant-message') {
      expect(result[0]!.content).toBe('Hi!');
    }
  });

  it('should collapse content_delta events for assistant message', () => {
    const payload: HistoryPayload = {
      messages: [{ id: 'a1', role: 'assistant' }],
      eventsByMessageId: {
        a1: [
          { eventType: 'content_delta', sequence: 1, data: { delta: 'Hello' } },
          { eventType: 'content_delta', sequence: 2, data: { delta: ', world' } },
          { eventType: 'done', sequence: 3 },
        ],
      },
    };
    const result = projectRestoredTimeline(payload);
    expect(result).toHaveLength(1);
    if (result[0]!.kind === 'assistant-message') {
      expect(result[0]!.content).toBe('Hello, world');
    }
  });

  it('should sort content_delta events by sequence before collapsing', () => {
    const payload: HistoryPayload = {
      messages: [{ id: 'a1', role: 'assistant' }],
      eventsByMessageId: {
        a1: [
          { eventType: 'content_delta', sequence: 3, data: { delta: '3' } },
          { eventType: 'content_delta', sequence: 1, data: { delta: '1' } },
          { eventType: 'content_delta', sequence: 2, data: { delta: '2' } },
        ],
      },
    };
    const result = projectRestoredTimeline(payload);
    if (result[0]!.kind === 'assistant-message') {
      expect(result[0]!.content).toBe('123');
    }
  });

  it('should fall back to message.content when no content_delta events present', () => {
    const payload: HistoryPayload = {
      messages: [{ id: 'a1', role: 'assistant', content: 'Fallback text' }],
      eventsByMessageId: {
        a1: [{ eventType: 'status', sequence: 1, data: { state: 'started' } }],
      },
    };
    const result = projectRestoredTimeline(payload);
    if (result[0]!.kind === 'assistant-message') {
      expect(result[0]!.content).toBe('Fallback text');
    }
  });

  it('should skip an assistant message with no content and no events', () => {
    const payload: HistoryPayload = {
      messages: [{ id: 'a1', role: 'assistant', content: null }],
      eventsByMessageId: {},
    };
    expect(projectRestoredTimeline(payload)).toHaveLength(0);
  });

  it('should preserve message ordering (user → assistant → user)', () => {
    const payload: HistoryPayload = {
      messages: [
        { id: 'u1', role: 'user', content: 'Q1' },
        { id: 'a1', role: 'assistant', content: 'A1' },
        { id: 'u2', role: 'user', content: 'Q2' },
        { id: 'a2', role: 'assistant', content: 'A2' },
      ],
    };
    const result = projectRestoredTimeline(payload);
    expect(result.map((r) => r.key)).toEqual([
      'message:u1',
      'message:a1',
      'message:u2',
      'message:a2',
    ]);
  });

  it('should prefer content_delta collapse over message.content for assistant', () => {
    const payload: HistoryPayload = {
      messages: [{ id: 'a1', role: 'assistant', content: 'message.content text' }],
      eventsByMessageId: {
        a1: [
          { eventType: 'content_delta', sequence: 1, data: { delta: 'delta text' } },
        ],
      },
    };
    const result = projectRestoredTimeline(payload);
    if (result[0]!.kind === 'assistant-message') {
      expect(result[0]!.content).toBe('delta text');
    }
  });

  it('should skip system and tool messages with no content', () => {
    const payload: HistoryPayload = {
      messages: [
        { id: 's1', role: 'system', content: null },
        { id: 't1', role: 'tool', content: '' },
      ],
    };
    expect(projectRestoredTimeline(payload)).toHaveLength(0);
  });

  it('should work without eventsByMessageId (no events map provided)', () => {
    const payload: HistoryPayload = {
      messages: [
        { id: 'u1', role: 'user', content: 'Hello' },
        { id: 'a1', role: 'assistant', content: 'World' },
      ],
    };
    const result = projectRestoredTimeline(payload);
    expect(result).toHaveLength(2);
    if (result[1]!.kind === 'assistant-message') {
      expect(result[1]!.content).toBe('World');
    }
  });
});
