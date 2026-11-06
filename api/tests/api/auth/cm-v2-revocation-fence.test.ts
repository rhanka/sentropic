import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeIdentityRevocationV1 } from '@sentropic/cluster-mesh';
import { withAppCmAuth } from '../../../src/services/identity/cm-auth-runtime';
import { cmIdentityUnitOfWork } from '../../../src/services/identity/cm-transaction';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { findCmSessionById } from '../../../src/services/identity/cm-sessions';
import { deleteCmAccountAsAdmin } from '../../../src/services/identity/cm-account-deletion';
import { deliverCmRevocation } from '../../../src/services/identity/cm-revocation-delivery';
import { getRemoteSessionAuthority } from '../../../src/services/auth/remote-private-session';
import { resolveRemoteLogin } from '../../../src/services/auth/remote-session';
import { cmDeleteForUsers, cmQuery, cmReinsertSession, cmTable } from '../../utils/cm-identity-test-store';

describe('V2 deletion versus deferred issuer-private publication', () => {
  const userId = crypto.randomUUID(), actorId = crypto.randomUUID();
  let directory: string;
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await cmDeleteForUsers([userId, actorId]);
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('fences unpublished sessions before acknowledging direct deletion of a pending account', async () => {
    directory = mkdtempSync(join(tmpdir(), 'a4-v2-private-fence-'));
    vi.stubEnv('REMOTE_ACTION_ROLE', 'auth-idp');
    vi.stubEnv('REMOTE_ACTION_SESSION_STATE_DIR', directory);
    const budget = { deadlineMs: 10_000, maxAttempts: 1 };
    vi.stubEnv('CM_IDENTITY_DELETION_BUDGETS_JSON', JSON.stringify({
      reservation: budget, deletion: budget, diagnostic: budget, read: budget,
      qualificationReceiptRef: 'synthetic-test-only-not-a-rehearsal-receipt',
    }));
    await createCmUser({ userId: actorId, email: `${actorId}@example.test`, role: 'admin_app', emailVerified: true });
    await createCmUser({ userId, email: `${userId}@example.test`, role: 'editor', emailVerified: true,
      accountStatus: 'pending_admin_approval' });
    let release!: () => void, admitted!: () => void;
    const paused = new Promise<void>(resolve => { admitted = resolve; });
    const resumed = new Promise<void>(resolve => { release = resolve; });
    const run = cmIdentityUnitOfWork.run.bind(cmIdentityUnitOfWork);
    let intercept = true, sessionId = '', credential = '';
    vi.spyOn(cmIdentityUnitOfWork, 'run').mockImplementation(async (options, operation) => {
      const result = await run(options, operation);
      if (intercept && options.purpose === 'request' && options.mode === 'write') {
        intercept = false; admitted(); await resumed;
      }
      return result;
    });
    const publication = withAppCmAuth(runner => runner.request(async binding => {
      const user = await binding.ports.users.findById(userId);
      if (!user) throw new Error('Missing pending account fixture');
      const tokens = await binding.sessions.createSession({ user, mfaVerified: true });
      sessionId = tokens.sessionId; credential = tokens.sessionToken;
      return tokens;
    })).then(() => null, error => error);
    try {
      await paused;
      const session = await findCmSessionById(sessionId);
      expect(session).not.toBeNull();
      expect(getRemoteSessionAuthority()!.find(sessionId)).toBeNull();
      const tables = ['identity_subject_fences', 'identity_user_accounts', 'identity_account_profiles'];
      const snapshots = await Promise.all(tables.map(table => cmQuery<Record<string, unknown>>(
        `SELECT * FROM ${cmTable(table)} WHERE user_id = $1`, [userId])));
      const receipt = await deleteCmAccountAsAdmin({ actorId, userId });
      expect(receipt.transaction).toBe('committed');
      const options = { mode: 'write', purpose: 'delivery', deadlineMs: 5_000, maxAttempts: 3 } as const;
      const now = new Date();
      const claims = await cmIdentityUnitOfWork.run(options, tx => tx.revocationOutbox.claimPending({
        workerId: crypto.randomUUID(), now: now.toISOString(),
        leaseUntil: new Date(now.getTime() + 30_000).toISOString(), limit: 100,
      }));
      expect(claims.map(claim => claim.record.deliveryId).sort()).toEqual([...receipt.deliveryIds].sort());
      for (const claim of claims) {
        await deliverCmRevocation(claim);
        await cmIdentityUnitOfWork.run(options, tx => acknowledgeIdentityRevocationV1({
          tx, claim, at: new Date().toISOString(), connectorCustody: null,
        }));
      }
      expect((await deleteCmAccountAsAdmin({ actorId, userId }, receipt.operationId)).complete).toBe(true);
      release();
      expect(await publication).toMatchObject({ code: 'replay_refused' });
      expect(getRemoteSessionAuthority()!.find(sessionId)).toMatchObject({ revoked: true });
      for (const [index, table] of tables.entries()) {
        const row = snapshots[index][0];
        const assignments = Object.keys(row).map(key => `"${key}" = EXCLUDED."${key}"`).join(', ');
        await cmQuery(`INSERT INTO ${cmTable(table)} SELECT * FROM jsonb_populate_record(NULL::${cmTable(table)}, $1::jsonb)
          ON CONFLICT (user_id) DO UPDATE SET ${assignments}`, [JSON.stringify(row)]);
      }
      await cmReinsertSession(session!);
      expect(await resolveRemoteLogin(credential)).toBeNull();
    } finally { release(); await publication; }
  });
});
