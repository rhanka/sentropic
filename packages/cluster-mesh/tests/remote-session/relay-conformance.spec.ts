// L-6 stream/close/abort conformance vectors: drives the real lane client
// engine (relay-lane-client) over scripted fake transports and pins the frozen
// iterator discipline (RC2.contract r3 runtimeComposition.stream/.termination):
// cold open on first next, single consumer, ≤ 8 events / ≤ 131072 encoded bytes
// then relay_backpressure, one typed error then done, return() cancels only its
// request, abort → relay_unavailable, close idempotent + outcome-neutral.
import { describe, expect, it } from 'vitest';
import { relayError } from '../../src/sessions/registry-types.js';
import { drain, engine, scriptedTransport, STREAM_ROUTE, MESH_ROUTE, SOURCE_ROUTE, tick } from './relay-conformance-kit.js';

describe('RC2 relay-1 L-6: stream/close/abort conformance vectors', () => {
  it('cold open on first next, single consumer, ordered events, done after EOF', async () => {
    const { transport, state } = scriptedTransport({
      records: [1, 2, 3].map((n) => ({ done: false, record: { routeId: 'action-stream', response: { n } } })),
    });
    const client = engine(transport);
    const iterator = client.stream(STREAM_ROUTE as never);
    expect(state.openStreamCalls).toBe(0); // cold: nothing before first next()
    const events = await drain(iterator);
    expect(state.openStreamCalls).toBe(1);
    expect(events).toEqual([
      { routeId: 'action-stream', response: { n: 1 } },
      { routeId: 'action-stream', response: { n: 2 } },
      { routeId: 'action-stream', response: { n: 3 } },
    ]);
    expect(await iterator.next()).toMatchObject({ done: true });
  });

  it('bounded queue: 9 events → 8 delivered, one relay_backpressure, then done; stream cancelled', async () => {
    const { transport, state } = scriptedTransport({
      records: Array.from({ length: 9 }, (_, i) => ({ done: false, record: { routeId: 'action-stream', response: { i } } })),
    });
    const events = await drain(engine(transport).stream(STREAM_ROUTE as never));
    expect(events.slice(0, 8).map((e) => (e as { response: { i: number } }).response.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(events[8]).toMatchObject({ routeId: 'action-stream', error: { code: 'relay_backpressure' } });
    expect(events.length).toBe(9);
    expect(state.cancelCalls).toBe(1);
  });

  it('bounded queue: > 131072 encoded bytes → relay_backpressure before the 8-event cap', async () => {
    const big = 'x'.repeat(20_000);
    const { transport } = scriptedTransport({
      records: Array.from({ length: 10 }, () => ({ done: false, record: { routeId: 'action-stream', response: { big } } })),
    });
    const events = await drain(engine(transport).stream(STREAM_ROUTE as never));
    expect(events.length).toBe(7); // 6 fit under 131072 bytes, then backpressure
    expect(events[6]).toMatchObject({ error: { code: 'relay_backpressure' } });
  });

  it('one typed error then done; partial-record EOF → relay_protocol_refused; wrong route → relay_lane_refused', async () => {
    const errTransport = scriptedTransport({ records: [{ done: false, record: { routeId: 'action-stream', error: relayError('relay_grant_revoked') } }] });
    const errEvents = await drain(engine(errTransport.transport).stream(STREAM_ROUTE as never));
    expect(errEvents).toEqual([{ routeId: 'action-stream', error: relayError('relay_grant_revoked') }]);

    const partial = scriptedTransport({ records: [{ done: false, record: { routeId: 'action-stream', response: {} } }, { done: true, partial: true }] });
    const partialEvents = await drain(engine(partial.transport).stream(STREAM_ROUTE as never));
    expect(partialEvents[1]).toMatchObject({ error: { code: 'relay_protocol_refused' } });
    expect(partialEvents.length).toBe(2);

    const wrong = scriptedTransport({ records: [{ done: false, record: { routeId: 'source-control', response: {} } }] });
    const wrongEvents = await drain(engine(wrong.transport).stream(STREAM_ROUTE as never));
    expect(wrongEvents).toEqual([{ routeId: 'action-stream', error: relayError('relay_lane_refused') }]);
  });

  it('return() cancels only its own request; other lanes keep working', async () => {
    const { transport, state } = scriptedTransport({
      records: [1, 2].map((n) => ({ done: false, record: { routeId: 'action-stream', response: { n } } })),
    });
    const client = engine(transport);
    const first = client.stream(STREAM_ROUTE as never);
    const second = client.stream(STREAM_ROUTE as never);
    expect(await first.next()).toMatchObject({ done: false });
    expect(await first.return()).toMatchObject({ done: true });
    expect(state.cancelCalls).toBe(1);
    const request = await client.request(MESH_ROUTE as never);
    expect(request).toMatchObject({ routeId: 'listing-grant-fetch', response: { status: 200 } });
    const rest = await drain(second);
    expect(rest.length).toBe(2);
  });

  it('abort while next() waits → one relay_unavailable then done', async () => {
    const { transport } = scriptedTransport({ hang: true });
    const client = engine(transport);
    const controller = new AbortController();
    const iterator = client.stream(STREAM_ROUTE as never, { signal: controller.signal });
    const pending = iterator.next();
    await tick();
    controller.abort();
    expect(await pending).toMatchObject({ done: false, value: { routeId: 'action-stream', error: { code: 'relay_unavailable' } } });
    expect(await iterator.next()).toMatchObject({ done: true });
  });

  it('close is idempotent and outcome-neutral; fences pending requests and streams', async () => {
    const { transport, state } = scriptedTransport({ hang: true, requestHang: true });
    const client = engine(transport);
    const pendingRequest = client.request(SOURCE_ROUTE as never);
    const iterator = client.stream(STREAM_ROUTE as never);
    const pendingNext = iterator.next();
    await tick();
    await expect(client.close({ reason: 'relay_auth_required' })).resolves.toEqual({ status: 'closed' });
    await expect(client.close({ reason: 'relay_unavailable' })).resolves.toEqual({ status: 'closed' });
    expect(Object.keys(await client.close({ reason: 'relay_unavailable' }))).toEqual(['status']);
    expect(await pendingRequest).toMatchObject({ routeId: 'source-renew', error: { code: 'relay_unavailable' } });
    expect(await pendingNext).toMatchObject({ done: false, value: { error: { code: 'relay_unavailable' } } });
    expect(await iterator.next()).toMatchObject({ done: true });
    expect(await client.request(MESH_ROUTE as never)).toMatchObject({ error: { code: 'relay_unavailable' } });
    expect(state.closeCalls).toBe(3); // idempotent: result stays outcome-neutral
  });
});
