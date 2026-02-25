import { describe, expect, it } from 'vitest';

import { GeminiProviderRuntime } from '../../src/services/providers/gemini-provider';

function makeReadableStream(payload: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

async function collectEvents(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('GeminiProviderRuntime SSE parsing', () => {
  it('parses multiple SSE events separated with CRLF boundaries', async () => {
    const runtime = new GeminiProviderRuntime() as unknown as {
      readSse: (body: ReadableStream<Uint8Array>) => AsyncIterable<unknown>;
    };

    const rawSse = [
      'data: {"chunk":"first"}',
      '',
      'data: {"chunk":"second"}',
      '',
    ].join('\r\n');

    const events = await collectEvents(runtime.readSse(makeReadableStream(rawSse)));
    expect(events).toEqual([{ chunk: 'first' }, { chunk: 'second' }]);
  });

  it('still parses SSE events with LF boundaries', async () => {
    const runtime = new GeminiProviderRuntime() as unknown as {
      readSse: (body: ReadableStream<Uint8Array>) => AsyncIterable<unknown>;
    };

    const rawSse = [
      'data: {"chunk":"alpha"}',
      '',
      'data: {"chunk":"beta"}',
      '',
    ].join('\n');

    const events = await collectEvents(runtime.readSse(makeReadableStream(rawSse)));
    expect(events).toEqual([{ chunk: 'alpha' }, { chunk: 'beta' }]);
  });
});
