// Lot A4: single-use proofs, invitations, WebAuthn credentials and social links
// over the A2.0b custody stores. Replaces the legacy `webauthn_challenges`,
// `magic_links`, `email_verification_codes`, `auth_invite_tokens`,
// `webauthn_credentials` and `identities` tables. Digests are sha256 hex, the
// same encoding the legacy tables stored, so migrated rows stay readable.

import { createHash, randomUUID } from 'node:crypto';

import type { IdentityDigestV1 } from '@sentropic/cluster-mesh';

import { getCmIdentity } from './cm-identity';

export const sha256Hex = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

const sha256Digest = (secret: string): IdentityDigestV1 => ({ algorithm: 'sha256', value: sha256Hex(secret) });

const date = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

export interface CmMagicLinkRecord {
  readonly id: string;
  readonly tokenHash: string;
  readonly email: string;
  readonly userId: string | null;
  readonly expiresAt: Date;
  readonly used: boolean;
  readonly createdAt: Date;
}

export const createCmMagicLink = async (input: {
  email: string;
  tokenHash: string;
  userId?: string | null;
  expiresAt: Date;
  now: Date;
}): Promise<CmMagicLinkRecord> => {
  const { custody } = getCmIdentity();
  const proofId = randomUUID();
  await custody.singleUseProofs.insert({
    kind: 'magic_link',
    proofId,
    userId: input.userId ?? null,
    state: 'pending',
    revision: 1,
    createdAt: input.now.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    consumedAt: null,
    revokedAt: null,
    email: input.email,
    tokenHash: input.tokenHash,
  });
  const created = await findCmMagicLinkByTokenHash(input.tokenHash);
  if (!created) throw new Error('Failed to create magic link.');
  return created;
};

export const findCmMagicLinkByTokenHash = async (tokenHash: string): Promise<CmMagicLinkRecord | null> => {
  const { custody } = getCmIdentity();
  const proof = await custody.singleUseProofs.findMagicLink(tokenHash);
  if (!proof || proof.kind !== 'magic_link') return null;
  return {
    id: proof.proofId,
    tokenHash: proof.tokenHash,
    email: proof.email,
    userId: proof.userId,
    expiresAt: new Date(proof.expiresAt),
    used: proof.state !== 'pending',
    createdAt: new Date(proof.createdAt),
  };
};

/** Atomic single-use consumption of a magic link; binds it to the user. */
export const consumeCmMagicLink = async (tokenHash: string, userId: string | null, now = new Date()): Promise<boolean> => {
  const { custody } = getCmIdentity();
  const proof = await custody.singleUseProofs.findMagicLink(tokenHash);
  if (!proof || proof.state !== 'pending' || new Date(proof.expiresAt) <= now) return false;
  try {
    await custody.singleUseProofs.consume({
      key: { kind: 'magic_link', proofId: proof.proofId },
      expectedRevision: proof.revision,
      expectedUserId: proof.userId,
      match: { kind: 'magic_link', email: proof.email, tokenHash },
      bindUserId: userId ?? proof.userId,
      at: now.toISOString(),
    });
    return true;
  } catch {
    return false;
  }
};

export const countCmRecentEmailCodes = async (email: string, since: Date): Promise<number> => {
  const { custody } = getCmIdentity();
  return custody.singleUseProofs.countEmailCodes(email, since.toISOString());
};

export interface CmEmailCodeRecord {
  readonly id: string;
  readonly email: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly used: boolean;
  readonly createdAt: Date;
}

export const createCmEmailCode = async (input: {
  email: string;
  codeHash: string;
  expiresAt: Date;
  now: Date;
}): Promise<CmEmailCodeRecord> => {
  const { custody } = getCmIdentity();
  const proofId = randomUUID();
  await custody.singleUseProofs.insert({
    kind: 'email_code',
    proofId,
    userId: null,
    state: 'pending',
    revision: 1,
    createdAt: input.now.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    consumedAt: null,
    revokedAt: null,
    email: input.email,
    codeDigest: { algorithm: 'sha256', value: input.codeHash },
  });
  return {
    id: proofId,
    email: input.email,
    codeHash: input.codeHash,
    expiresAt: input.expiresAt,
    used: false,
    createdAt: input.now,
  };
};

export const findCmLatestValidEmailCode = async (
  email: string,
  codeHash: string,
  now: Date,
): Promise<CmEmailCodeRecord | null> => {
  const { custody } = getCmIdentity();
  const proof = await custody.singleUseProofs.findLatestEmailCode(email, [sha256Digest(codeHash)], now.toISOString());
  if (!proof || proof.kind !== 'email_code') return null;
  return {
    id: proof.proofId,
    email: proof.email,
    codeHash: proof.codeDigest.value,
    expiresAt: new Date(proof.expiresAt),
    used: proof.state !== 'pending',
    createdAt: new Date(proof.createdAt),
  };
};

/** Consumes the code and issues the registration ticket (verification token). */
export const consumeCmEmailCodeWithTicket = async (
  codeProofId: string,
  email: string,
  codeHash: string,
  verificationToken: string,
  now: Date,
): Promise<boolean> => {
  const { custody } = getCmIdentity();
  const proof = await custody.singleUseProofs.find({ kind: 'email_code', proofId: codeProofId });
  if (!proof || proof.kind !== 'email_code' || proof.state !== 'pending') return false;
  try {
    await custody.singleUseProofs.consume({
      key: { kind: 'email_code', proofId: codeProofId },
      expectedRevision: proof.revision,
      expectedUserId: null,
      match: { kind: 'email_code', email, digest: sha256Digest(codeHash) },
      bindUserId: null,
      at: now.toISOString(),
    });
    await custody.emailTickets.importTicket({
      codeProofId,
      email,
      tokenHash: sha256Hex(verificationToken),
      userId: null,
      state: 'pending',
      revision: 1,
      createdAt: now.toISOString(),
      expiresAt: proof.expiresAt,
      consumedAt: null,
      revokedAt: null,
    });
    return true;
  } catch {
    return false;
  }
};

export const verifyCmRegistrationTicket = async (
  email: string,
  verificationToken: string,
  now: Date,
): Promise<boolean> => {
  const { custody } = getCmIdentity();
  const ticket = await custody.emailTickets.findByTokenHash(sha256Hex(verificationToken));
  if (!ticket || ticket.state !== 'pending' || ticket.email !== email || new Date(ticket.expiresAt) <= now) {
    return false;
  }
  try {
    await custody.emailTickets.consume({
      tokenHash: sha256Hex(verificationToken),
      email,
      expectedRevision: ticket.revision,
      bindUserId: ticket.userId ?? '',
      at: now.toISOString(),
    });
    return true;
  } catch {
    return false;
  }
};

export interface CmInvitationRecord {
  readonly id: string;
  readonly email: string;
  readonly clientId: string | null;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly consumedByUserId: string | null;
  readonly createdAt: Date | null;
  readonly status: string;
}

export const findCmInvitationByTokenHash = async (tokenHash: string): Promise<CmInvitationRecord | null> => {
  const { custody } = getCmIdentity();
  const row = await custody.invitations.findByDigest(tokenHash);
  if (!row) return null;
  return {
    id: row.invitationId,
    email: row.email,
    clientId: row.clientId,
    tokenHash: row.tokenHash,
    expiresAt: new Date(row.expiresAt),
    consumedAt: date(row.consumedAt),
    consumedByUserId: row.consumedByUserId,
    createdAt: date(row.createdAt),
    status: row.status,
  };
};

/** Atomic single-use consumption (invitation consumed once). */
export const consumeCmInvitationByTokenHash = async (
  tokenHash: string,
  email: string,
  userId: string,
  now = new Date(),
): Promise<CmInvitationRecord | null> => {
  const { custody } = getCmIdentity();
  const existing = await custody.invitations.findByDigest(tokenHash);
  if (!existing) return null;
  try {
    const consumed = await custody.invitations.consumeByDigest({
      tokenHash,
      email,
      clientId: existing.clientId,
      userId,
      expectedRevision: existing.revision,
      at: now.toISOString(),
    });
    return {
      id: consumed.invitationId,
      email: consumed.email,
      clientId: consumed.clientId,
      tokenHash: consumed.tokenHash,
      expiresAt: new Date(consumed.expiresAt),
      consumedAt: date(consumed.consumedAt),
      consumedByUserId: consumed.consumedByUserId,
      createdAt: date(consumed.createdAt),
      status: consumed.status,
    };
  } catch {
    return null;
  }
};

export const createCmInvitation = async (input: {
  email: string;
  clientId?: string | null;
  token: string;
  expiresAt: Date;
  now: Date;
}): Promise<CmInvitationRecord> => {
  const { custody } = getCmIdentity();
  const invitationId = randomUUID();
  await custody.invitations.insert({
    invitationId,
    email: input.email,
    tenantId: null,
    workspaceId: null,
    clientId: input.clientId ?? null,
    tokenHash: sha256Hex(input.token),
    status: 'pending',
    expiresAt: input.expiresAt.toISOString(),
    createdAt: input.now.toISOString(),
    consumedAt: null,
    consumedByUserId: null,
    revision: 1,
  });
  const created = await findCmInvitationByTokenHash(sha256Hex(input.token));
  if (!created) throw new Error('Failed to create invitation.');
  return created;
};

export interface CmChallengeRecord {
  readonly id: string;
  readonly challenge: string;
  readonly userId: string | null;
  readonly type: 'registration' | 'authentication';
  readonly expiresAt: Date;
  readonly used: boolean;
  readonly createdAt: Date;
}

export const createCmChallenge = async (input: {
  challenge: string;
  userId?: string | null;
  type: 'registration' | 'authentication';
  expiresAt: Date;
  now: Date;
  rpId: string;
  allowedOrigins?: readonly string[];
  userVerification?: 'required' | 'preferred' | 'discouraged';
}): Promise<CmChallengeRecord> => {
  const { custody } = getCmIdentity();
  const proofId = randomUUID();
  await custody.singleUseProofs.insert({
    kind: 'webauthn_challenge',
    proofId,
    userId: input.userId ?? null,
    state: 'pending',
    revision: 1,
    createdAt: input.now.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    consumedAt: null,
    revokedAt: null,
    challenge: input.challenge,
    purpose: input.type,
    rpId: input.rpId,
    allowedOrigins: input.allowedOrigins ?? [],
    userVerification: input.userVerification ?? 'preferred',
  });
  return {
    id: proofId,
    challenge: input.challenge,
    userId: input.userId ?? null,
    type: input.type,
    expiresAt: input.expiresAt,
    used: false,
    createdAt: input.now,
  };
};

export const findCmValidChallenge = async (
  challenge: string,
  type: 'registration' | 'authentication',
  now: Date,
): Promise<CmChallengeRecord | null> => {
  const { custody } = getCmIdentity();
  const proof = await custody.singleUseProofs.findChallenge(challenge, type);
  if (!proof || proof.state !== 'pending' || new Date(proof.expiresAt) <= now) return null;
  return {
    id: proof.proofId,
    challenge: proof.challenge,
    userId: proof.userId,
    type: proof.purpose,
    expiresAt: new Date(proof.expiresAt),
    used: false,
    createdAt: new Date(proof.createdAt),
  };
};

export const consumeCmChallenge = async (
  challenge: string,
  type: 'registration' | 'authentication',
  rpId: string,
  bindUserId: string | null,
  now = new Date(),
): Promise<boolean> => {
  const { custody } = getCmIdentity();
  const proof = await custody.singleUseProofs.findChallenge(challenge, type);
  if (!proof || proof.state !== 'pending') return false;
  try {
    await custody.singleUseProofs.consume({
      key: { kind: 'webauthn_challenge', proofId: proof.proofId },
      expectedRevision: proof.revision,
      expectedUserId: proof.userId,
      match: { kind: 'webauthn_challenge', challenge, purpose: type, rpId },
      bindUserId,
      at: now.toISOString(),
    });
    return true;
  } catch {
    return false;
  }
};

export interface CmCredentialRecord {
  readonly id: string;
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly transports: string[] | null;
  readonly name: string | null;
  readonly deviceType: string | null;
  readonly backedUp: boolean | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

const toCredentialRecord = (row: {
  proofId: string; userId: string; credentialId: string; publicKeyCose: string; counter: number;
  transports: readonly string[] | null; deviceName: string | null; deviceType: string | null;
  backedUp: boolean | null; lastUsedAt: string | null; createdAt: string; revokedAt: string | null;
}): CmCredentialRecord => ({
  id: row.proofId,
  userId: row.userId,
  credentialId: row.credentialId,
  publicKey: row.publicKeyCose,
  counter: row.counter,
  transports: row.transports ? [...row.transports] : null,
  name: row.deviceName,
  deviceType: row.deviceType,
  backedUp: row.backedUp,
  lastUsedAt: date(row.lastUsedAt),
  createdAt: new Date(row.createdAt),
  revokedAt: date(row.revokedAt),
});

export const findCmCredentialByCredentialId = async (credentialId: string): Promise<CmCredentialRecord | null> => {
  const { custody } = getCmIdentity();
  const row = await custody.credentials.findByCredentialId(credentialId);
  return row ? toCredentialRecord(row) : null;
};

export const listCmCredentialsForUser = async (userId: string): Promise<CmCredentialRecord[]> => {
  const { custody } = getCmIdentity();
  const rows = await custody.credentials.listForUser(userId);
  return rows.map(toCredentialRecord);
};

export const createCmCredential = async (input: {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[] | null;
  name?: string | null;
  deviceType?: string | null;
  backedUp?: boolean | null;
  rpId: string;
  now: Date;
}): Promise<CmCredentialRecord> => {
  const { custody } = getCmIdentity();
  const proofId = randomUUID();
  await custody.credentials.insert({
    proofId,
    userId: input.userId,
    credentialId: input.credentialId,
    publicKeyCose: input.publicKey,
    counter: input.counter,
    revision: 1,
    rpId: input.rpId,
    deviceName: input.name ?? null,
    transports: input.transports ?? null,
    uv: false,
    deviceType: input.deviceType ?? null,
    backedUp: input.backedUp ?? null,
    createdAt: input.now.toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  });
  const created = await custody.credentials.findById(proofId);
  if (!created) throw new Error('Failed to create credential.');
  return toCredentialRecord(created);
};

export const compareAndSwapCmCredentialCounter = async (input: {
  credentialId: string;
  userId: string;
  expectedCounter: number;
  newCounter: number;
  now: Date;
}): Promise<boolean> => {
  const { custody } = getCmIdentity();
  const row = await custody.credentials.findByCredentialId(input.credentialId);
  if (!row || row.userId !== input.userId || row.revokedAt) return false;
  try {
    await custody.credentials.compareAndSwapCounter({
      proofId: row.proofId,
      userId: input.userId,
      expectedCounter: input.expectedCounter,
      expectedRevision: row.revision,
      newCounter: input.newCounter,
      at: input.now.toISOString(),
    });
    return true;
  } catch {
    return false;
  }
};

export const revokeCmCredential = async (credentialRecordId: string, userId: string, now = new Date()): Promise<boolean> => {
  const { custody } = getCmIdentity();
  const row = await custody.credentials.findById(credentialRecordId);
  if (!row || row.userId !== userId) return false;
  await custody.credentials.revoke(credentialRecordId, userId, now.toISOString());
  return true;
};

export const findCmSocialBySubject = async (provider: string, providerSubject: string) => {
  const { custody } = getCmIdentity();
  return custody.social.findBySubject(provider, providerSubject);
};

export const listCmSocialForUser = async (userId: string) => {
  const { custody } = getCmIdentity();
  return custody.social.listForUser(userId);
};

export const createCmSocialLink = async (input: {
  userId: string;
  provider: string;
  providerSubject: string;
  providerTenant?: string | null;
  emailAtLink?: string | null;
  emailVerifiedByProvider?: boolean;
  now: Date;
}) => {
  const { custody } = getCmIdentity();
  const proofId = randomUUID();
  await custody.social.insert({
    proofId,
    userId: input.userId,
    provider: input.provider,
    providerSubject: input.providerSubject,
    providerTenant: input.providerTenant ?? null,
    emailAtLink: input.emailAtLink ?? null,
    emailVerifiedByProvider: input.emailVerifiedByProvider ?? false,
    linkedAt: input.now.toISOString(),
    lastLoginAt: null,
    revokedAt: null,
    revision: 1,
  });
  return custody.social.findById(proofId);
};
