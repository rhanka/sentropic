// Establishment-sequence engine core (L-4): validates the full
// prepare → upgrade/Open/Opened → Bind/Bound chain through the frozen
// CHAIN-ESTABLISH-2 / CHAIN-FRAME-TRANSLATION / CHAIN-BIND evaluators. The live
// wire engine (relay-2/3) drives this with real link adapters; the test fakes
// drive it with scripted records. With DEP-FED a source-gap no production wiring
// is registered, so this never runs outside tests — live routes stay DISABLED.
import { relayError } from './registry-types.js';
import type { RelayError } from './registry-types.js';
import { chainBindGuard, chainSocketConstruction } from './relay-bind.js';
import type { BindGuardInput, SocketConstructionInput } from './relay-bind.js';
import { chainOpenPair, chainPathCheck } from './relay-chain.js';
import type { OpenPairInput, PathCheckInput } from './relay-chain.js';
import { chainTranslateFrames } from './relay-frames.js';
import type { TranslationInput } from './relay-frames.js';

export interface EstablishmentVectors {
  readonly pathCheck: PathCheckInput;
  readonly openPair: OpenPairInput;
  readonly bindGuard: BindGuardInput;
  readonly socketConstruction: SocketConstructionInput;
  readonly frames?: TranslationInput;
}

export type EstablishmentResult =
  | { readonly status: 'established' }
  | { readonly status: 'refused'; readonly error: RelayError };

// runEstablishment: every stage must pass its frozen vector family; the first
// failure wins and maps to its typed relay error (fail-closed, no local fill).
export function runEstablishment(vectors: EstablishmentVectors): EstablishmentResult {
  const path = chainPathCheck(vectors.pathCheck);
  if (path !== 'allow') return { status: 'refused', error: relayError(path as RelayError['code']) };
  const pair = chainOpenPair(vectors.openPair);
  if (pair !== 'paired-opened-model' && pair !== 'paired-awaiting-downstream') {
    return { status: 'refused', error: relayError(pair as RelayError['code']) };
  }
  if (vectors.frames) {
    const frames = chainTranslateFrames(vectors.frames);
    if (frames.decision !== 'allow') return { status: 'refused', error: relayError(frames.decision) };
  }
  if (chainBindGuard(vectors.bindGuard) !== 'allow-model') {
    return { status: 'refused', error: relayError('relay_protocol_refused') };
  }
  if (chainSocketConstruction(vectors.socketConstruction) !== 'allow-model') {
    return { status: 'refused', error: relayError('relay_protocol_refused') };
  }
  return { status: 'established' };
}
