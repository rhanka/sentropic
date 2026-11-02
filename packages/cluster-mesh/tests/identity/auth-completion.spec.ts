import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuthHonoPorts } from '@sentropic/auth-hono';
import { webauthnFixture } from './webauthn-fixture.js';
import { createIdentityAuthHonoTransactionBindingV1, runIdentityAuthCompletionV1, createNodeIdentityDigestPort, createHs256EmailTicketPort } from '../../src/index.js';
import { asOpHost, NOW, openPostgresEnv, openSqliteEnv, pgEnabled } from './a20b-helpers.js';

const WRITE = { mode: 'write', purpose: 'request', deadlineMs: 5000, maxAttempts: 1 } as const;
const READ = { ...WRITE, mode: 'read' } as const;
const forbidden = new Proxy({}, { get: () => () => { throw new Error('legacy host identity method called'); } });
const hostPorts = {
  users: forbidden, credentials: forbidden, challenges: forbidden, sessions: forbidden, emailVerification: forbidden, magicLinks: forbidden,
  tokens: forbidden, accountPolicy: forbidden, emailDelivery: forbidden, auditLog: forbidden,
  clock: { now: () => new Date(NOW), addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000) },
  random: { uuid: randomUUID, bytes: randomBytes, token: (size: number) => randomBytes(size).toString('base64url'), numericCode: () => '123456' },
} as unknown as AuthHonoPorts;
const shared = {
  hostPorts, digest: createNodeIdentityDigestPort(),
  ticketTokens: createHs256EmailTicketPort(new Uint8Array(32).fill(9)),
  emailCodeKeys: { issuance: 'sha256' as const, activeKeyRef: null, previousKeyRefs: [] },
  rp: { id: 'example.test', name: 'Example', expectedOrigins: ['https://example.test'] },
  accountPolicy: { normalizeEmail: (email: string) => email.trim().toLowerCase(), deriveDisplayName: () => 'Person', roleForNewUser: () => 'editor', statusForNewUser: () => ({ accountStatus: 'active', approvalDueAt: null }) },
  webAuthnPolicy: { registrationUserVerification: 'preferred' as const, authenticationUserVerification: 'required' as const },
  magicLink: { baseUrl: 'https://example.test', tokenBytes: 32, ttlSeconds: 600 },
  social: { autoLinkProviders: ['google'] },
  business: { afterUserCreated: async () => undefined, provisionWorkspace: async () => undefined },
  trustedRegistration: null,
  loginTokens: { sign: async () => { throw new Error('not used'); }, verify: async () => { throw new Error('not used'); } },
};

describe.each(pgEnabled ? ['sqlite', 'postgres'] as const : ['sqlite'] as const)('real auth completion on %s', (profile) => {
  const open = async () => asOpHost((profile === 'postgres' ? await openPostgresEnv() : openSqliteEnv()).unitOfWork);

  it('retries a social revision race only after rolling back the whole callback', async () => {
    const unitOfWork = await open();
    await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      const user = await binding.ports.users.create({ email: 'social@example.test', role: 'editor' });
      await binding.ports.federation!.linkIdentity({ userId: user.id, provider: 'google', providerSubject: 'subject-1', emailAtLink: user.email, emailVerifiedByProvider: true, now: new Date(NOW) });
    });
    let attempts = 0;
    const outcome = await runIdentityAuthCompletionV1({ flow: 'social', unitOfWork, options: { ...WRITE, maxAttempts: 2 }, operation: async (tx) => {
      attempts++;
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx }), row = (await binding.ports.federation!.findIdentityBySubject('google', 'subject-1'))!;
      await tx.ledger.append({ at: NOW, kind: 'social.attempt.' + attempts });
      if (attempts === 1) await tx.custody.social.touchLogin(row.id, 0, NOW);
      await binding.ports.federation!.touchLogin(row.id, new Date(NOW));
      return row.userId;
    } });
    expect(attempts).toBe(2);
    expect(outcome.committed).toBe(true);
    await unitOfWork.run(READ, async (tx) => {
      expect(await tx.custody.social.findBySubject('google', 'subject-1')).toMatchObject({ revision: 1 });
      expect((await tx.ledger.listAuditEvents()).map((event) => event.kind)).toEqual(['social.attempt.2']);
    });
    await expect(unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx }), row = (await binding.ports.federation!.findIdentityBySubject('google', 'subject-1'))!;
      await tx.custody.social.touchLogin(row.id, 1, NOW);
      await binding.ports.federation!.touchLogin(row.id, new Date(NOW));
    })).rejects.toMatchObject({ code: 'identity_record_conflict' });
  });

  it('retries the recognized social email-create collision without SQL in the failed attempt', async () => {
    const unitOfWork = await open();
    const owner = await unitOfWork.run(WRITE, (tx) => createIdentityAuthHonoTransactionBindingV1({ ...shared, tx }).ports.users.create({ email: 'race@example.test', role: 'editor' }));
    let attempts = 0;
    const result = await runIdentityAuthCompletionV1({ flow: 'social', unitOfWork, options: { ...WRITE, maxAttempts: 2 }, operation: async (tx) => {
      attempts++;
      if (attempts === 1) tx.stores.accounts.findAccountByEmail = async () => null;
      return createIdentityAuthHonoTransactionBindingV1({ ...shared, tx }).resolveFederatedUser({
        provider: 'google', providerSubject: 'racing-subject', email: owner.email, emailVerifiedByProvider: true, now: new Date(NOW),
      });
    } });
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ committed: true, value: { kind: 'auto-linked', userId: owner.id } });
    await unitOfWork.run(READ, async (tx) => { expect(await tx.stores.accounts.listAccounts()).toHaveLength(1); });
  });

  it('permits the authorized owned unlink of a revoked imported subject', async () => {
    const unitOfWork = await open();
    await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      const user = await binding.ports.users.create({ email: 'unlink@example.test', role: 'editor' });
      await tx.custody.social.insert({ proofId: 'revoked-subject', userId: user.id, provider: 'google', providerSubject: 'revoked',
        providerTenant: null, emailAtLink: user.email, emailVerifiedByProvider: true, linkedAt: NOW, lastLoginAt: null, revokedAt: NOW, revision: 1 });
      expect(await binding.ports.federation!.unlinkIdentity(user.id, 'google', 'revoked')).toBe(true);
      expect(await tx.custody.social.findBySubject('google', 'revoked')).toBeNull();
    });
  });

  it('aborts invalid registration continuations and rolls back provisional accounts', async () => {
    const unitOfWork = await open();
    const outcome = await runIdentityAuthCompletionV1({ flow: 'registration', unitOfWork, options: WRITE, operation: async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      await binding.ports.users.create({ email: 'ticket@example.test', role: 'editor' });
      await binding.ports.emailVerification.verifyToken('ticket@example.test', 'bad.signature', new Date(NOW));
      return { verified: true };
    } });
    expect(outcome).toMatchObject({ committed: false, refusal: { flow: 'registration', result: { verified: false,
      error: { code: 'registration_verification_failed', status: 400 } } } });
    await unitOfWork.run(READ, async (tx) => { expect(await tx.stores.accounts.findAccountByEmail('ticket@example.test')).toBeNull(); });
  });

  it('keeps the registration default floor and stores each admitted origin once', async () => {
    const unitOfWork = await open();
    await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx,
        rp: { ...shared.rp, expectedOrigins: ['https://example.test', 'https://example.test'] },
        accountPolicy: { ...shared.accountPolicy, resolveUserVerification: () => 'discouraged' },
        webAuthnPolicy: { ...shared.webAuthnPolicy, registrationUserVerification: 'discouraged' },
      });
      const user = await binding.ports.users.create({ email: 'uv@example.test', role: 'editor' });
      const options = await binding.registration.generateRegistrationOptions({ userId: user.id, userName: user.email!, userDisplayName: 'UV' });
      expect(options.authenticatorSelection?.userVerification).toBe('preferred');
      expect(await tx.custody.singleUseProofs.findChallenge(options.challenge, 'registration'))
        .toMatchObject({ userVerification: 'preferred', allowedOrigins: ['https://example.test'] });
    });
  });

  it('allows a pure session validation callback in read mode', async () => {
    const unitOfWork = await open();
    expect(await runIdentityAuthCompletionV1({ flow: 'session_validate', unitOfWork, options: READ,
      operation: async (tx) => ({ accounts: await tx.stores.accounts.listAccounts() }),
    })).toEqual({ committed: true, value: { accounts: [] } });
  });

  it('preserves administrative MFA reads while request views require matching token evidence', async () => {
    const unitOfWork = await open();
    await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      const user = await binding.ports.users.create({ email: 'mfa@example.test', role: 'editor' });
      await tx.custody.sessions.insert({ sessionId: 'mfa-session', userId: user.id, sessionTokenHash: 'a'.repeat(64), refreshTokenHash: 'b'.repeat(64),
        login: { mfaVerified: true, authTime: 123, sessionVersion: 1 }, rotationVersion: 0, deviceName: null, ipAddress: null, userAgent: null,
        createdAt: NOW, lastActivityAt: NOW, expiresAt: '2026-11-01T13:00:00.000Z', revokedAt: null });
      expect(await binding.ports.sessions.findById('mfa-session')).toMatchObject({ mfaVerified: true });
      expect(await binding.ports.sessions.findByRefreshTokenHash('b'.repeat(64))).toMatchObject({ mfaVerified: true });
      expect(await binding.ports.sessions.findByTokenHash('a'.repeat(64))).toMatchObject({ mfaVerified: false });
    });
  });

  it('evaluates the root creation policy instead of accepting requested privilege or approval', async () => {
    const unitOfWork = await open(), due = new Date('2026-12-01T00:00:00.000Z');
    await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx, accountPolicy: { ...shared.accountPolicy,
        statusForNewUser: () => ({ accountStatus: 'pending_admin_approval', approvalDueAt: due }),
      } });
      const user = await binding.ports.users.create({ email: 'policy@example.test', role: 'admin_app', accountStatus: 'active', approvalDueAt: null });
      expect(user).toMatchObject({ role: 'editor', accountStatus: 'pending_admin_approval', approvalDueAt: due });
      expect(await tx.stores.accounts.findAccount(user.id)).toMatchObject({ globalRole: 'editor', accountStatus: 'pending_admin_approval' });
    });
  });

  it('rejects an unknown completion flow before invoking the callback', async () => {
    const unitOfWork = await open();
    let called = false;
    await expect(runIdentityAuthCompletionV1({ flow: 'unknown' as never, unitOfWork, options: WRITE,
      operation: async () => { called = true; return true; },
    })).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    expect(called).toBe(false);
  });

  it('rolls back an actual signed assertion when its counter regresses to zero', async () => {
    const unitOfWork = await open(), fixture = webauthnFixture();
    await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      const user = await binding.ports.users.create({ email: 'counter@example.test', role: 'editor' });
      const registration = await binding.registration.generateRegistrationOptions({ userName: user.email!, userDisplayName: 'Counter' });
      await binding.registration.verifyRegistration({ userId: user.id, expectedChallenge: registration.challenge, credential: fixture.registration(registration.challenge) });
      const challenge = await binding.authentication.generateAuthenticationOptions({});
      await binding.authentication.verifyAuthentication({ expectedChallenge: challenge.challenge, credential: fixture.assertion(challenge.challenge, 5) });
    });
    const options = await unitOfWork.run(WRITE, async (tx) => createIdentityAuthHonoTransactionBindingV1({ ...shared, tx }).authentication.generateAuthenticationOptions({}));
    const refused = await runIdentityAuthCompletionV1({ flow: 'authentication', unitOfWork, options: WRITE, operation: async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      await tx.ledger.append({ at: NOW, kind: 'counter.must.rollback' });
      return binding.authentication.verifyAuthentication({ expectedChallenge: options.challenge, credential: fixture.assertion(options.challenge, 0) });
    } });
    expect(refused).toMatchObject({ committed: false, refusal: { flow: 'authentication', result: { verified: false, error: { code: 'authentication_verification_failed', status: 401 } } } });
    await unitOfWork.run(READ, async (tx) => {
      expect(await tx.custody.credentials.findByCredentialId(fixture.credentialId)).toMatchObject({ counter: 5 });
      expect(await tx.custody.singleUseProofs.findChallenge(options.challenge, 'authentication')).toMatchObject({ state: 'pending' });
      expect((await tx.ledger.listAuditEvents()).some((event) => event.kind === 'counter.must.rollback')).toBe(false);
    });
  });

  it('persists actual registration and assertion evidence with the exact anonymous challenge owner', async () => {
    const unitOfWork = await open(), fixture = webauthnFixture();
    const userId = await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      const user = await binding.ports.users.create({ email: 'passkey@example.test', role: 'editor', accountStatus: 'active' });
      const options = await binding.registration.generateRegistrationOptions({ userName: user.email!, userDisplayName: 'Passkey' });
      const stored = await tx.custody.singleUseProofs.findChallenge(options.challenge, 'registration');
      expect(stored?.userVerification).toBe(options.authenticatorSelection?.userVerification);
      expect(await binding.registration.verifyRegistration({ userId: user.id, expectedChallenge: options.challenge, credential: fixture.registration(options.challenge) })).toMatchObject({ verified: true });
      expect(await tx.custody.credentials.findByCredentialId(fixture.credentialId)).toMatchObject({ counter: 0, uv: true, userId: user.id });
      return user.id;
    });
    const outcome = await runIdentityAuthCompletionV1({ flow: 'authentication', unitOfWork, options: WRITE, operation: async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      const options = await binding.authentication.generateAuthenticationOptions({});
      const result = await binding.authentication.verifyAuthentication({ expectedChallenge: options.challenge, credential: fixture.assertion(options.challenge, 1) });
      expect(result).toMatchObject({ verified: true, userVerified: true, userId });
      expect(await tx.custody.singleUseProofs.findChallenge(options.challenge, 'authentication')).toMatchObject({ state: 'consumed', userId });
      return result;
    } });
    expect(outcome.committed).toBe(true);
  });

  it('refuses unverified credential creation and legacy session rotation with exact contract codes', async () => {
    const unitOfWork = await open(), fixture = webauthnFixture();
    await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      const user = await binding.ports.users.create({ email: 'direct@example.test', role: 'editor' });
      await expect(binding.ports.credentials.create({ userId: user.id, credentialId: fixture.credentialId, publicKey: fixture.publicKey, counter: 0 }))
        .rejects.toMatchObject({ code: 'identity_transaction_unbound' });
      await expect(binding.ports.sessions.updateTokens({ sessionId: 'absent', sessionTokenHash: 'x', refreshTokenHash: 'y', expiresAt: new Date(NOW) }))
        .rejects.toMatchObject({ code: 'identity_contract_unavailable' });
      expect(await tx.custody.credentials.findByCredentialId(fixture.credentialId)).toBeNull();
    });
  });

  it('keeps returned and stored registration UV identical when current policy strengthens the default', async () => {
    const unitOfWork = await open();
    await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx, webAuthnPolicy: { ...shared.webAuthnPolicy, registrationUserVerification: 'required' } });
      const options = await binding.registration.generateRegistrationOptions({ userName: 'person@example.test', userDisplayName: 'Person' });
      expect(options.authenticatorSelection?.userVerification).toBe('required');
      expect(await tx.custody.singleUseProofs.findChallenge(options.challenge, 'registration')).toMatchObject({ userVerification: 'required' });
    });
  });

  it('constructs real options and buffers then drains audit once on the bound transaction', async () => {
    const unitOfWork = await open();
    let expired: ReturnType<typeof createIdentityAuthHonoTransactionBindingV1>;
    const challenge = await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      expired = binding;
      const options = await binding.registration.generateRegistrationOptions({ userName: 'person@example.test', userDisplayName: 'Person' });
      expect(await tx.custody.singleUseProofs.findChallenge(options.challenge, 'registration')).toMatchObject({ userId: null, rpId: 'example.test' });
      expect(binding.ports.auditLog.record('info', 'authentication.completed', { token: 'secret', subjectId: 'safe-id' })).toBeUndefined();
      expect(await tx.ledger.listAuditEvents()).toEqual([]);
      await binding.flushAudit();
      await binding.flushAudit();
      const events = await tx.ledger.listAuditEvents();
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain('secret');
      return options.challenge;
    });
    expect(challenge).toBeTruthy();
    await expect(expired!.flushAudit()).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
  });

  it('runs the real magic-link service over CM and rolls back false completion results', async () => {
    const unitOfWork = await open();
    const issued = await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      expect(await binding.magicLink.requestMagicLink({ email: 'Person@Example.Test' })).toMatchObject({ success: true });
      const mail = binding.deferredMail[0];
      if (mail.kind !== 'magic_link') throw new Error('wrong mail');
      await binding.flushAudit();
      return mail;
    });
    const outcome = await runIdentityAuthCompletionV1({ flow: 'magic_link', unitOfWork, options: WRITE, operation: async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({ ...shared, tx });
      const result = await binding.magicLink.verifyMagicLink({ token: issued.token });
      expect(result).toMatchObject({ valid: true, user: { email: 'person@example.test' } });
      await binding.flushAudit();
      return result;
    } });
    expect(outcome.committed).toBe(true);
    const refused = await runIdentityAuthCompletionV1({ flow: 'registration', unitOfWork, options: WRITE, operation: async (tx) => {
      await tx.ledger.append({ at: NOW, kind: 'must.rollback' });
      return { verified: false as const, error: { code: 'invalid_or_expired_challenge', status: 400, message: 'Invalid challenge.' } };
    } });
    expect(refused).toMatchObject({ committed: false, refusal: { flow: 'registration', result: { verified: false } } });
    await unitOfWork.run(READ, async (tx) => { expect((await tx.ledger.listAuditEvents()).some((event) => event.kind === 'must.rollback')).toBe(false); });
  });
});
