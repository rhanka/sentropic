import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

import { eq } from 'drizzle-orm';
import { TrackReader } from '@sentropic/track/read';

import { db } from '../../db/client';
import { workspaces } from '../../db/schema';

export interface DecisionSignatureValidation {
  authorized: boolean;
  reason?: string;
}

export interface DecisionValidator {
  validate(input: {
    workspace: string;
    decisionId: string;
    userId: string;
  }): Promise<DecisionSignatureValidation>;
}

interface DecisionValidatorDependencies {
  environment?: () => NodeJS.ProcessEnv;
  resolveTrackWorkspaceId?: (workspace: string) => Promise<string | null | undefined>;
}

const resolveTrackWorkspaceId = async (workspaceId: string): Promise<string | null | undefined> => {
  const [workspace] = await db
    .select({ trackWorkspaceId: workspaces.trackWorkspaceId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return workspace?.trackWorkspaceId;
};

const ownerIdentityMap = (serialized: string | undefined): Record<string, unknown> => {
  if (serialized === undefined || serialized === '') return {};

  const parsed: unknown = JSON.parse(serialized);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('TRACK_OWNER_IDENTITY_MAP must be a JSON object');
  }

  return parsed as Record<string, unknown>;
};

export const createTrackDecisionValidator = (
  dependencies: DecisionValidatorDependencies = {},
): DecisionValidator => {
  const environment = dependencies.environment ?? (() => process.env);
  const getTrackWorkspaceId = dependencies.resolveTrackWorkspaceId ?? resolveTrackWorkspaceId;

  return {
    validate: async ({ workspace, decisionId, userId }) => {
      try {
        const env = environment();
        const eventsPath = env.TRACK_EVENTS_PATH;

        if (!eventsPath) return { authorized: false, reason: 'track-store-unavailable' };

        try {
          await access(eventsPath, constants.R_OK);
        } catch {
          return { authorized: false, reason: 'track-store-unavailable' };
        }

        const trackWorkspace = await getTrackWorkspaceId(workspace);
        if (!trackWorkspace) return { authorized: false, reason: 'workspace-not-track-mapped' };

        const baselineCommit = env.TRACK_BASELINE_COMMIT;
        if (!baselineCommit) throw new Error('TRACK_BASELINE_COMMIT is required');

        const reader = new TrackReader(eventsPath);
        const rows = reader.report({ baselineCommit, decisions: true }).decisions ?? [];
        const row = rows.find((candidate) => candidate.id === decisionId);
        if (!row) return { authorized: false, reason: 'decision-not-found' };
        if (row.workspace !== trackWorkspace) return { authorized: false, reason: 'decision-workspace-mismatch' };

        const dossier = reader.canevas(trackWorkspace, { baselineCommit, decisionId }).dossier;
        if (!dossier || dossier.id !== decisionId) return { authorized: false, reason: 'decision-not-found' };

        const callerHandle = ownerIdentityMap(env.TRACK_OWNER_IDENTITY_MAP)[userId];
        if (typeof callerHandle !== 'string') return { authorized: false, reason: 'owner-identity-unmapped' };
        if (row.accountable == null || row.accountable !== callerHandle) {
          return { authorized: false, reason: 'not-decision-owner' };
        }

        return { authorized: true };
      } catch {
        return { authorized: false, reason: 'validation-error' };
      }
    },
  };
};

export const trackDecisionValidator = createTrackDecisionValidator();
