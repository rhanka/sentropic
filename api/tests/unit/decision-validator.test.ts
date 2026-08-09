import { fileURLToPath } from 'node:url';

import { TrackReader } from '@sentropic/track/read';
import { describe, expect, it, vi } from 'vitest';

import { createTrackDecisionValidator } from '../../src/services/focus/decision-validator';

const EVENTS_PATH = fileURLToPath(new URL('../fixtures/track-decision-validator/events.jsonl', import.meta.url));
const BASELINE_COMMIT = 'feebc6769aac8bd313d84310b1f0d66d07b68ee1';
const DECISION_ID = '01KXSECA66GK34CEBQ7J61VJAZ';

const validatorFor = ({
  trackWorkspace = 'sentropic',
  environment = {},
}: {
  trackWorkspace?: string | null;
  environment?: NodeJS.ProcessEnv;
} = {}) => createTrackDecisionValidator({
  environment: () => ({
    TRACK_EVENTS_PATH: EVENTS_PATH,
    TRACK_BASELINE_COMMIT: BASELINE_COMMIT,
    TRACK_OWNER_IDENTITY_MAP: '{"owner-user":"rhanka"}',
    ...environment,
  }),
  resolveTrackWorkspaceId: async () => trackWorkspace,
});

describe('Track decision validator', () => {
  it('should authorize the mapped accountable owner through the locked Track reader report and canevas', async () => {
    await expect(validatorFor().validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: true });
  });

  it('should deny a mapped caller whose handle is not the decision accountable owner', async () => {
    const validator = validatorFor({ environment: { TRACK_OWNER_IDENTITY_MAP: '{"owner-user":"conductor"}' } });

    await expect(validator.validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'not-decision-owner' });
  });

  it('should deny a case-only caller handle difference', async () => {
    const validator = validatorFor({ environment: { TRACK_OWNER_IDENTITY_MAP: '{"owner-user":"Rhanka"}' } });

    await expect(validator.validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'not-decision-owner' });
  });

  it('should deny whitespace around the accountable handle', async () => {
    const report = vi.spyOn(TrackReader.prototype, 'report').mockReturnValue({
      decisions: [{ id: DECISION_ID, workspace: 'sentropic', accountable: ' rhanka ' }],
    } as never);
    const canevas = vi.spyOn(TrackReader.prototype, 'canevas').mockReturnValue({
      dossier: { id: DECISION_ID },
    } as never);

    try {
      await expect(validatorFor().validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
        .resolves.toEqual({ authorized: false, reason: 'not-decision-owner' });
    } finally {
      report.mockRestore();
      canevas.mockRestore();
    }
  });

  it('should deny an unmapped caller', async () => {
    await expect(validatorFor().validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'other-user' }))
      .resolves.toEqual({ authorized: false, reason: 'owner-identity-unmapped' });
  });

  it('should deny a decision that does not exist', async () => {
    await expect(validatorFor().validate({ workspace: 'api-workspace', decisionId: 'missing-decision', userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'decision-not-found' });
  });

  it('should deny a decision outside the claimed Track workspace', async () => {
    await expect(validatorFor({ trackWorkspace: 'other-workspace' })
      .validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'decision-workspace-mismatch' });
  });

  it('should deny when the Track events path is unset', async () => {
    await expect(validatorFor({ environment: { TRACK_EVENTS_PATH: '' } })
      .validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'track-store-unavailable' });
  });

  it('should return a validation error for a malformed owner identity map', async () => {
    await expect(validatorFor({ environment: { TRACK_OWNER_IDENTITY_MAP: '{' } })
      .validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'validation-error' });
  });

  it('should deny when the Track baseline commit is unset', async () => {
    await expect(validatorFor({ environment: { TRACK_BASELINE_COMMIT: '' } })
      .validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'validation-error' });
  });

  it('should return track-store-unavailable when the Track store is unreadable', async () => {
    await expect(validatorFor({ environment: { TRACK_EVENTS_PATH: '/missing/track-events.jsonl' } })
      .validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'track-store-unavailable' });
  });

  it('should return a validation error when the environment provider throws', async () => {
    const validator = createTrackDecisionValidator({
      environment: () => {
        throw new Error('configuration unavailable');
      },
      resolveTrackWorkspaceId: async () => 'sentropic',
    });

    await expect(validator.validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'validation-error' });
  });

  it('should return a validation error when reading the events path throws', async () => {
    const validator = createTrackDecisionValidator({
      environment: () => ({
        get TRACK_EVENTS_PATH(): string {
          throw new Error('configuration unavailable');
        },
      }),
      resolveTrackWorkspaceId: async () => 'sentropic',
    });

    await expect(validator.validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'validation-error' });
  });

  it('should deny when the API workspace has no Track workspace mapping', async () => {
    await expect(validatorFor({ trackWorkspace: null })
      .validate({ workspace: 'api-workspace', decisionId: DECISION_ID, userId: 'owner-user' }))
      .resolves.toEqual({ authorized: false, reason: 'workspace-not-track-mapped' });
  });
});
