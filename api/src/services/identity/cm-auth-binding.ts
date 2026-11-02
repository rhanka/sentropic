import type { AuthHonoPorts, AuthHonoRelyingPartyConfig } from '@sentropic/auth-hono';
import { createIdentityAuthHonoTransactionBindingV1, runIdentityAuthCompletionV1,
  IdentityCustodyErrorV1,
  type IdentityAuthAccountPolicyV1, type IdentityAuthBusinessHooksV1,
  type IdentityAuthCompletionFlowV1, type IdentityAuthCompletionOutcomeV1,
  type IdentityAuthHonoTransactionBindingV1, type IdentityDeferredMailV1,
  type IdentityEmailCodeKeyRingV1 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import { cmIdentityUnitOfWork, cmRequestWriteOptions, withCmIdentityTransaction,
  type CmIdentityTransaction } from './cm-transaction';
import type { createCmTokenCustodian } from './cm-token-custodian';
import { createCmAuthEntityPlan, withCmAuthEntityPlan } from './cm-auth-entity-plan';
import { assertCmHostHealthy } from './cm-host-scope';

export interface CmAuthBindingConfig {
  readonly hostPortsForTransaction: (tx: CmIdentityTransaction, boundPorts: () => AuthHonoPorts) => AuthHonoPorts;
  readonly tokens: ReturnType<typeof createCmTokenCustodian>;
  readonly rp: AuthHonoRelyingPartyConfig;
  readonly accountPolicy: IdentityAuthAccountPolicyV1;
  readonly business: IdentityAuthBusinessHooksV1<PoolClient>;
  readonly emailCodeKeys: IdentityEmailCodeKeyRingV1;
  readonly magicLinkBaseUrl: string;
  readonly sendDeferredMail: (mail: IdentityDeferredMailV1) => Promise<void>;
}
type Work<T> = (binding: IdentityAuthHonoTransactionBindingV1, tx: CmIdentityTransaction) => Promise<T>;
type Registration = { readonly email: string; readonly clientId: string | null } | null;
type RegistrationContext = Registration | ((tx: CmIdentityTransaction) => Promise<Registration>);
export interface CmRegistrationPresentation { readonly email: string; readonly verificationToken?: string }

/** r6 §4.7: configuration is pinned before entry; handles and buffers stay in an attempt. */
export function createCmAuthRequestRunner(config: CmAuthBindingConfig) {
  const attempt = <T>(tx: CmIdentityTransaction, work: Work<T>, registration: RegistrationContext,
    entityPlan: ReturnType<typeof createCmAuthEntityPlan>) =>
    withCmAuthEntityPlan(entityPlan, () => withCmIdentityTransaction(tx, async () => {
      const trustedRegistration = typeof registration === 'function' ? await registration(tx) : registration;
      let currentBinding: IdentityAuthHonoTransactionBindingV1 | undefined;
      const host = config.hostPortsForTransaction(tx, () => {
        if (!currentBinding) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
        return currentBinding.ports;
      });
      const hostPorts = { ...host, random: { ...host.random, uuid: entityPlan.attemptUuid() } };
      const binding = createIdentityAuthHonoTransactionBindingV1({
        tx, hostPorts, digest: config.tokens.digest,
        loginTokens: config.tokens.loginTokens, ticketTokens: config.tokens.ticketTokens,
        rp: config.rp, accountPolicy: config.accountPolicy, emailCodeKeys: config.emailCodeKeys,
        webAuthnPolicy: { registrationUserVerification: 'preferred', authenticationUserVerification: 'required' },
        magicLink: { baseUrl: config.magicLinkBaseUrl, tokenBytes: 32, ttlSeconds: 900 },
        social: { autoLinkProviders: ['google'] }, business: config.business, trustedRegistration,
      });
      currentBinding = binding;
      try {
        const value = await work(binding, tx);
        assertCmHostHealthy(tx.hostTransaction);
        // Drain the callback-owned synchronous audit buffer before any commit/publication.
        await binding.flushAudit();
        return { value, mail: binding.deferredMail.map(intent => ({ ...intent })) };
      } finally { currentBinding = undefined; }
    }));
  const publish = async <T>(result: { value: T; mail: IdentityDeferredMailV1[] }): Promise<T> => {
    try {
      for (const intent of result.mail) await config.sendDeferredMail(intent);
      return result.value;
    } finally { result.mail.length = 0; }
  };
  return {
    async complete<T>(flow: IdentityAuthCompletionFlowV1, work: Work<T>, trustedRegistration: RegistrationContext = null)
      : Promise<IdentityAuthCompletionOutcomeV1<T>> {
      const entityPlan = createCmAuthEntityPlan();
      const outcome = await runIdentityAuthCompletionV1({ flow, unitOfWork: cmIdentityUnitOfWork,
        options: cmRequestWriteOptions, operation: tx => attempt(tx, work, trustedRegistration, entityPlan) });
      if (!outcome.committed) return outcome;
      return { committed: true, value: await publish(outcome.value) };
    },
    // Both WebAuthn options calls and the unchanged OAuth/middleware consumers use
    // the bare UOW, with fresh ports and audit drain on every callback execution.
    async request<T>(work: Work<T>, trustedRegistration: RegistrationContext = null): Promise<T> {
      const entityPlan = createCmAuthEntityPlan();
      const result = await cmIdentityUnitOfWork.run(cmRequestWriteOptions,
        tx => attempt(tx, work, trustedRegistration, entityPlan));
      return publish(result);
    },
    async registrationContext(presentation: CmRegistrationPresentation, tx: CmIdentityTransaction): Promise<Registration> {
      const token = presentation.verificationToken;
      if (!token) return null;
      const email = config.accountPolicy.normalizeEmail(presentation.email);
      const bytes = new TextEncoder().encode(token);
      try {
        if (token.startsWith('sit_')) {
          const invitation = await tx.custody.invitations.findByDigest(await config.tokens.digest.sha256(bytes));
          // A client-bound invitation additionally needs its verified OAuth continuation.
          // Request JSON never chooses that trusted client; absence refuses the binding.
          return invitation && invitation.email === email && invitation.clientId === null
            ? { email: invitation.email, clientId: null } : null;
        }
        const claims = await config.tokens.ticketTokens.verify(bytes, new Date().toISOString());
        return claims.email === email ? { email: claims.email, clientId: null } : null;
      } catch (error) {
        if (error instanceof IdentityCustodyErrorV1 && error.code === 'proof_binding_mismatch') return null;
        throw error;
      } finally { bytes.fill(0); }
    },
  };
}
