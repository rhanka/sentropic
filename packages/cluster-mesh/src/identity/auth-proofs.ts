import type { AuthHonoChallengePort, AuthHonoMagicLinkPort, AuthHonoInvitesPort } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { WebAuthnChallengeV1, MagicLinkProofV1, DigestInvitationV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';

export const authProofPorts = <H>(input: IdentityAuthBindingInput<H>, evidence: Set<string>, check: () => void) => {
  const { tx } = input;
  const challenges = new Map<string, WebAuthnChallengeV1>(), links = new Map<string, MagicLinkProofV1>(), invites = new Map<string, DigestInvitationV1>();
  let verifying: WebAuthnChallengeV1 | undefined, registrationUserId: string | null = null;
  const now = () => input.hostPorts.clock.now().toISOString();
  const pending = (expiresAt: string, state: string) => state === 'pending' && expiresAt > now();
  const challengePort: AuthHonoChallengePort = {
    create: async (value) => {
      check(); if (value.userId) await tx.lockSubject(value.userId);
      const record: WebAuthnChallengeV1 = { kind: 'webauthn_challenge', proofId: input.hostPorts.random.uuid(), userId: value.userId ?? null,
        state: 'pending', revision: 0, createdAt: now(), expiresAt: value.expiresAt.toISOString(), consumedAt: null, revokedAt: null,
        challenge: value.challenge, purpose: value.type, rpId: input.rp.id, allowedOrigins: [...input.rp.expectedOrigins],
        userVerification: value.type === 'registration' ? input.webAuthnPolicy.registrationUserVerification : input.webAuthnPolicy.authenticationUserVerification };
      await tx.custody.singleUseProofs.insert(record);
      return { id: record.proofId, userId: record.userId, challenge: record.challenge, type: record.purpose, expiresAt: value.expiresAt, used: false, createdAt: new Date(record.createdAt) };
    },
    findValid: async (challenge, type) => {
      check();
      const record = await tx.custody.singleUseProofs.findChallenge(challenge, type);
      if (!record || !pending(record.expiresAt, record.state)) return null;
      if (record.rpId !== input.rp.id || !record.allowedOrigins.some((origin) => input.rp.expectedOrigins.includes(origin))) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      challenges.set(challenge, record); verifying = record;
      return { id: record.proofId, userId: record.userId, challenge, type, expiresAt: new Date(record.expiresAt), used: false, createdAt: new Date(record.createdAt) };
    },
    markUsed: async (challenge) => {
      check(); const record = challenges.get(challenge);
      if (!record) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      const boundUser = record.purpose === 'registration' ? registrationUserId : record.userId;
      if (boundUser) await tx.lockSubject(boundUser);
      await tx.custody.singleUseProofs.consume({ key: { kind: record.kind, proofId: record.proofId }, expectedRevision: record.revision,
        expectedUserId: record.userId, bindUserId: boundUser, match: { kind: record.kind, challenge, purpose: record.purpose, rpId: record.rpId }, at: now() });
    },
    purgeExpired: (at) => { check(); return tx.custody.singleUseProofs.purgeExpired(at.toISOString()); },
  };
  const magicLinks: AuthHonoMagicLinkPort = {
    create: async (value) => {
      check(); if (value.userId) await tx.lockSubject(value.userId);
      const record: MagicLinkProofV1 = { kind: 'magic_link', proofId: input.hostPorts.random.uuid(), userId: value.userId ?? null, state: 'pending', revision: 0,
        createdAt: value.now.toISOString(), expiresAt: value.expiresAt.toISOString(), consumedAt: null, revokedAt: null, email: value.email, tokenHash: value.tokenHash };
      await tx.custody.singleUseProofs.insert(record);
      return { id: record.proofId, email: record.email, tokenHash: record.tokenHash, userId: record.userId, expiresAt: value.expiresAt, createdAt: value.now, used: false };
    },
    findValidByTokenHash: async (hash) => {
      check(); const record = await tx.custody.singleUseProofs.findMagicLink(hash);
      if (!record || !pending(record.expiresAt, record.state)) return null;
      links.set(record.proofId, record); evidence.add(record.email);
      return { id: record.proofId, email: record.email, tokenHash: record.tokenHash, userId: record.userId, expiresAt: new Date(record.expiresAt), createdAt: new Date(record.createdAt), used: false };
    },
    markUsed: async (id, userId) => {
      check(); const record = links.get(id);
      if (!record || !userId) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      await tx.lockSubject(userId);
      const user = await tx.stores.accounts.findAccount(userId);
      if (user?.email !== record.email) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      await tx.custody.singleUseProofs.consume({ key: { kind: record.kind, proofId: id }, expectedRevision: record.revision, expectedUserId: record.userId,
        bindUserId: userId, match: { kind: record.kind, email: record.email, tokenHash: record.tokenHash }, at: now() });
    },
  };
  const invitations: AuthHonoInvitesPort = {
    findValid: async (hash) => {
      check(); const record = await tx.custody.invitations.findByDigest(hash), trusted = input.trustedRegistration;
      if (!record || !trusted || !pending(record.expiresAt, record.status) || record.email !== trusted.email
        || (record.clientId !== null && record.clientId !== trusted.clientId)) return null;
      invites.set(hash, record); evidence.add(record.email);
      return { email: record.email, clientId: record.clientId };
    },
    consume: async (hash, at, userId) => {
      check(); const record = invites.get(hash);
      if (!record || !input.trustedRegistration) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      await tx.lockSubject(userId);
      if ((await tx.stores.accounts.findAccount(userId))?.email !== record.email) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      const used = await tx.custody.invitations.consumeByDigest({ tokenHash: hash, email: input.trustedRegistration.email,
        clientId: input.trustedRegistration.clientId, userId, expectedRevision: record.revision, at: at.toISOString() });
      return { email: used.email };
    },
  };
  return { challenges: challengePort, magicLinks, invites: invitations,
    verificationPolicy: () => verifying,
    bindRegistrationUser: (id: string) => { registrationUserId = id; },
  };
};
