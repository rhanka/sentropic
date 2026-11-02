import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app';
import { findCmUserByEmail } from '../../../src/services/identity/cm-users';
import { createCmInvitation, findCmInvitationByTokenHash, sha256Hex } from '../../../src/services/identity/cm-proofs';
import { listCmApprovedTenantIds } from '../../../src/services/identity/cm-tenancy';
import { getWebAuthnConfig } from '../../../src/services/webauthn-config';
import { authenticatedRequest, createAuthenticatedUser, generateTestVerificationToken, type TestUser } from '../../utils/auth-helper';
import { cmDeleteForEmails, cmDeleteForUsers, cmQuery, cmTable } from '../../utils/cm-identity-test-store';
import { createSyntheticPasskey } from '../../utils/synthetic-passkey';

const post = (path: string, body: unknown) => app.request(`/api/v1/auth/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const prepare = async (email: string, verificationToken: string) => {
  const response = await post('register/options', { email, verificationToken });
  expect(response.status).toBe(200);
  const options = await response.json(), config = getWebAuthnConfig();
  const passkey = createSyntheticPasskey(config.rpID,
    typeof config.origin === 'string' ? config.origin : config.origin[0], options.userId);
  return { passkey, input: { email, verificationToken, userId: options.userId,
    credential: passkey.registration(options.options.challenge), deviceName: 'Synthetic authenticator' } };
};

describe('A4 real registration, approval and login', () => {
  let email: string, admin: TestUser;
  beforeEach(async () => {
    email = `a4-register-${randomUUID()}@example.com`;
    admin = await createAuthenticatedUser('admin_app');
  });
  afterEach(async () => {
    const user = await findCmUserByEmail(email);
    const ids = [user?.id, admin?.id].filter((id): id is string => Boolean(id));
    const owned = await cmQuery<{ id: string }>('SELECT id FROM public.workspaces WHERE owner_user_id = ANY($1)', [ids]);
    await cmQuery('DELETE FROM public.workspaces WHERE id = ANY($1)', [owned.map(row => row.id)]);
    await cmDeleteForEmails([email, admin?.email].filter((value): value is string => Boolean(value)));
    await cmDeleteForUsers(ids);
    await cmQuery(`DELETE FROM ${cmTable('cm_workspaces')} WHERE workspace_id = ANY($1)`, [owned.map(row => row.id)]);
  });

  it('registers with real attestation, approves the account, then logs in with a real signed assertion', async () => {
    const verificationToken = await generateTestVerificationToken(email);
    const { input, passkey } = await prepare(email, verificationToken);
    const registered = await post('register/verify', input);
    expect(registered.status).toBe(200);
    expect(registered.headers.get('set-cookie')).toContain('session=');
    const registration = await registered.json(), userId = registration.user.id;
    expect(await findCmUserByEmail(email)).toMatchObject({ id: userId, accountStatus: 'pending_admin_approval' });
    expect(await listCmApprovedTenantIds(userId)).toEqual([]);

    const approved = await authenticatedRequest(app, 'POST', `/api/v1/admin/users/${userId}/approve`,
      admin.sessionToken!, { role: 'editor' });
    expect(approved.status).toBe(200);
    expect(await findCmUserByEmail(email)).toMatchObject({ accountStatus: 'active', role: 'editor', approvedByUserId: admin.id });
    // Account approval never manufactures an organization approval.
    expect(await listCmApprovedTenantIds(userId)).toEqual([]);
    const options = await post('login/options', { email });
    expect(options.status).toBe(200);
    const { options: { challenge } } = await options.json();
    const loggedIn = await post('login/verify', { credential: passkey.assertion(challenge, true) });
    expect(loggedIn.status).toBe(200);
    expect((await loggedIn.json()).user).toMatchObject({ id: userId, role: 'editor' });
    expect(loggedIn.headers.get('set-cookie')).toContain('session=');
  });

  it('consumes an invitation once even when two valid registration ceremonies were prepared', async () => {
    const token = `sit_${randomUUID()}`;
    await createCmInvitation({ email, token, now: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    const first = await prepare(email, token), second = await prepare(email, token);
    const registered = await post('register/verify', first.input);
    expect(registered.status).toBe(200);
    const { user: { id } } = await registered.json();
    const consumed = await findCmInvitationByTokenHash(sha256Hex(token));
    expect(consumed).toMatchObject({ status: 'consumed', consumedByUserId: id });
    const retried = await post('register/verify', second.input);
    expect(retried.status).toBeGreaterThanOrEqual(400);
    expect(retried.status).toBeLessThan(500);
    expect(retried.headers.get('set-cookie')).toBeNull();
    expect(await findCmInvitationByTokenHash(sha256Hex(token))).toEqual(consumed);
    expect(await cmQuery(`SELECT credential_id FROM ${cmTable('identity_webauthn_credentials')} WHERE user_id = $1`, [id]))
      .toEqual([{ credential_id: first.passkey.credentialId }]);
    expect(await cmQuery(`SELECT user_id FROM ${cmTable('identity_user_accounts')} WHERE email = $1`, [email]))
      .toEqual([{ user_id: id }]);
  });
});
