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

export type CreateApiFocusTrackPortOptions = Omit<CreateApiFocusLiveSessionOptions, 'trackPort'>;

/** NODE_ENV values where a local Track events.jsonl is known-safe (contained dev/test envs). */
const LOCAL_SAFE_NODE_ENVS = new Set(['development', 'test']);

/**
 * Resolve the store mode with no room for a silent local default: `production` is postgres,
 * a known-safe local dev/test env is local, and anything else (unset, "staging", a typo — the
 * exact gap PR #536 review F2 flagged: a deployed NODE_ENV that isn't the literal string
 * "production" used to fall through to writing the ephemeral local events.jsonl and silently
 * bypassing the durable Postgres port) fails loud instead of guessing.
 */
const resolveStoreMode = (): 'local' | 'postgres' => {
  const explicit = process.env.TRACK_STORE_MODE;
  if (explicit === 'local' || explicit === 'postgres') return explicit;
  if (explicit !== undefined) {
    throw new Error(
      `createApiFocusLiveSession: invalid TRACK_STORE_MODE "${explicit}" (expected "local" or "postgres")`,
    );
  }

  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'production') return 'postgres';
  if (nodeEnv !== undefined && LOCAL_SAFE_NODE_ENVS.has(nodeEnv)) return 'local';

  throw new Error(
    `createApiFocusLiveSession: cannot infer a safe Track store for NODE_ENV=${JSON.stringify(nodeEnv)}. ` +
      'Set TRACK_STORE_MODE="local" or "postgres" explicitly.',
  );
};

export const createApiFocusTrackPort = (
  options: CreateApiFocusTrackPortOptions = {},
): TrackOwnerSignaturePort =>
  (options.storeMode ?? resolveStoreMode()) === 'local'
    ? new TrackEventOwnerSignaturePort({ eventsPath: options.eventsPath })
    : new PostgresTrackOwnerSignaturePort();

/**
 * The API composition point for Focus live signatures.
 * Selects local TrackEventOwnerSignaturePort (in local E1 fusion) or PostgresTrackOwnerSignaturePort (deployed E2).
 */
export const createApiFocusLiveSession = (
  dependencies: ApiFocusLiveSessionDependencies,
  options: CreateApiFocusLiveSessionOptions = {},
): FocusLiveSession => {
  const trackPort =
    options.trackPort ??
    createApiFocusTrackPort(options);

  return new FocusLiveSessionDriver({
    ...dependencies,
    track: trackPort,
  });
};
