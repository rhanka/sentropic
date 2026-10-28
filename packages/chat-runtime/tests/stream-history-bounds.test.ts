import { describe, expect, it, vi } from 'vitest';
import { StreamHistory } from '../src/client/streamHistory.js';
import type { StreamHubEvent } from '../src/client/streamTypes.js';

const eventFor = (
  streamId: string,
  sequence: number,
  type = `event_${sequence}`,
): StreamHubEvent => ({
  type,
  streamId,
  sequence,
  data: { sequence },
});

describe('stream history bounds', () => {
  it('bounds the number of replayed events per stream', () => {
    const history = new StreamHistory({ maxEventsPerStream: 3 });
    for (let sequence = 1; sequence <= 6; sequence += 1) {
      history.record(eventFor('bounded-stream', sequence));
    }

    const onEvent = vi.fn();
    history.replayStream('bounded-stream', onEvent);

    expect(onEvent.mock.calls.map((call) => call[0].sequence)).toEqual([4, 5, 6]);
  });

  it('bounds the number of retained stream ids', () => {
    const history = new StreamHistory({ maxStreamIds: 2 });
    history.record(eventFor('stream-a', 1));
    history.record(eventFor('stream-b', 1));
    history.record(eventFor('stream-c', 1));

    const onEvent = vi.fn();
    history.replayAll(onEvent);

    expect(onEvent.mock.calls.map((call) => call[0].streamId)).toEqual([
      'stream-b',
      'stream-c',
    ]);
  });

  it('keeps long GPT-like streams bounded without splitting consecutive deltas', () => {
    const history = new StreamHistory({ maxEventsPerStream: 5 });
    for (let sequence = 1; sequence <= 1500; sequence += 1) {
      history.record({
        type: 'reasoning_delta',
        streamId: 'gpt-like',
        sequence,
        data: { delta: 'r' },
      });
    }
    for (let sequence = 1501; sequence <= 3000; sequence += 1) {
      history.record({
        type: 'content_delta',
        streamId: 'gpt-like',
        sequence,
        data: { delta: 'c' },
      });
    }

    const onEvent = vi.fn();
    history.replayStream('gpt-like', onEvent);

    expect(onEvent.mock.calls).toHaveLength(2);
    expect(onEvent.mock.calls[0][0].data.delta).toHaveLength(1500);
    expect(onEvent.mock.calls[1][0].data.delta).toHaveLength(1500);
  });
});
