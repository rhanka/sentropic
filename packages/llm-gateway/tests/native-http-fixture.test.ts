import { expect, it } from 'vitest';
import { nativeHttpFixture } from './fixtures/anthropic-native-http.js';
import { nativeHarness, sendNative } from './fixtures/native-flow.js';

it('uses only the loopback fake HTTP provider and captures serialized bytes', async () => {
  const upstream = await nativeHttpFixture();
  try {
    const h = nativeHarness({ execute: upstream.execute });
    const response = await sendNative(h);
    expect(response.status).toBe(200);
    expect((await response.json()).safeguard_results).toEqual({ future: ['雪'] });
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]!.path).toBe('/v1/messages');
    expect(new Uint8Array(upstream.requests[0]!.bytes)).toEqual(
      new TextEncoder().encode(JSON.stringify({ ...h.request.body, stream: false })));
    expect(h.recorder.settlements).toHaveLength(1);
  } finally { await upstream.close(); }
});
