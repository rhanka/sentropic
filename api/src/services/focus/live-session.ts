import {
  FocusLiveSessionDriver,
  type FocusLiveSession,
  type FocusLiveSessionDependencies,
} from '@sentropic/focus';

import { PostgresTrackOwnerSignaturePort } from './postgres-owner-signature-port';

/** API-owned dependencies that stay outside the persistence adapter. */
export type ApiFocusLiveSessionDependencies = Omit<FocusLiveSessionDependencies, 'track'>;

/**
 * The only API composition point for Focus live signatures. Callers supply the merged driver's
 * authentication, relayer provenance, and authorization gates; persistence is always durable.
 */
export const createApiFocusLiveSession = (
  dependencies: ApiFocusLiveSessionDependencies,
): FocusLiveSession =>
  new FocusLiveSessionDriver({
    ...dependencies,
    track: new PostgresTrackOwnerSignaturePort(),
  });
