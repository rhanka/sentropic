import { describe, expect, it } from 'vitest';
import {
  chatMessageFeedbackUrl,
  chatMessageRetryUrl,
  chatMessageStopUrl,
  chatMessageToolResultsUrl,
  chatMessagesUrl,
  chatSessionCheckpointCreateUrl,
  chatSessionCheckpointRestoreUrl,
  chatSessionCheckpointsUrl,
  chatSessionHistoryUrl,
  chatSessionUrl,
  chatSessionsUrl,
  formatChatApiError,
} from '$lib/chat/session-adapter';

describe('chat session adapter', () => {
  it('builds chat session and message endpoint URLs in one place', () => {
    expect(chatSessionsUrl()).toBe('/chat/sessions');
    expect(chatSessionUrl('session/1')).toBe('/chat/sessions/session%2F1');
    expect(chatSessionHistoryUrl('session/1', 'summary')).toBe(
      '/chat/sessions/session%2F1/history?runtimeDetails=summary',
    );
    expect(chatSessionCheckpointsUrl('session/1', 20)).toBe(
      '/chat/sessions/session%2F1/checkpoints?limit=20',
    );
    expect(chatSessionCheckpointCreateUrl('session/1')).toBe(
      '/chat/sessions/session%2F1/checkpoints',
    );
    expect(chatSessionCheckpointRestoreUrl('session/1', 'checkpoint/1')).toBe(
      '/chat/sessions/session%2F1/checkpoints/checkpoint%2F1/restore',
    );
    expect(chatMessagesUrl()).toBe('/chat/messages');
    expect(chatMessageRetryUrl('message/1')).toBe('/chat/messages/message%2F1/retry');
    expect(chatMessageStopUrl('message/1')).toBe('/chat/messages/message%2F1/stop');
    expect(chatMessageFeedbackUrl('message/1')).toBe(
      '/chat/messages/message%2F1/feedback',
    );
    expect(chatMessageToolResultsUrl('message/1')).toBe(
      '/chat/messages/message%2F1/tool-results',
    );
  });

  it('formats API errors structurally without importing the API client', () => {
    expect(formatChatApiError({ status: 409, message: 'Conflict' }, 'Fallback')).toBe(
      'HTTP 409: Conflict',
    );
    expect(formatChatApiError({ status: 0, message: 'Offline' }, 'Fallback')).toBe(
      'Offline',
    );
    expect(formatChatApiError(new Error('Generic'), 'Fallback')).toBe('Fallback');
  });
});
