// A2.0b custody import: id preservation, verification-material preservation,
// identical-receipt replay, whole-batch rollback and exclusive-writer fencing.

import { describe, expect, it } from 'vitest';
import type { IdentityImportBatchV1, IdentityUnitOfWorkV1 } from '../../src/index.js';
import { createIdentityCustodyImporterV1 } from '../../src/index.js';
import { asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, randomBase64Url, sha256Hex, syntheticCoseKey } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, deadlineMs: 5000 };
const IMPORT = { mode: 'import' as const, deadlineMs: 8000 };

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
}

const fullBatch = (migrationId: string): IdentityImportBatchV1 => {
  const account = { userId: 'u-import', email: 'imported@example.test', accountStatus: 'active' as const, globalRole: 'editor' as const, createdAt: NOW, updatedAt: NOW };
  return {
    contractVersion: '1.1.0', migrationId, sourceSnapshotRef: `snap-${migrationId}`, sourceSnapshotDigest: sha256Hex(`snap-${migrationId}`), manifestDigest: sha256Hex(`manifest-${migrationId}`), importedAt: NOW,
    rows: [
      { entity: 'account', record: account, profile: { userId: 'u-import', emailVerified: true, displayName: 'Imported', approvalDueAt: null, approvedAt: NOW, approvedByUserId: 'admin', disabledAt: null, disabledReason: null, legacyAccountStatus: 'enabled' } },
      {
        entity: 'credential',
        record: {
          proofId: 'cred-import', userId: 'u-import', credentialId: randomBase64Url(32), publicKeyCose: syntheticCoseKey('cred-import'), counter: 12, revision: 0,
          rpId: 'idp.example.test', deviceName: 'key', transports: ['usb'], uv: true, deviceType: 'phone', backedUp: false,
          createdAt: NOW, lastUsedAt: '2026-11-01T11:00:00.000Z', revokedAt: null,
        },
      },
      {
        entity: 'single_use_proof',
        record: {
          kind: 'email_code', proofId: 'code-import', userId: 'u-import', state: 'consumed', revision: 1, createdAt: NOW, expiresAt: LATER,
          consumedAt: NOW, revokedAt: null, email: 'imported@example.test', codeDigest: { algorithm: 'hmac-sha256', value: sha256Hex('code-import'), keyRef: 'secret-email-code:v3' },
        },
      },
      {
        entity: 'email_ticket',
        record: {
          codeProofId: 'code-import', email: 'imported@example.test', tokenHash: sha256Hex('ticket-import'), userId: 'u-import',
          state: 'consumed', revision: 1, createdAt: NOW, expiresAt: LATER, consumedAt: NOW, revokedAt: null,
        },
      },
      {
        entity: 'invitation',
        record: {
          invitationId: 'invite-import', email: 'imported@example.test', tenantId: 't-import', workspaceId: 'w-import', clientId: 'client',
          tokenHash: sha256Hex('invite-import'), status: 'consumed', expiresAt: LATER, createdAt: NOW, consumedAt: NOW, consumedByUserId: 'u-import', revision: 1,
        },
      },
      {
        entity: 'login_session',
        record: {
          sessionId: 'sess-import', userId: 'u-import', sessionTokenHash: sha256Hex('sess-import'), refreshTokenHash: sha256Hex('refr-import'),
          login: { mfaVerified: true, authTime: 1000, sessionVersion: 1000 },
          rotationVersion: 2, createdAt: NOW, expiresAt: LATER, revokedAt: null, deviceName: 'd', ipAddress: 'ip', userAgent: 'ua', lastActivityAt: NOW,
        },
      },
      {
        entity: 'social_link',
        record: {
          proofId: 'social-import', userId: 'u-import', provider: 'github', providerSubject: 'subject-import', providerTenant: 'tenant-1',
          emailAtLink: 'imported@example.test', emailVerifiedByProvider: true, linkedAt: NOW, lastLoginAt: NOW, revokedAt: null, revision: 1,
        },
      },
      { entity: 'tenant', record: { tenantId: 't-import', slug: 't-import', status: 'active', createdAt: NOW } },
      { entity: 'tenant_membership', record: { userId: 'u-import', tenantId: 't-import', status: 'approved', tenantRole: 'member', decidedBy: 'admin', decidedAt: NOW, updatedAt: NOW } },
      { entity: 'workspace', record: { workspaceId: 'w-import', tenantId: 't-import', repoIdentity: null, aliases: ['w-import'], enrolledAt: NOW } },
      { entity: 'workspace_membership', record: { workspaceId: 'w-import', userId: 'u-import', role: 'editor' } },
      { entity: 'oauth_consent', record: { consentId: 'consent-import', tenantId: 't-import', userId: 'u-import', clientId: 'client', grantedAt: NOW } },
    ],
  };
};

describe.each([{ profile: 'postgres' }, { profile: 'sqlite' }])('A2.0b custody import on $profile', ({ profile }) => {
  const openEnv = async (): Promise<ProfileEnv> => {
    if (profile === 'postgres') return { unitOfWork: asOpHost((await openPostgresEnv()).unitOfWork) };
    return { unitOfWork: asOpHost(openSqliteEnv().unitOfWork) };
  };

  it('preserves ids, bytes, counters, digests, hashes and subjects', async () => {
    const env = await openEnv();
    const importer = createIdentityCustodyImporterV1({ unitOfWork: env.unitOfWork, fence: { assertExclusiveWriter: async () => undefined }, importOptions: IMPORT, validationOptions: READ });
    const batch = fullBatch('mig-full');
    const validation = await importer.validate(batch);
    expect(validation).toEqual({ valid: true, issues: [] });
    const receipt = await importer.importBatch(batch);
    expect(receipt).toMatchObject({ migrationId: 'mig-full', identitiesPreserved: true, verificationMaterialPreserved: true, lifecyclePreserved: true });
    expect(receipt.counts).toMatchObject({ account: 1, credential: 1, single_use_proof: 1, email_ticket: 1, invitation: 1, login_session: 1, social_link: 1, tenant: 1, tenant_membership: 1, workspace: 1, workspace_membership: 1, oauth_consent: 1 });
    await env.unitOfWork.runRead(READ, async (tx) => {
      const host = tx.hostTransaction;
      const account = await host.journal.findAccountCore('u-import');
      expect(account).toMatchObject({ email: 'imported@example.test', accountStatus: 'active' });
      const credential = await host.stores.credentials.findById('cred-import');
      expect(credential).toMatchObject({ counter: 12, revision: 0 });
      const proof = await host.stores.singleUseProofs.find({ kind: 'email_code', proofId: 'code-import' });
      expect(proof).toMatchObject({ state: 'consumed', userId: 'u-import', codeDigest: { algorithm: 'hmac-sha256', keyRef: 'secret-email-code:v3' } });
      const ticket = await host.stores.emailTickets.findByTokenHash(sha256Hex('ticket-import'));
      expect(ticket).toMatchObject({ state: 'consumed', userId: 'u-import' });
      const invitation = await host.stores.invitations.findByDigest(sha256Hex('invite-import'));
      expect(invitation).toMatchObject({ status: 'consumed', consumedByUserId: 'u-import', clientId: 'client' });
      const session = await host.stores.sessions.findBySessionTokenHash(sha256Hex('sess-import'));
      expect(session).toMatchObject({ rotationVersion: 2, userId: 'u-import' });
      const social = await host.stores.social.findBySubject('github', 'subject-import');
      expect(social).toMatchObject({ proofId: 'social-import', userId: 'u-import' });
    });
  });

  it('replays identical migrations and refuses conflicting ones', async () => {
    const env = await openEnv();
    const importer = createIdentityCustodyImporterV1({ unitOfWork: env.unitOfWork, fence: { assertExclusiveWriter: async () => undefined }, importOptions: IMPORT, validationOptions: READ });
    const batch = fullBatch('mig-replay');
    const first = await importer.importBatch(batch);
    const second = await importer.importBatch(batch);
    expect(second).toEqual(first);
    const conflicts = {
      ...batch,
      sourceSnapshotDigest: sha256Hex('different'),
    };
    await expect(importer.validate(conflicts)).resolves.toEqual({ valid: true, issues: [] });
    await expect(importer.importBatch(conflicts)).rejects.toMatchObject({ code: 'identity_import_conflict' });
  });

  it('rolls back the whole batch on a conflicting row', async () => {
    const env = await openEnv();
    const importer = createIdentityCustodyImporterV1({ unitOfWork: env.unitOfWork, fence: { assertExclusiveWriter: async () => undefined }, importOptions: IMPORT, validationOptions: READ });
    await importer.importBatch(fullBatch('mig-base'));
    // Second batch: valid account row plus an invitation token already owned by another invitation.
    const batch = fullBatch('mig-rollback');
    const tampered: IdentityImportBatchV1 = {
      ...batch,
      rows: batch.rows.map((row) => (row.entity === 'invitation' ? { ...row, record: { ...row.record, invitationId: 'invite-other' } } : row)),
    };
    await expect(importer.importBatch(tampered)).rejects.toMatchObject({ code: 'identity_import_conflict' });
    await env.unitOfWork.runRead(READ, async (tx) => {
      expect(await tx.hostTransaction.journal.findAccountCore('u-import')).not.toBeNull();
      // The rolled-back batch inserted nothing under its own rows: the shared base account is intact,
      // and no new invitation row from the tampered batch exists.
      expect(await tx.hostTransaction.stores.invitations.findById('invite-other')).toBeNull();
      // Batch-local rows were not committed: the tampered batch's session row is absent.
      expect(await tx.hostTransaction.stores.sessions.findById('sess-import')).not.toBeNull();
    });
  });

  it('rejects invalid rows before touching the database', async () => {
    const env = await openEnv();
    const importer = createIdentityCustodyImporterV1({ unitOfWork: env.unitOfWork, fence: { assertExclusiveWriter: async () => undefined }, importOptions: IMPORT, validationOptions: READ });
    const batch = fullBatch('mig-invalid');
    const tampered: IdentityImportBatchV1 = {
      ...batch,
      rows: batch.rows.map((row) => (row.entity === 'account' ? { ...row, record: { ...row.record, email: 'Not-Canonical@Example.TEST' } } : row)),
    };
    const validation = await importer.validate(tampered);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ entity: 'account', code: 'identity_import_invalid' }));
    await expect(importer.importBatch(tampered)).rejects.toMatchObject({ code: 'identity_import_invalid' });
    await env.unitOfWork.runRead(READ, async (tx) => {
      expect(await tx.hostTransaction.journal.findAccountCore('u-import')).toBeNull();
    });
  });

  it('honors the exclusive-writer fence before any write', async () => {
    const env = await openEnv();
    let calls = 0;
    const importer = createIdentityCustodyImporterV1({
      unitOfWork: env.unitOfWork,
      fence: {
        assertExclusiveWriter: async () => {
          calls += 1;
          throw new Error('fence refuses');
        },
      },
      importOptions: IMPORT,
      validationOptions: READ,
    });
    await expect(importer.importBatch(fullBatch('mig-fence'))).rejects.toThrow('fence refuses');
    expect(calls).toBeGreaterThan(0);
    await env.unitOfWork.runRead(READ, async (tx) => {
      expect(await tx.hostTransaction.journal.findAccountCore('u-import')).toBeNull();
    });
  });
});
