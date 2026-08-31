import { existsSync } from 'node:fs';
import type { FocusTrackPort } from '@sentropic/focus/hono';
import {
  DecisionNotFoundError,
  readDecisionDossier,
} from '@sentropic/focus/track';

import { createApiFocusTrackPort } from './live-session';

export const productFocusTrackPort: FocusTrackPort = {
  async readDecision(target) {
    const eventsPath = process.env.TRACK_EVENTS_PATH ?? '.track/events.jsonl';
    if (!existsSync(eventsPath)) return { status: 'unavailable' };
    try {
      return {
        status: 'found',
        document: readDecisionDossier(
          eventsPath,
          { ...target, baselineCommit: '' },
          new Date().toISOString(),
        ),
      };
    } catch (error) {
      return error instanceof DecisionNotFoundError
        ? { status: 'not-found' }
        : { status: 'unavailable' };
    }
  },
  async getOwnerSignaturePort() {
    return createApiFocusTrackPort();
  },
};
