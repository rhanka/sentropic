import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD_SCRIPT = join(__dirname, '../helpers/owner-sign-child.ts');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

/**
 * Runs one appendOwnerSignature call in its OWN OS process via tsx, so two concurrent
 * calls race across processes on the real Track file-lock instead of sharing one
 * Node event loop (where `ingest`'s synchronous lock section serializes them anyway).
 */
const spawnOwnerSignChild = (
  eventsPath: string,
  workspace: string,
  decisionId: string,
  idempotencyKey: string,
  ownerEmail: string,
): Promise<{ status: 'written' | 'duplicate'; recordId: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, CHILD_SCRIPT, eventsPath, workspace, decisionId, idempotencyKey, ownerEmail],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`owner-sign-child exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`owner-sign-child produced non-JSON stdout: ${stdout} (${String(err)})`));
      }
    });
  });

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

  it('in-process: 2 sequential owner-sign attempts on SAME decision dedup to 1 written, 1 duplicate', async () => {
    // NOTE: `appendOwnerSignature`'s first `await` is AFTER `ingest` (which runs the
    // synchronous, event-loop-blocking `withFileLock` section), so `Promise.all([a, b])`
    // in a single process never interleaves the two `ingest` calls — this exercises the
    // dedup-by-deterministic-clientToken invariant (independent of idempotencyKey), NOT
    // the cross-process file-lock. The lock itself is exercised by the REAL cross-process
    // test below; the durable exactly-once guarantee is provided by @sentropic/track's
    // store (O_EXCL lock + under-lock dedup keyed on (workspace, clientToken) +
    // verifyAppend), not by either test — see PR #536 review.
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

  it(
    'cross-process: 2 OS processes writing the SAME events.jsonl concurrently yield 1 durable decision.artifact-added',
    async () => {
      const workspace = 'ws:sha256-test-workspace';
      const decisionId = seedDecisionInStore(workspace, OWNER_EMAIL);

      // Two independent Node processes, started back-to-back (no barrier), racing on the
      // SAME eventsPath — this is the real cross-process Track file-lock (O_EXCL) race
      // F1a asked for, not an in-process Promise.all.
      const [receiptA, receiptB] = await Promise.all([
        spawnOwnerSignChild(eventsPath, workspace, decisionId, 'cross-process-a', OWNER_EMAIL),
        spawnOwnerSignChild(eventsPath, workspace, decisionId, 'cross-process-b', OWNER_EMAIL),
      ]);

      expect(receiptA.recordId).toBe(receiptB.recordId);
      const statuses = [receiptA.status, receiptB.status];
      expect(statuses.filter((s) => s === 'written')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(1);

      // The durable invariant: exactly one persisted decision.artifact-added event, no
      // matter which process's write actually landed.
      const reader = new TrackReader(eventsPath);
      const snapshot = reader.reportSnapshot({ decisions: true });
      const artifactEvents = snapshot.events.filter((e) => e.type === 'decision.artifact-added');
      expect(artifactEvents).toHaveLength(1);
    },
    15000,
  );

  it('in-process: sequential retry with the SAME idempotency_key yields written then duplicate (PR #536 F1b-residual)', async () => {
    // PR #536 review F1b-residual: the durable arbiter is (owner, workspace, decision), never
    // idempotencyKey — a client-supplied retry legitimately reuses the SAME idempotencyKey, and
    // must still be labeled 'duplicate' on the second call (matching the Postgres sibling port's
    // onConflictDoNothing-derived label). A same-key arbiter would wrongly say 'written' twice.
    const workspace = 'ws:sha256-test-workspace';
    const decisionId = seedDecisionInStore(workspace, OWNER_EMAIL);
    const target: TrackNativeDecisionTarget = { workspace, decisionId };

    const port = new TrackEventOwnerSignaturePort({ eventsPath });

    const write: TrackOwnerSignatureWrite = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      target,
      attestation: { attester: OWNER },
      relayer: RELAYER,
      idempotencyKey: 'same-key-retry',
    };

    const first = await port.appendOwnerSignature(write);
    const second = await port.appendOwnerSignature(write);

    expect(first.status).toBe('written');
    expect(second.status).toBe('duplicate');
    expect(second.recordId).toBe(first.recordId);

    const reader = new TrackReader(eventsPath);
    const snapshot = reader.reportSnapshot({ decisions: true });
    const artifactEvents = snapshot.events.filter((e) => e.type === 'decision.artifact-added');
    expect(artifactEvents).toHaveLength(1);
  });

  it(
    'cross-process: 2 OS processes writing the SAME idempotency_key concurrently yield exactly 1 written, 1 duplicate (PR #536 F1b-residual)',
    async () => {
      const workspace = 'ws:sha256-test-workspace';
      const decisionId = seedDecisionInStore(workspace, OWNER_EMAIL);

      // Same idempotencyKey on both concurrent attempts — the case the old
      // `persisted.idempotencyKey === idempotencyKey` arbiter got wrong (2 written, since both
      // callers' own key trivially matches the persisted one).
      const [receiptA, receiptB] = await Promise.all([
        spawnOwnerSignChild(eventsPath, workspace, decisionId, 'cross-process-same-key', OWNER_EMAIL),
        spawnOwnerSignChild(eventsPath, workspace, decisionId, 'cross-process-same-key', OWNER_EMAIL),
      ]);

      expect(receiptA.recordId).toBe(receiptB.recordId);
      const statuses = [receiptA.status, receiptB.status];
      expect(statuses.filter((s) => s === 'written')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(1);

      const reader = new TrackReader(eventsPath);
      const snapshot = reader.reportSnapshot({ decisions: true });
      const artifactEvents = snapshot.events.filter((e) => e.type === 'decision.artifact-added');
      expect(artifactEvents).toHaveLength(1);
    },
    15000,
  );

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
