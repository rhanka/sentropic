import { describe, expect, it, vi } from 'vitest';
import { StreamHistory } from '../src/client/streamHistory.js';
import type { StreamHubEvent } from '../src/client/streamTypes.js';

const contentDelta = (
  sequence: number,
  delta: string,
): StreamHubEvent => ({
  type: 'content_delta',
  streamId: 'stream-large',
  sequence,
  data: { delta },
});

describe('stream throughput history guards', () => {
  it('aggregates a long ordered content stream into one replay event', () => {
    const history = new StreamHistory({ maxEventsPerStream: 20 });
    for (let sequence = 1; sequence <= 2000; sequence += 1) {
      history.record(contentDelta(sequence, 'x'));
    }

    const onEvent = vi.fn();
    history.replayStream('stream-large', onEvent);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      type: 'content_delta',
      streamId: 'stream-large',
      sequence: 2000,
      data: { delta: 'x'.repeat(2000) },
    });
  });

  it('dedupes repeated content sequences after reconnect replay', () => {
    const history = new StreamHistory({ maxEventsPerStream: 20 });
    history.record(contentDelta(1, 'a'));
    history.record(contentDelta(2, 'b'));
    history.record(contentDelta(2, 'b'));
    history.record(contentDelta(1, 'a'));
    history.record(contentDelta(3, 'c'));

    const onEvent = vi.fn();
    history.replayStream('stream-large', onEvent);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0][0]).toEqual({
      type: 'content_delta',
      streamId: 'stream-large',
      sequence: 3,
      data: { delta: 'abc' },
    });
  });

  it('keeps a terminal event after the aggregated content flush', () => {
    const history = new StreamHistory({ maxEventsPerStream: 20 });
    history.record(contentDelta(1, 'hel'));
    history.record(contentDelta(2, 'lo'));
    history.record({
      type: 'done',
      streamId: 'stream-large',
      sequence: 3,
      data: {},
    });

    const onEvent = vi.fn();
    history.replayStream('stream-large', onEvent);

    expect(onEvent.mock.calls.map((call) => call[0])).toEqual([
      {
        type: 'content_delta',
        streamId: 'stream-large',
        sequence: 2,
        data: { delta: 'hello' },
      },
      {
        type: 'done',
        streamId: 'stream-large',
        sequence: 3,
        data: {},
      },
    ]);
  });
});
