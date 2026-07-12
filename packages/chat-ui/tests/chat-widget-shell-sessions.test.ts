import { describe, expect, it } from 'vitest';

import {
  findActiveChatSession,
  formatChatSessionLabel,
  reduceSessionDeleteConfirm,
  resolveSessionsBar,
  type ChatWidgetSession,
  type SessionsBarLabels,
} from '../src/state/chatWidgetShell';

const LABELS: SessionsBarLabels = {
  none: 'No conversation',
  loading: 'Loading…',
  defaultTitle: (shortId) => `Conversation ${shortId}`,
};

const SESSIONS: ChatWidgetSession[] = [
  { id: 'abcdef123456', title: 'Résumé du cas d’usage' },
  { id: '123456abcdef', title: null },
];

describe('chatWidgetShell sessions bar (gold shell S1a)', () => {
  it('formats a titled session with its title', () => {
    expect(formatChatSessionLabel(SESSIONS[0], LABELS.defaultTitle)).toBe(
      'Résumé du cas d’usage',
    );
  });

  it('falls back to the default title with the 6-char short id for untitled sessions', () => {
    expect(formatChatSessionLabel(SESSIONS[1], LABELS.defaultTitle)).toBe(
      'Conversation 123456',
    );
  });

  it('finds the active session by id and returns null when unselected or unknown', () => {
    expect(findActiveChatSession(SESSIONS, 'abcdef123456')).toBe(SESSIONS[0]);
    expect(findActiveChatSession(SESSIONS, null)).toBeNull();
    expect(findActiveChatSession(SESSIONS, 'missing')).toBeNull();
  });

  it('keeps delete-confirm only while a session is selected', () => {
    expect(reduceSessionDeleteConfirm(true, 'abcdef123456')).toBe(true);
    expect(reduceSessionDeleteConfirm(true, null)).toBe(false);
    expect(reduceSessionDeleteConfirm(false, 'abcdef123456')).toBe(false);
  });

  it('resolves loading label with priority over active/none', () => {
    const state = resolveSessionsBar({
      sessions: SESSIONS,
      sessionId: 'abcdef123456',
      loading: true,
      deleteConfirmPending: false,
      labels: LABELS,
    });
    expect(state.labelKind).toBe('loading');
    expect(state.label).toBe('Loading…');
    expect(state.activeSession).toBe(SESSIONS[0]);
    expect(state.canDelete).toBe(true);
  });

  it('resolves the active session label when selected and not loading', () => {
    const state = resolveSessionsBar({
      sessions: SESSIONS,
      sessionId: '123456abcdef',
      loading: false,
      deleteConfirmPending: true,
      labels: LABELS,
    });
    expect(state.labelKind).toBe('active');
    expect(state.label).toBe('Conversation 123456');
    expect(state.deleteConfirmPending).toBe(true);
  });

  it('resolves the none label and disables delete when nothing is selected', () => {
    const state = resolveSessionsBar({
      sessions: SESSIONS,
      sessionId: null,
      loading: false,
      deleteConfirmPending: true,
      labels: LABELS,
    });
    expect(state.labelKind).toBe('none');
    expect(state.label).toBe('No conversation');
    expect(state.canDelete).toBe(false);
    expect(state.deleteConfirmPending).toBe(false);
  });
});
