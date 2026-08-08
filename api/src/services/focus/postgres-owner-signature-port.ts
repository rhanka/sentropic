import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type FocusOwnerSignatureContractVersion,
  type OwnerSignatureDurableUniquenessKey,
  type PersistedOwnerSignature,
  type TrackOwnerSignaturePort,
  type TrackOwnerSignatureWrite,
  type TrackOwnerSignatureWriteResult,
} from '@sentropic/focus';
import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { trackOwnerSignatures } from '../../db/schema';
import { createId } from '../../utils/id';

type SignatureSelectDatabase = Pick<typeof db, 'select'>;
type TrackOwnerSignatureRow = typeof trackOwnerSignatures.$inferSelect;

const identityWhere = (identity: OwnerSignatureDurableUniquenessKey) =>
  and(
    eq(trackOwnerSignatures.ownerIssuer, identity.ownerCanonicalIdentity.issuer),
    eq(trackOwnerSignatures.ownerSubject, identity.ownerCanonicalIdentity.subject),
    eq(trackOwnerSignatures.workspaceId, identity.target.workspace),
    eq(trackOwnerSignatures.decisionId, identity.target.decisionId),
  );

const identityOf = (write: TrackOwnerSignatureWrite): OwnerSignatureDurableUniquenessKey => ({
  ownerCanonicalIdentity: write.attestation.attester.canonicalIdentity,
  target: write.target,
});

const toPersistedOwnerSignature = (row: TrackOwnerSignatureRow): PersistedOwnerSignature | undefined => {
  if (row.contractVersion !== FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION) return undefined;

  return Object.freeze({
    contractVersion: row.contractVersion as FocusOwnerSignatureContractVersion,
    target: Object.freeze({ workspace: row.workspaceId, decisionId: row.decisionId }),
    attestation: Object.freeze({
      attester: Object.freeze({
        principalId: row.attesterPrincipalId,
        canonicalIdentity: Object.freeze({ issuer: row.ownerIssuer, subject: row.ownerSubject }),
        authenticatedAt: row.attesterAuthenticatedAt,
      }),
    }),
    relayer: Object.freeze({
      transport: row.relayerTransport as PersistedOwnerSignature['relayer']['transport'],
      relayerId: row.relayerId,
      canonicalIdentity: Object.freeze({ issuer: row.relayerIssuer, subject: row.relayerSubject }),
    }),
    idempotencyKey: row.idempotencyKey,
    recordId: row.id,
  });
};

const readPersistedOwnerSignature = async (
  database: SignatureSelectDatabase,
  identity: OwnerSignatureDurableUniquenessKey,
): Promise<PersistedOwnerSignature | undefined> => {
  const [row] = await database
    .select()
    .from(trackOwnerSignatures)
    .where(identityWhere(identity))
    .limit(1);

  return row === undefined ? undefined : toPersistedOwnerSignature(row);
};

/**
 * PostgreSQL-backed Focus port. The database unique constraint is the only owner-signature
 * arbiter: retries never pre-read, and the transaction always reads the durable winner back.
 */
export class PostgresTrackOwnerSignaturePort implements TrackOwnerSignaturePort {
  readonly contractVersion = FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION;

  async appendOwnerSignature(input: TrackOwnerSignatureWrite): Promise<TrackOwnerSignatureWriteResult> {
    const identity = identityOf(input);

    return db.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(trackOwnerSignatures)
        .values({
          id: createId(),
          ownerIssuer: identity.ownerCanonicalIdentity.issuer,
          ownerSubject: identity.ownerCanonicalIdentity.subject,
          workspaceId: identity.target.workspace,
          decisionId: identity.target.decisionId,
          contractVersion: input.contractVersion,
          attesterPrincipalId: input.attestation.attester.principalId,
          attesterAuthenticatedAt: input.attestation.attester.authenticatedAt,
          relayerTransport: input.relayer.transport,
          relayerId: input.relayer.relayerId,
          relayerIssuer: input.relayer.canonicalIdentity.issuer,
          relayerSubject: input.relayer.canonicalIdentity.subject,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing({
          target: [
            trackOwnerSignatures.ownerIssuer,
            trackOwnerSignatures.ownerSubject,
            trackOwnerSignatures.workspaceId,
            trackOwnerSignatures.decisionId,
          ],
        })
        .returning({ id: trackOwnerSignatures.id });

      const persisted = await readPersistedOwnerSignature(transaction, identity);
      if (persisted === undefined) {
        throw new Error('owner signature was not transactionally readable after append');
      }

      return inserted === undefined
        ? { status: 'duplicate' as const, recordId: persisted.recordId }
        : { status: 'written' as const, recordId: persisted.recordId };
    });
  }

  readOwnerSignature(input: OwnerSignatureDurableUniquenessKey): Promise<PersistedOwnerSignature | undefined> {
    return readPersistedOwnerSignature(db, input);
  }
}
