import type {
  AuthHonoAccountPolicyPort,
  AuthHonoFederationPort,
  AuthHonoIdentityRecord,
  AuthHonoLinkIdentityInput,
  AuthHonoUserPort,
} from '../ports.js';

/**
 * BR-39e Lot 0 — the SAFE federated user-resolution algorithm (D6/D7).
 *
 * This is the security-critical decision core of social/enterprise login, deliberately kept as a
 * PURE library function (no DB, no provider SDK) so the account-takeover guarantees are unit-tested
 * at the substrate level, independent of the provider/route code (Lot 1). It composes the thin
 * `federation` port (identity rows), the existing `users` port (find/upsert), and `accountPolicy`.
 *
 * Non-negotiable invariants encoded here:
 *  - Resolve by the stable `(provider, providerSubject)` FIRST (D6). A changed provider email never
 *    re-links (D13). The fuzzy register lookup (email → displayName → local-part) is NEVER reused.
 *  - No verified provider email → NEVER write a silent no-email/unverified user; route to the local
 *    email-verification challenge (D9).
 *  - An email collision auto-links ONLY into a non-credentialed shell AND only for an allowlisted
 *    provider (D8, Google-only in v1). A credentialed account is NEVER silently merged (D7/OD2) —
 *    it routes to authenticated manual-link.
 */

/**
 * Thrown by a federation adapter's `linkIdentity` when the UNIQUE(provider, providerSubject)
 * constraint rejects the insert (a concurrent callback already linked this identity). The resolver
 * catches it, re-reads by subject, and logs the existing user in idempotently.
 */
export class AuthHonoIdentityConflictError extends Error {
  readonly provider: string;
  readonly providerSubject: string;

  constructor(provider: string, providerSubject: string) {
    super(`Identity already linked for provider="${provider}".`);
    this.name = 'AuthHonoIdentityConflictError';
    this.provider = provider;
    this.providerSubject = providerSubject;
  }
}

export type FederationManualLinkReason =
  /** The collided account already holds a sign-in factor — never silently absorbed. */
  | 'credentialed_account'
  /** The provider is not on the auto-link allowlist (D8; only Google in v1). */
  | 'provider_not_auto_link';

export type FederationResolveOutcome =
  /** Subject match (case 1): the identity is known; log this user in. */
  | { kind: 'linked-existing'; userId: string; identity: AuthHonoIdentityRecord }
  /** New user (case 2): no subject match, no email collision; user + identity created. */
  | { kind: 'created'; userId: string; identity: AuthHonoIdentityRecord }
  /** Safe auto-link (case 3a): verified-email collision with a non-credentialed shell, allowlisted. */
  | { kind: 'auto-linked'; userId: string; identity: AuthHonoIdentityRecord }
  /** Manual-link required (case 3b): NEVER merge; the human must sign in with their existing factor. */
  | { kind: 'manual-link-required'; existingUserId: string; reason: FederationManualLinkReason }
  /** Email challenge required (D9): no usable verified email; no user/identity row is written. */
  | { kind: 'email-challenge-required'; provider: string; providerSubject: string };

export interface FederationResolveInput {
  provider: string;
  providerSubject: string;
  /** Provider-asserted email (may be null for GitHub-private / Facebook-declined). */
  email: string | null;
  /** Did the provider assert this email verified? */
  emailVerifiedByProvider: boolean;
  /** MS `tid` (audit + future subject policy); null for other providers. */
  providerTenant?: string | null;
  now: Date;
}

export interface FederationResolveDeps {
  federation: AuthHonoFederationPort;
  users: Pick<AuthHonoUserPort, 'findByEmail' | 'create'>;
  accountPolicy: Pick<
    AuthHonoAccountPolicyPort,
    'normalizeEmail' | 'deriveDisplayName' | 'roleForNewUser' | 'statusForNewUser'
  >;
  /** D8 auto-link allowlist (Google only in v1). Providers here MAY auto-link into a shell. */
  autoLinkProviders: ReadonlySet<string>;
  /** Idempotent workspace provisioning for a created / auto-linked user (D18). */
  provisionWorkspace: (userId: string) => Promise<void>;
  /** Whether the account being created is the very first user (drives role/status). Defaults to false. */
  isFirstUser?: () => Promise<boolean> | boolean;
}

export async function resolveOrCreateFederatedUser(
  deps: FederationResolveDeps,
  input: FederationResolveInput,
): Promise<FederationResolveOutcome> {
  const { accountPolicy, autoLinkProviders, federation, provisionWorkspace, users } = deps;
  const { emailVerifiedByProvider, now, provider, providerSubject } = input;
  const providerTenant = input.providerTenant ?? null;

  // (1) SUBJECT-FIRST (D6). The stable `(provider, subject)` is the only linking key. A subject
  // match logs that user in even if the provider email now differs (D13) — email is never consulted.
  const known = await federation.findIdentityBySubject(provider, providerSubject);
  if (known) {
    await federation.touchLogin(known.id, now);
    return { identity: known, kind: 'linked-existing', userId: known.userId };
  }

  // (D9) No usable VERIFIED provider email → never write a silent no-email/unverified user, and
  // never auto-link to any existing account. Route to the local email-verification challenge.
  const normalizedEmail =
    input.email && emailVerifiedByProvider ? accountPolicy.normalizeEmail(input.email) : null;
  if (!normalizedEmail) {
    return { kind: 'email-challenge-required', provider, providerSubject };
  }

  const collision = await users.findByEmail(normalizedEmail);

  // (2) No subject match AND no email collision → create the user, then link. The link may lose a
  // UNIQUE(provider,subject) race to a concurrent callback; `linkOrReread` re-reads and the
  // pre-existing identity wins (idempotent).
  if (!collision) {
    const isFirstUser = (await deps.isFirstUser?.()) ?? false;
    const role = await accountPolicy.roleForNewUser({ email: normalizedEmail, isFirstUser });
    const { accountStatus, approvalDueAt } = await accountPolicy.statusForNewUser({
      email: normalizedEmail,
      isFirstUser,
      now,
    });
    const user = await users.create({
      accountStatus,
      approvalDueAt,
      displayName: accountPolicy.deriveDisplayName(normalizedEmail),
      email: normalizedEmail,
      emailVerified: true,
      role,
    });
    const identity = await linkOrReread(federation, {
      emailAtLink: normalizedEmail,
      emailVerifiedByProvider,
      now,
      provider,
      providerSubject,
      providerTenant,
      userId: user.id,
    });
    await provisionWorkspace(identity.userId);
    return identity.userId === user.id
      ? { identity, kind: 'created', userId: user.id }
      : { identity, kind: 'linked-existing', userId: identity.userId };
  }

  // (3) Email collision. SAFE linking (D7/D8): auto-link ONLY into a non-credentialed shell AND
  // only for an allowlisted provider. Everything else routes to authenticated manual-link — a
  // credentialed account is NEVER silently merged, and NO identity row is written for it here.
  if (!autoLinkProviders.has(provider)) {
    return { existingUserId: collision.id, kind: 'manual-link-required', reason: 'provider_not_auto_link' };
  }
  if (await federation.isUserCredentialed(collision.id)) {
    return { existingUserId: collision.id, kind: 'manual-link-required', reason: 'credentialed_account' };
  }
  const identity = await linkOrReread(federation, {
    emailAtLink: normalizedEmail,
    emailVerifiedByProvider,
    now,
    provider,
    providerSubject,
    providerTenant,
    userId: collision.id,
  });
  await provisionWorkspace(identity.userId);
  return { identity, kind: 'auto-linked', userId: identity.userId };
}

async function linkOrReread(
  federation: AuthHonoFederationPort,
  input: AuthHonoLinkIdentityInput,
): Promise<AuthHonoIdentityRecord> {
  try {
    return await federation.linkIdentity(input);
  } catch (error) {
    if (error instanceof AuthHonoIdentityConflictError) {
      const reread = await federation.findIdentityBySubject(input.provider, input.providerSubject);
      if (reread) return reread;
    }
    throw error;
  }
}
