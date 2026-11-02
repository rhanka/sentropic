import type { AuthHonoEmailVerificationPort, AuthHonoEmailVerificationService } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { IdentityDigestV1, EmailRegistrationTicketV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';
import { emailCodePreimageV1 } from './custody-crypto.js';

export const authEmailService = <H>(input: IdentityAuthBindingInput<H>, evidence: Set<string>, check: () => void,
  mail: (email: string, code: string, expiresAt: string) => void) => {
  const { tx, emailCodeKeys: keys } = input;
  const tickets = new Map<string, EmailRegistrationTicketV1>();
  const digest = async (email: string, code: string, keyRef: string | null): Promise<IdentityDigestV1> => {
    const bytes = keyRef === null ? Buffer.from(code, 'utf8') : emailCodePreimageV1(email, code);
    try { return keyRef === null ? { algorithm: 'sha256', value: await input.digest.sha256(bytes) }
      : { algorithm: 'hmac-sha256', keyRef, value: await input.digest.hmacSha256(keyRef, bytes) }; }
    finally { bytes.fill(0); }
  };
  const hash = async (token: string): Promise<string> => {
    const bytes = Buffer.from(token, 'utf8');
    try { return await input.digest.sha256(bytes); } finally { bytes.fill(0); }
  };
  const service: AuthHonoEmailVerificationService = {
    requestEmailCode: async ({ email: supplied }) => {
      check(); const email = supplied.trim().toLowerCase(), now = input.hostPorts.clock.now();
      await tx.lockEmail(email);
      if (await tx.custody.singleUseProofs.countEmailCodes(email, new Date(now.getTime() - 600_000).toISOString()) >= 3) {
        return { success: false, error: { code: 'rate_limited', message: 'Too many verification code requests.', status: 429 } };
      }
      if (keys.issuance === 'hmac-sha256' && !keys.activeKeyRef) throw new IdentityCustodyErrorV1('identity_material_missing');
      const code = input.hostPorts.random.numericCode(6), expiresAt = new Date(now.getTime() + 600_000);
      await tx.custody.singleUseProofs.insert({ kind: 'email_code', proofId: input.hostPorts.random.uuid(), userId: null, state: 'pending', revision: 0,
        createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), consumedAt: null, revokedAt: null, email,
        codeDigest: await digest(email, code, keys.issuance === 'sha256' ? null : keys.activeKeyRef) });
      mail(email, code, expiresAt.toISOString());
      return { success: true, expiresAt };
    },
    verifyEmailCode: async ({ email: supplied, code }) => {
      check(); const email = supplied.trim().toLowerCase(), now = input.hostPorts.clock.now().toISOString();
      await tx.lockEmail(email);
      const candidates: IdentityDigestV1[] = [await digest(email, code, null)];
      for (const keyRef of new Set([keys.activeKeyRef, ...keys.previousKeyRefs].filter((ref): ref is string => ref !== null))) candidates.push(await digest(email, code, keyRef));
      const record = await tx.custody.singleUseProofs.findLatestEmailCode(email, candidates, now);
      if (!record) return { valid: false, error: { code: 'invalid_or_expired_code', message: 'Verification code is invalid or expired.', status: 400 } };
      const expiresAt = new Date(Date.parse(now) + 900_000).toISOString();
      const verificationToken = await input.ticketTokens.sign({ codeProofId: record.proofId, email, issuedAt: now, expiresAt });
      await tx.custody.emailTickets.exchangeCode({ codeProofId: record.proofId, expectedRevision: record.revision, email, digest: record.codeDigest, at: now,
        ticket: { codeProofId: record.proofId, email, tokenHash: await hash(verificationToken), userId: null, state: 'pending', revision: 0, createdAt: now, expiresAt, consumedAt: null, revokedAt: null } });
      return { valid: true, verificationToken };
    },
  };
  const unsupported = async (): Promise<never> => { throw new IdentityCustodyErrorV1('identity_contract_unavailable'); };
  const port: AuthHonoEmailVerificationPort = {
    countRecent: (email, since) => { check(); return tx.custody.singleUseProofs.countEmailCodes(email.trim().toLowerCase(), since.toISOString()); },
    createCode: unsupported, findLatestValidCode: unsupported, markUsedWithVerificationToken: unsupported,
    verifyToken: async (email, token, now) => {
      check(); const bytes = Buffer.from(token, 'utf8');
      try {
        const claims = await input.ticketTokens.verify(bytes, now.toISOString()), ticket = await tx.custody.emailTickets.findByTokenHash(await hash(token));
        if (!ticket || ticket.state !== 'pending' || ticket.expiresAt <= now.toISOString() || claims.codeProofId !== ticket.codeProofId
          || claims.email !== email.trim().toLowerCase() || ticket.email !== claims.email) return false;
        tickets.set(ticket.email, ticket); evidence.add(ticket.email); return true;
      } finally { bytes.fill(0); }
    },
  };
  return { service, port, consumeRegistration: async (userId: string) => {
    const user = await tx.stores.accounts.findAccount(userId);
    const ticket = user ? tickets.get(user.email) : undefined;
    if (ticket) await tx.custody.emailTickets.consume({ tokenHash: ticket.tokenHash, email: ticket.email, expectedRevision: ticket.revision, bindUserId: userId, at: input.hostPorts.clock.now().toISOString() });
  } };
};
