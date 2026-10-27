// Recorded OpenAI Realtime transcription frames (L9 fixtures). Shapes follow
// the transcription guide [O7]: delta/completed events keyed by `item_id`,
// completion order across turns not guaranteed. No live provider call.
const deltaType = 'conversation.item.input_audio_transcription.delta';
const completedType = 'conversation.item.input_audio_transcription.completed';

export const frameDelta = (itemId: string, delta: string, contentIndex = 0): string =>
  JSON.stringify({ type: deltaType, item_id: itemId, content_index: contentIndex, delta });

export const frameCompleted = (itemId: string, transcript: string, languages?: Array<{ code: string }>): string =>
  JSON.stringify({
    type: completedType,
    item_id: itemId,
    content_index: 0,
    transcript,
    ...(languages ? { languages } : {}),
  });

/** Session lifecycle acks the adapter must tolerate without emitting transcript events. */
export const frameSessionAcks: readonly string[] = [
  JSON.stringify({ type: 'session.created', session: { id: 'sess-1' } }),
  JSON.stringify({ type: 'session.updated', session: { id: 'sess-1' } }),
];

/** French turn: two deltas then a completion with a detected language. */
export const frameScriptFr: readonly string[] = [
  ...frameSessionAcks,
  frameDelta('item_fr1', 'Bonjour, '),
  frameDelta('item_fr1', 'pouvez-vous me'),
  frameDelta('item_fr1', " m'entendre ?"),
  frameCompleted('item_fr1', "Bonjour, pouvez-vous m'entendre ?", [{ code: 'fr' }]),
];

/** English turn with a provider correction: deltas sum differs from the final. */
export const frameScriptEnCorrected: readonly string[] = [
  frameDelta('item_en1', 'Hello, '),
  frameDelta('item_en1', 'wordl'),
  frameCompleted('item_en1', 'Hello, world'),
];

/** Out-of-order completions: the second turn completes first. */
export const frameScriptOutOfOrder: readonly string[] = [
  frameDelta('item_a', 'premier '),
  frameDelta('item_b', 'second '),
  frameCompleted('item_b', 'second tour'),
  frameDelta('item_a', 'tour'),
  frameCompleted('item_a', 'premier tour'),
];

/** Malformed and unknown frames: the stream must continue after each error event. */
export const frameScriptInvalid: readonly string[] = [
  'not json{',
  JSON.stringify({ type: 'nope.unknown' }),
  JSON.stringify({ type: deltaType, content_index: 0, delta: 'missing item' }),
  JSON.stringify({ type: completedType, item_id: 'item_x' }),
  JSON.stringify({ type: 'error', code: 'session_expired', message: 'session expired' }),
  frameDelta('item_ok', 'kept '),
  frameCompleted('item_ok', 'kept going'),
];
