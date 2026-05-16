/**
 * BR14b Lot 19 — pure helpers (`steer.ts`) unit tests.
 * Covers `normalizeSteerMessage` + `consumePendingSteerMessages`.
 *
 * The closure these helpers replaced lived in `chat-service.ts`
 * (`runAssistantGeneration`) and captured `lastObservedStreamSequence` +
 * `options.assistantMessageId`. The pure helper now takes both as inputs
 * and returns the advanced cursor as `nextSinceSequence`. Tests use the
 * `InMemoryStreamBuffer` reference adapter so behavior is exercised end
 * to end through the `StreamBuffer` port.
 */
import { describe, expect, it } from 'vitest';

import {
  consumePendingSteerMessages,
  normalizeSteerMessage,
} from '../src/steer.js';
import { InMemoryStreamBuffer } from '../src/in-memory/stream-buffer.js';

describe('normalizeSteerMessage', () => {
  it('returns the value when already trimmed', () => {
    expect(normalizeSteerMessage('hello')).toBe('hello');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSteerMessage('  hi  ')).toBe('hi');
  });

  it('collapses internal whitespace runs into single spaces', () => {
    expect(normalizeSteerMessage('a   b\t\nc')).toBe('a b c');
  });

  it('returns an empty string when input is whitespace only', () => {
    expect(normalizeSteerMessage('   \n\t')).toBe('');
  });

  it('returns an empty string when input is empty', () => {
    expect(normalizeSteerMessage('')).toBe('');
  });
});

describe('consumePendingSteerMessages', () => {
  const seedStartedStatus = async (
    buffer: InMemoryStreamBuffer,
    streamId: string,
    sequence: number,
  ) => {
    await buffer.append(streamId, 'status', { state: 'started' }, sequence, streamId);
  };

  it('returns empty messages and preserves cursor when no events past sinceSequence', async () => {
    const buffer = new InMemoryStreamBuffer();
    const streamId = 'msg-1';
    await seedStartedStatus(buffer, streamId, 1);

    const result = await consumePendingSteerMessages({
      streamBuffer: buffer,
      streamId,
      sinceSequence: 1,
    });
    expect(result.messages).toEqual([]);
    expect(result.nextSinceSequence).toBe(1);
  });

  it('returns empty messages but advances cursor when only non-steer events past cursor', async () => {
    const buffer = new InMemoryStreamBuffer();
    const streamId = 'msg-1';
    await seedStartedStatus(buffer, streamId, 1);
    await buffer.append(streamId, 'content_delta', { delta: 'hi' }, 2, streamId);
    await buffer.append(
      streamId,
      'status',
      { state: 'reasoning_effort_selected', effort: 'medium', by: 'auto' },
      3,
      streamId,
    );

    const result = await consumePendingSteerMessages({
      streamBuffer: buffer,
      streamId,
      sinceSequence: 1,
    });
    expect(result.messages).toEqual([]);
    expect(result.nextSinceSequence).toBe(3);
  });

  it('returns steer_received messages in sequence order', async () => {
    const buffer = new InMemoryStreamBuffer();
    const streamId = 'msg-1';
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received', message: 'first directive' },
      1,
      streamId,
    );
    await buffer.append(streamId, 'content_delta', { delta: 'noise' }, 2, streamId);
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received', message: 'second  directive' },
      3,
      streamId,
    );

    const result = await consumePendingSteerMessages({
      streamBuffer: buffer,
      streamId,
      sinceSequence: 0,
    });
    expect(result.messages).toEqual(['first directive', 'second directive']);
    expect(result.nextSinceSequence).toBe(3);
  });

  it('honors sinceSequence cursor and skips earlier steer events', async () => {
    const buffer = new InMemoryStreamBuffer();
    const streamId = 'msg-1';
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received', message: 'old' },
      1,
      streamId,
    );
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received', message: 'fresh' },
      2,
      streamId,
    );

    const result = await consumePendingSteerMessages({
      streamBuffer: buffer,
      streamId,
      sinceSequence: 1,
    });
    expect(result.messages).toEqual(['fresh']);
    expect(result.nextSinceSequence).toBe(2);
  });

  it('skips malformed steer_received payloads without crashing', async () => {
    const buffer = new InMemoryStreamBuffer();
    const streamId = 'msg-1';
    // missing message field
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received' },
      1,
      streamId,
    );
    // message is not a string
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received', message: 42 },
      2,
      streamId,
    );
    // valid one for control
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received', message: 'ok' },
      3,
      streamId,
    );
    // null data — should be safely ignored
    await buffer.append(streamId, 'status', null, 4, streamId);
    // empty message after normalization (whitespace only) — must be dropped
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received', message: '   \n\t' },
      5,
      streamId,
    );

    const result = await consumePendingSteerMessages({
      streamBuffer: buffer,
      streamId,
      sinceSequence: 0,
    });
    expect(result.messages).toEqual(['ok']);
    expect(result.nextSinceSequence).toBe(5);
  });

  it('ignores status events whose state is not steer_received', async () => {
    const buffer = new InMemoryStreamBuffer();
    const streamId = 'msg-1';
    await buffer.append(
      streamId,
      'status',
      { state: 'run_interrupted_for_steer', steer_count: 1, latest_message: 'x' },
      1,
      streamId,
    );
    await buffer.append(
      streamId,
      'status',
      { state: 'steer_received', message: 'real' },
      2,
      streamId,
    );

    const result = await consumePendingSteerMessages({
      streamBuffer: buffer,
      streamId,
      sinceSequence: 0,
    });
    expect(result.messages).toEqual(['real']);
    expect(result.nextSinceSequence).toBe(2);
  });
});
