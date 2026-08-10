import {
  FocusLiveSessionDriver,
  type FocusLiveSession,
  type FocusLiveSessionDependencies,
  type TrackOwnerSignaturePort,
} from '@sentropic/focus';

import { PostgresTrackOwnerSignaturePort } from './postgres-owner-signature-port';
import { TrackEventOwnerSignaturePort } from './track-event-owner-signature-port';

/** API-owned dependencies that stay outside the persistence adapter. */
export type ApiFocusLiveSessionDependencies = Omit<FocusLiveSessionDependencies, 'track'>;

export interface CreateApiFocusLiveSessionOptions {
  storeMode?: 'local' | 'postgres';
  eventsPath?: string;
  trackPort?: TrackOwnerSignaturePort;
}

/**
 * The API composition point for Focus live signatures.
 * Selects local TrackEventOwnerSignaturePort (in local E1 fusion) or PostgresTrackOwnerSignaturePort (deployed E2).
 */
export const createApiFocusLiveSession = (
  dependencies: ApiFocusLiveSessionDependencies,
  options: CreateApiFocusLiveSessionOptions = {},
): FocusLiveSession => {
  const storeMode =
    options.storeMode ??
    (process.env.TRACK_STORE_MODE === 'local' || process.env.NODE_ENV !== 'production'
      ? 'local'
      : 'postgres');

  const trackPort =
    options.trackPort ??
    (storeMode === 'local'
      ? new TrackEventOwnerSignaturePort({ eventsPath: options.eventsPath })
      : new PostgresTrackOwnerSignaturePort());

  return new FocusLiveSessionDriver({
    ...dependencies,
    track: trackPort,
  });
};
