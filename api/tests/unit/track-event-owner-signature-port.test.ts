import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type AuthenticatedOwnPrincipal,
  type RelayerProvenance,
  type TrackNativeDecisionTarget,
  type TrackOwnerSignatureWrite,
} from '@sentropic/focus';
import { EventStore } from '@sentropic/track';
import { ingest } from '@sentropic/track/ingest';
import { TrackReader } from '@sentropic/track/read';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TrackEventOwnerSignaturePort } from '../../src/services/focus/track-event-owner-signature-port';

const OWNER_EMAIL = 'owner@example.com';
const OWNER: AuthenticatedOwnPrincipal = {
  principalId: 'user-123',
  canonicalIdentity: { issuer: 'https://auth.example.com', subject: `human:${OWNER_EMAIL}` },
  authenticatedAt: '2026-08-10T12:00:00.000Z',
};

const RELAYER: RelayerProvenance = {
  transport: 'http',
  relayerId: 'sentropic-api',
  canonicalIdentity: { issuer: 'sentropic-api', subject: 'focus-owner-signature-route' },
};

describe('TrackEventOwnerSignaturePort (Real Track Store Atomicity)', () => {
  let tmpDir: string;
  let eventsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'track-fusion-test-'));
    eventsPath = join(tmpDir, 'events.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const seedDecisionInStore = (workspace: string, accountableEmail: string): string => {
    const store = new EventStore(eventsPath);
    const itemRes = ingest(
      [
        {
          v: 1,
          kind: 'item.create',
          payload: {
            kind: 'chore',
            title: 'Target Item',
            workspace,
          },
        },
      ],
      {
        by: `human:${accountableEmail}`,
        workspace,
        prov: { transport: 'cli', proposed: false, auth: 'local-user' },
      },
      store,
    );

    const decRes = ingest(
      [
        {
          v: 1,
          kind: 'decision.create',
          payload: {
            decisionKind: 'orientation',
            title: 'Orientation Decision',
            workspace,
            targets: [itemRes.ids[0]!],
            dossier: {
              context: 'Test context',
              options: [
                { id: 'opt-1', title: 'Option 1', summary: 'Summary 1' },
                { id: 'opt-2', title: 'Option 2', summary: 'Summary 2' },
              ],
              qa: [],
              recommendation: { optionId: 'opt-1', rationale: 'Rationale 1' },
            },
            accountable: `human:${accountableEmail}`,
          },
        },
      ],
      {
        by: `human:${accountableEmail}`,
        workspace,
        prov: { transport: 'cli', proposed: false, auth: 'local-user' },
      },
      store,
    );

    return decRes.ids[0]!;
  };

  it('EXPLICIT real-race atomicity: 2 CONCURRENT owner-sign requests on SAME decision yield 1 written, 1 duplicate', async () => {
    const workspace = 'ws:sha256-test-workspace';
    const decisionId = seedDecisionInStore(workspace, OWNER_EMAIL);
    const target: TrackNativeDecisionTarget = { workspace, decisionId };

    const port = new TrackEventOwnerSignaturePort({ eventsPath });

    const writeA: TrackOwnerSignatureWrite = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      target,
      attestation: { attester: OWNER },
      relayer: RELAYER,
      idempotencyKey: 'race-retry-a',
    };

    const writeB: TrackOwnerSignatureWrite = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      target,
      attestation: { attester: OWNER },
      relayer: RELAYER,
      idempotencyKey: 'race-retry-b',
    };

    // Run parallel concurrent writes against real Track file-lock
    const [receiptA, receiptB] = await Promise.all([
      port.appendOwnerSignature(writeA),
      port.appendOwnerSignature(writeB),
    ]);

    const statuses = [receiptA.status, receiptB.status];
    expect(statuses.filter((s) => s === 'written')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(1);
    expect(receiptA.recordId).toBe(receiptB.recordId);

    // Verify raw Track event log only has 1 decision.artifact-added event
    const reader = new TrackReader(eventsPath);
    const snapshot = reader.reportSnapshot({ decisions: true });
    const artifactEvents = snapshot.events.filter((e) => e.type === 'decision.artifact-added');

    expect(artifactEvents).toHaveLength(1);
  });

  it('should read back the exact canonical persisted owner signature', async () => {
    const workspace = 'ws:sha256-test-workspace';
    const decisionId = seedDecisionInStore(workspace, OWNER_EMAIL);
    const target: TrackNativeDecisionTarget = { workspace, decisionId };

    const port = new TrackEventOwnerSignaturePort({ eventsPath });

    const write: TrackOwnerSignatureWrite = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      target,
      attestation: { attester: OWNER },
      relayer: RELAYER,
      idempotencyKey: 'single-write-idempotency',
    };

    const receipt = await port.appendOwnerSignature(write);
    expect(receipt.status).toBe('written');

    const persisted = await port.readOwnerSignature({
      ownerCanonicalIdentity: OWNER.canonicalIdentity,
      target,
    });

    expect(persisted).toBeDefined();
    expect(persisted?.recordId).toBe(receipt.recordId);
    expect(persisted?.attestation.attester.canonicalIdentity.subject).toBe(`human:${OWNER_EMAIL}`);
    expect(persisted?.idempotencyKey).toBe('single-write-idempotency');
  });
});
