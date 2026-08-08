import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type AuthenticatedOwnPrincipal,
  type OwnerSignatureDurableUniquenessKey,
  type RelayerProvenance,
  type TrackNativeDecisionTarget,
  type TrackOwnerSignatureWrite,
} from '@sentropic/focus';
import { and, eq, like, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client';
import { trackOwnerSignatures } from '../../src/db/schema';
import { createApiFocusLiveSession } from '../../src/services/focus/live-session';
import { PostgresTrackOwnerSignaturePort } from '../../src/services/focus/postgres-owner-signature-port';

const OWNER: AuthenticatedOwnPrincipal = {
  principalId: 'owner-principal',
  canonicalIdentity: { issuer: 'https://issuer.example', subject: 'owner-subject' },
  authenticatedAt: '2026-08-08T12:00:00.000Z',
};

const RELAYER: RelayerProvenance = {
  transport: 'internal',
  relayerId: 'api-relayer',
  canonicalIdentity: { issuer: 'https://relayer.example', subject: 'api' },
};

let nextTarget = 0;

const createTarget = (): TrackNativeDecisionTarget => {
  nextTarget += 1;
  return {
    workspace: `focus-owner-signature-test-${Date.now()}-${nextTarget}`,
    decisionId: `decision-${nextTarget}`,
  };
};

const identityOf = (target: TrackNativeDecisionTarget): OwnerSignatureDurableUniquenessKey => ({
  ownerCanonicalIdentity: OWNER.canonicalIdentity,
  target,
});

const writeFor = (target: TrackNativeDecisionTarget, idempotencyKey: string): TrackOwnerSignatureWrite => ({
  contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  target,
  attestation: { attester: OWNER },
  relayer: RELAYER,
  idempotencyKey,
});

afterEach(async () => {
  await db.delete(trackOwnerSignatures).where(like(trackOwnerSignatures.workspaceId, 'focus-owner-signature-test-%'));
});

describe('PostgresTrackOwnerSignaturePort', () => {
  it('should atomically persist one canonical signature for concurrent distinct retries', async () => {
    const target = createTarget();
    const writes = [writeFor(target, 'retry-a'), writeFor(target, 'retry-b')];
    const port = new PostgresTrackOwnerSignaturePort();

    const receipts = await Promise.all(
      writes.map((write) => new PostgresTrackOwnerSignaturePort().appendOwnerSignature(write)),
    );

    expect(receipts.filter((receipt) => receipt.status === 'written')).toHaveLength(1);
    expect(receipts.filter((receipt) => receipt.status === 'duplicate')).toHaveLength(1);
    expect(new Set(receipts.map((receipt) => receipt.recordId))).toHaveSize(1);

    const [row] = await db
      .select()
      .from(trackOwnerSignatures)
      .where(
        and(
          eq(trackOwnerSignatures.ownerIssuer, OWNER.canonicalIdentity.issuer),
          eq(trackOwnerSignatures.ownerSubject, OWNER.canonicalIdentity.subject),
          eq(trackOwnerSignatures.workspaceId, target.workspace),
          eq(trackOwnerSignatures.decisionId, target.decisionId),
        ),
      );
    expect(row).toBeDefined();

    const persisted = await port.readOwnerSignature(identityOf(target));
    expect(persisted).toBeDefined();
    if (persisted === undefined) throw new Error('missing persisted owner signature');

    const winningWrite = writes.find((write) => write.idempotencyKey === persisted.idempotencyKey);
    expect(winningWrite).toBeDefined();
    expect(persisted.attestation).toEqual(winningWrite?.attestation);
    expect(persisted.relayer).toEqual(winningWrite?.relayer);
    expect(persisted.recordId).toBe(receipts[0]?.recordId);
  });

  it('should read the exact canonical attestation that was persisted', async () => {
    const target = createTarget();
    const write = writeFor(target, 'single-retry');
    const port = new PostgresTrackOwnerSignaturePort();

    const receipt = await port.appendOwnerSignature(write);
    const persisted = await port.readOwnerSignature(identityOf(target));

    expect(receipt.status).toBe('written');
    expect(persisted).toEqual({
      ...write,
      recordId: receipt.recordId,
    });
  });

  it('should return not-done when the real adapter cannot transactionally read its write back', async () => {
    const target = createTarget();
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION delete_test_owner_signature_after_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        DELETE FROM track_owner_signatures WHERE id = NEW.id;
        RETURN NEW;
      END;
      $$;
    `);
    await db.execute(sql`
      CREATE TRIGGER delete_test_owner_signature_after_insert
      AFTER INSERT ON track_owner_signatures
      FOR EACH ROW EXECUTE FUNCTION delete_test_owner_signature_after_insert();
    `);

    try {
      const session = createApiFocusLiveSession({
        ownPrincipal: { authenticate: async () => OWNER },
        relayerProvenance: { getRelayerProvenance: async () => RELAYER },
        authorizer: { authorize: async () => true },
      });

      await expect(
        session.sign({
          target,
          authentication: { kind: 'own-principal', proof: { test: 'transactional-read-back' } },
          idempotencyKey: 'transactional-read-back',
        }),
      ).resolves.toEqual({ status: 'not-done', reason: 'track-write-failed' });
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS delete_test_owner_signature_after_insert ON track_owner_signatures;`);
      await db.execute(sql`DROP FUNCTION IF EXISTS delete_test_owner_signature_after_insert();`);
    }
  });
});
