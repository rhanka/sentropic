import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuthHonoPorts } from '@sentropic/auth-hono';
import { createIdentityAuthHonoTransactionBindingV1, runIdentityAuthCompletionV1, createNodeIdentityDigestPort, createNodeIdentityEmailTicketTokenPort } from '../../src/index.js';
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
  ticketTokens: createNodeIdentityEmailTicketTokenPort({ key: new Uint8Array(32).fill(9) }),
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
