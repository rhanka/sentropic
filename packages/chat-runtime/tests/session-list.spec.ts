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
