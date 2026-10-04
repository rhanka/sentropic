import { NativeUsageObserver, type RawNativeUsageUpdate } from '../../src/native-usage.js';
import { NativeSseFramer } from '../../src/native-sse.js';

export const NATIVE_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1'] as const;
export const CACHE_START: RawNativeUsageUpdate = {
  input_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 200,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 }, output_tokens: 1,
};
export const observeNativeEvent = (observer: NativeUsageObserver, type: string, fields: Record<string, unknown> = {}): void => {
  const bytes = new TextEncoder().encode(`event: ${type}\r\ndata: ${JSON.stringify({ type, ...fields })}\r\n\r\n`);
  const framer = new NativeSseFramer();
  for (const frame of [...framer.push(bytes), ...framer.finish()]) observer.observeFrame(frame);
};
export const nativeUsageTurn = (
  model: string = NATIVE_MODELS[0], start: RawNativeUsageUpdate = CACHE_START,
  delta: RawNativeUsageUpdate = { output_tokens: 500 }, stop = true, defaultTtlEligible = false,
): NativeUsageObserver => {
  const observer = new NativeUsageObserver(model, defaultTtlEligible);
  observeNativeEvent(observer, 'message_start', { message: { model, usage: start } });
  observeNativeEvent(observer, 'message_delta', { usage: delta });
  if (stop) observeNativeEvent(observer, 'message_stop');
  return observer;
};
