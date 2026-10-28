// Recorded OpenAI Realtime transcription frames (L9 fixtures). Shapes follow
// the transcription guide [O7]: delta/completed events keyed by `item_id`,
// completion order across turns not guaranteed. No live provider call.
const deltaType = 'conversation.item.input_audio_transcription.delta';
const completedType = 'conversation.item.input_audio_transcription.completed';
const committedType = 'input_audio_buffer.committed';

export const frameDelta = (itemId: string, delta: string, contentIndex = 0): string =>
  JSON.stringify({ type: deltaType, item_id: itemId, content_index: contentIndex, delta });

export const frameCommitted = (itemId: string, previousItemId?: string): string =>
  JSON.stringify({
    type: committedType,
    item_id: itemId,
    ...(previousItemId ? { previous_item_id: previousItemId } : {}),
  });

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

/** French turn: deltas stream before the commit, the bind, then the completion. */
export const frameScriptFr: readonly string[] = [
  ...frameSessionAcks,
  frameDelta('item_fr1', 'Bonjour, '),
  frameDelta('item_fr1', 'pouvez-vous me'),
  frameCommitted('item_fr1'),
  frameDelta('item_fr1', " m'entendre ?"),
  frameCompleted('item_fr1', "Bonjour, pouvez-vous m'entendre ?", [{ code: 'fr' }]),
];

/** English turn with a provider correction: deltas sum differs from the final. */
export const frameScriptEnCorrected: readonly string[] = [
  frameDelta('item_en1', 'Hello, '),
  frameCommitted('item_en1'),
  frameDelta('item_en1', 'wordl'),
  frameCompleted('item_en1', 'Hello, world'),
];

/** Out-of-order completions: the second turn completes first. */
export const frameScriptOutOfOrder: readonly string[] = [
  frameDelta('item_a', 'premier '),
  frameCommitted('item_a'),
  frameDelta('item_b', 'second '),
  frameCommitted('item_b', 'item_a'),
  frameCompleted('item_b', 'second tour'),
  frameDelta('item_a', 'tour'),
  frameCompleted('item_a', 'premier tour'),
];

/** Completion without prior deltas: binds the committed turn at revision 1. */
export const frameScriptCompletedOnly: readonly string[] = [
  frameCommitted('item_solo'),
  frameCompleted('item_solo', 'un tour silencieux', [{ code: 'fr' }]),
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
