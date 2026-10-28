// Recorded Mistral Voxtral realtime frames (L13 fixtures). Shapes follow the
// Mistral Studio audio docs: `session.created` first, `session.updated` echo,
// append-only `transcription.text.delta`, `transcription.done` with the
// transcript of record, `error{code,message}`. One provider stream serves one
// client turn: `input_audio.end` finishes the stream. No live provider call.
export const frameCreated = (model = 'voxtral-mini-transcribe-realtime-3'): string =>
  JSON.stringify({ type: 'session.created', session: { model, audio_format: { encoding: 'pcm_s16le', sample_rate: 24000 } } });

export const frameUpdated = (delayMs = 480, language = 'fr'): string =>
  JSON.stringify({ type: 'session.updated',
    session: { audio_format: { encoding: 'pcm_s16le', sample_rate: 24000 },
      target_streaming_delay_ms: delayMs, language } });

export const frameDelta = (text: string): string =>
  JSON.stringify({ type: 'transcription.text.delta', text });

export const frameDone = (text: string, language?: string, withUsage = false): string =>
  JSON.stringify({ type: 'transcription.done', text,
    ...(language ? { language } : {}),
    ...(withUsage ? { usage: { input_audio_seconds: 1.5, output_text_tokens: 12 } } : {}) });

export const frameError = (message: string, code = 'session_expired'): string =>
  JSON.stringify({ type: 'error', error: { message, code } });

export const frameTurnStart = (timeS = 1.2): string =>
  JSON.stringify({ type: 'turn.start', time_s: timeS });

export const frameSegment = (text: string): string =>
  JSON.stringify({ type: 'transcription.segment', text, speaker_id: 'speaker_0', start: 0.4, end: 1.1 });

/** French turn: created, deltas, then the done record carrying the language. */
export const frameScriptFr: readonly string[] = [
  frameDelta('Bonjour, '),
  frameDelta("pouvez-vous m'entendre ?"),
  frameDone("Bonjour, pouvez-vous m'entendre ?", 'fr'),
];

/** Deltas sum to the done text: append-only, no correction pass. */
export const frameScriptAppended: readonly string[] = [
  frameDelta('Hello, '),
  frameDelta('world'),
  frameDone('Hello, world'),
];

/** A done carrying the opaque provider usage block (never settled). */
export const frameScriptDoneWithUsage: readonly string[] = [
  frameDelta('Usage '),
  frameDelta('probe'),
  frameDone('Usage probe', 'en', true),
];

/** Malformed and unknown frames: the stream must continue after each error event. */
export const frameScriptInvalid: readonly string[] = [
  'not json{',
  JSON.stringify({ type: 'nope.unknown' }),
  JSON.stringify({ type: 'transcription.text.delta' }),
  JSON.stringify({ type: 'transcription.done' }),
  frameTurnStart(),
  frameSegment('diarized only'),
  JSON.stringify({ type: 'session.updated', session: {} }),
  frameDelta('kept '),
  frameDone('kept going'),
];
