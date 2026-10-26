import type { SpeechCapabilities } from './capabilities.js';

/** Each entry qualifies a full engine tuple. STT/TTS engines need no chat profile. */
export type SpeechEngineCatalogue = readonly SpeechCapabilities[];

/** L1 supplies the contract; engine qualification populates this catalogue later. */
export const speechEngineCatalogue: SpeechEngineCatalogue = [];

/** Return all adapters, revisions and placements; never choose an implicit default. */
export const getModelSpeechCapabilities = (
  providerId: string,
  modelId: string,
  catalogue: SpeechEngineCatalogue = speechEngineCatalogue,
): readonly SpeechCapabilities[] => catalogue.filter((entry) =>
  entry.binding.providerId === providerId && entry.binding.modelId === modelId);
