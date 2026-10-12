/**
 * Responses SSE encoder (spec §16.5): ordered lifecycle frames with
 * monotonic sequence numbers over the shared accumulator. The accumulator
 * stays the single source for final content, so replaced snapshots never
 * duplicate streamed fragments. Exactly one terminal frame; no Chat
 * `[DONE]`. Overflow or protocol breach aborts the source and fails
 * neutrally with partial output.
 */
import type { StreamEvent } from '@sentropic/llm-mesh';
import type { GatewayDispatchStreamEvent } from './ports/dispatch.js';
import {
  createResponsesAccumulator,
  envelopeFromSnapshot,
  finalizeMessageItem,
  ResponsesBoundError,
  type ResponsesLimits,
} from './responses-egress.js';
import { frameResponsesEvent } from './wire.js';

type SeenKind = 'message' | 'reasoning' | 'tool';

export const encodeResponsesStream = (input: {
  responseId: string;
  model: string;
  createdAt: number;
  events: AsyncIterable<StreamEvent>;
  limits?: ResponsesLimits;
}): AsyncGenerator<GatewayDispatchStreamEvent, void, unknown> => {
  const acc = createResponsesAccumulator(input.limits);
  let seq = 0;
  let opened = false;
  const announced = new Map<string, { outputIndex: number; kind: SeenKind }>();

  const frame = (eventType: string, data: Record<string, unknown>): GatewayDispatchStreamEvent => ({
    raw: frameResponsesEvent(eventType, { ...data, type: eventType, sequence_number: seq++ }),
  });

  function* open(): Generator<GatewayDispatchStreamEvent> {
    if (opened) return;
    opened = true;
    const response = { id: input.responseId, object: 'response', model: input.model };
    yield frame('response.created', { response });
    yield frame('response.in_progress', { response });
  }

  function* close(): Generator<GatewayDispatchStreamEvent> {
    const snap = acc.snapshot();
    const byId = new Map(snap.items.map((item) => [String(item.id), item]));
    for (const [itemId, seen] of announced) {
      if (seen.kind === 'message') {
        const item = byId.get(itemId);
        const text = item ? (item.content as Array<Record<string, unknown>>)
          .filter((part) => part.type === 'output_text').map((part) => String(part.text ?? '')).join('') : '';
        const done = item ? finalizeMessageItem(item, snap.terminal.finishReason) : item;
        yield frame('response.output_text.done', { item_id: itemId, output_index: seen.outputIndex, content_index: 0, text });
        yield frame('response.content_part.done', { item_id: itemId, output_index: seen.outputIndex, content_index: 0,
          part: { type: 'output_text', text, annotations: [] } });
        if (done) yield frame('response.output_item.done', { output_index: seen.outputIndex, item: done });
      } else if (seen.kind === 'reasoning') {
        const item = byId.get(itemId);
        const text = item ? (item.summary as Array<Record<string, unknown>>).map((part) => String(part.text ?? '')).join('') : '';
        yield frame('response.reasoning_summary_part.done', { item_id: itemId, output_index: seen.outputIndex, summary_index: 0,
          part: { type: 'summary_text', text } });
        if (item) yield frame('response.output_item.done', { output_index: seen.outputIndex, item });
      } else {
        const item = byId.get(itemId);
        const args = item && typeof item.arguments === 'string' ? item.arguments : '';
        yield frame('response.function_call_arguments.done', { item_id: itemId, output_index: seen.outputIndex, arguments: args });
        if (item) yield frame('response.output_item.done', { output_index: seen.outputIndex, item });
      }
    }
    const envelope = envelopeFromSnapshot({
      responseId: input.responseId, model: input.model, createdAt: input.createdAt, snap,
    });
    const terminal = envelope.status === 'completed' ? 'response.completed'
      : envelope.status === 'incomplete' ? 'response.incomplete' : 'response.failed';
    yield frame(terminal, { response: envelope });
  };

  const fail = function* (message: string, code: string): Generator<GatewayDispatchStreamEvent> {
    yield* open();
    acc.observe({ type: 'error', data: { providerId: 'local', message, code, retryable: false } });
    yield* close();
  };

  return (async function* (): AsyncGenerator<GatewayDispatchStreamEvent> {
    for await (const event of input.events) {
      try {
        if (event.type === 'content_delta' || event.type === 'reasoning_delta'
          || event.type === 'tool_call_start' || event.type === 'tool_call_delta') {
          const alloc = acc.observe(event);
          if (!alloc) continue;
          yield* open();
          const seen = announced.get(alloc.itemId);
          if (event.type === 'content_delta') {
            if (!seen) {
              announced.set(alloc.itemId, { outputIndex: alloc.outputIndex, kind: 'message' });
              yield frame('response.output_item.added', { output_index: alloc.outputIndex,
                item: { id: alloc.itemId, status: 'in_progress', type: 'message', role: 'assistant', content: [] } });
              yield frame('response.content_part.added', { item_id: alloc.itemId, output_index: alloc.outputIndex, content_index: 0,
                part: { type: 'output_text', text: '', annotations: [] } });
            }
            yield frame('response.output_text.delta', { item_id: alloc.itemId, output_index: alloc.outputIndex, content_index: 0, delta: event.data.delta });
          } else if (event.type === 'reasoning_delta') {
            if (!seen) {
              announced.set(alloc.itemId, { outputIndex: alloc.outputIndex, kind: 'reasoning' });
              yield frame('response.output_item.added', { output_index: alloc.outputIndex,
                item: { id: alloc.itemId, status: 'in_progress', type: 'reasoning', summary: [] } });
              yield frame('response.reasoning_summary_part.added', { item_id: alloc.itemId, output_index: alloc.outputIndex, summary_index: 0,
                part: { type: 'summary_text', text: '' } });
            }
            if (!alloc.replaced) {
              yield frame('response.reasoning_summary_text.delta', { item_id: alloc.itemId, output_index: alloc.outputIndex, summary_index: 0, delta: event.data.delta });
            }
          } else if (event.type === 'tool_call_start') {
            if (!seen) {
              announced.set(alloc.itemId, { outputIndex: alloc.outputIndex, kind: 'tool' });
              yield frame('response.output_item.added', { output_index: alloc.outputIndex,
                item: { id: alloc.itemId, status: 'in_progress', type: 'function_call',
                  call_id: event.data.providerCallId ?? event.data.toolCallId, name: event.data.name, arguments: '' } });
            }
            const args = event.data.argumentsText ?? '';
            if (args && !alloc.replaced) {
              yield frame('response.function_call_arguments.delta', { item_id: alloc.itemId, output_index: alloc.outputIndex, delta: args });
            }
          } else if (event.data.delta) {
            yield frame('response.function_call_arguments.delta', { item_id: alloc.itemId, output_index: alloc.outputIndex, delta: event.data.delta });
          }
        } else if (event.type === 'done' || event.type === 'error') {
          yield* open();
          acc.observe(event);
          yield* close();
          return;
        }
      } catch (error) {
        const bound = error instanceof ResponsesBoundError ? error
          : new ResponsesBoundError('responses_protocol', 'responses stream failed');
        yield* fail(bound.message, bound.code);
        return;
      }
    }
    yield* fail('upstream closed without a terminal event', 'premature_eof');
  })();
};
