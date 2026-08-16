import { existsSync } from 'node:fs';
import { TrackReader } from '@sentropic/track/read';

export interface DecisionSignatureValidation {
  authorized: boolean;
  reason?: string;
}

export interface DecisionValidator {
  validate(input: {
    workspace: string;
    decisionId: string;
    userId: string;
    userEmail?: string | null;
  }): Promise<DecisionSignatureValidation>;
}

export interface TrackDecisionValidatorOptions {
  eventsPath?: string;
}

/**
 * Real TrackDecisionValidator on the shared Track log.
 * Existence: verified via TrackReader canevas / report.
 * Workspace: verified exact match to decision.workspace (ws:sha256).
 * Owner: caller's verified email -> `human:<email>` compared EXACTLY (no case-fold/trim)
 * to the decision `accountable`/creator.
 */
export class TrackDecisionValidator implements DecisionValidator {
  private readonly eventsPath: string | undefined;

  constructor(options: TrackDecisionValidatorOptions = {}) {
    this.eventsPath = options.eventsPath;
  }

  async validate(input: {
    workspace: string;
    decisionId: string;
    userId: string;
    userEmail?: string | null;
  }): Promise<DecisionSignatureValidation> {
    const eventsPath = this.eventsPath ?? process.env.TRACK_EVENTS_PATH ?? '.track/events.jsonl';
    if (!eventsPath || !existsSync(eventsPath)) {
      return { authorized: false, reason: 'track-store-unconfigured' };
    }

    try {
      const reader = new TrackReader(eventsPath);
      // baselineCommit only feeds item-level acceptance/bucket status (unused here — this
      // validator reads decision.created events and report.decisions id/workspace only).
      const snapshot = reader.reportSnapshot({ decisions: true, baselineCommit: '' });
      const events = snapshot.events;

      // Find the decision creation event
      const createEvent = events.find(
        (e) => e.aggregateId === input.decisionId && e.type === 'decision.created',
      );

      if (!createEvent) {
        return { authorized: false, reason: 'decision-not-found' };
      }

      const decisionWorkspace =
        (createEvent.payload as { workspace?: string })?.workspace ??
        snapshot.report.decisions?.find((d) => d.id === input.decisionId)?.workspace;

      if (decisionWorkspace !== input.workspace) {
        return { authorized: false, reason: 'workspace-mismatch' };
      }

      if (!input.userEmail) {
        return { authorized: false, reason: 'owner-email-required' };
      }

      const expectedSubject = input.userEmail.startsWith('human:')
        ? input.userEmail
        : `human:${input.userEmail}`;

      const decisionAccountable =
        (createEvent.payload as { accountable?: string })?.accountable ?? createEvent.by;

      if (decisionAccountable !== expectedSubject) {
        return { authorized: false, reason: 'not-decision-owner' };
      }

      return { authorized: true };
    } catch {
      return { authorized: false, reason: 'decision-validation-failed' };
    }
  }
}

export const failClosedDecisionValidator: DecisionValidator = new TrackDecisionValidator();
