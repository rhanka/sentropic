import type { AuthHonoPorts, AuthHonoRelyingPartyConfig, OAuthContinuationCodec } from '@sentropic/auth-hono';
import { createIdentityAuthHonoTransactionBindingV1, runIdentityAuthCompletionV1,
  type IdentityAuthAccountPolicyV1, type IdentityAuthBusinessHooksV1,
  type IdentityAuthCompletionFlowV1, type IdentityAuthCompletionOutcomeV1,
  type IdentityAuthHonoTransactionBindingV1, type IdentityDeferredMailV1 } from '@sentropic/cluster-mesh/identity/auth-hono';
import { IdentityCustodyErrorV1, type IdentityEmailCodeKeyRingV1 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import { cmIdentityUnitOfWork, cmRequestReadOptions, cmRequestWriteOptions, withCmIdentityTransaction, withSerializationRetry,
  type CmIdentityTransaction } from './cm-transaction';
import type { createCmTokenCustodian } from './cm-token-custodian';
import { createServiceTenantEnrollmentSource } from '../tenancy/enrollment-store';
import { createCmAuthEntityPlan, withCmAuthEntityPlan } from './cm-auth-entity-plan';
import { assertCmHostHealthy, createCmPortFailureFence } from './cm-host-scope';
import { resolveCmRegistrationContext, type CmRegistrationPresentation } from './cm-registration-context';
import { bindCmRemoteSessionAuthority } from './cm-remote-session-authority';
export type { CmRegistrationPresentation } from './cm-registration-context';

export interface CmAuthBindingConfig {
  readonly hostPortsForTransaction: (tx: CmIdentityTransaction, boundPorts: () => AuthHonoPorts) => AuthHonoPorts;
  readonly tokens: ReturnType<typeof createCmTokenCustodian>;
  readonly rp: AuthHonoRelyingPartyConfig;
  readonly webAuthnTimeouts: { readonly registration: number; readonly authentication: number };
  readonly accountPolicy: IdentityAuthAccountPolicyV1;
  readonly business: IdentityAuthBusinessHooksV1<PoolClient>;
  readonly emailCodeKeys: IdentityEmailCodeKeyRingV1;
  readonly magicLinkBaseUrl: string;
  readonly registrationContinuation: OAuthContinuationCodec;
  readonly sendDeferredMail: (mail: IdentityDeferredMailV1) => Promise<void>;
}
type Work<T> = (binding: IdentityAuthHonoTransactionBindingV1, tx: CmIdentityTransaction) => Promise<T>;
type Registration = { readonly email: string; readonly clientId: string | null } | null;
type RegistrationContext = Registration | ((tx: CmIdentityTransaction) => Promise<Registration>);

/** r6 §4.7: configuration is pinned before entry; handles and buffers stay in an attempt. */
export function createCmAuthRequestRunner(config: CmAuthBindingConfig) {
  const attempt = <T>(tx: CmIdentityTransaction, work: Work<T>, registration: RegistrationContext,
    entityPlan: ReturnType<typeof createCmAuthEntityPlan>) =>
    withCmAuthEntityPlan(entityPlan, () => withCmIdentityTransaction(tx, async () => {
      const trustedRegistration = typeof registration === 'function' ? await registration(tx) : registration;
      const capture = createCmPortFailureFence(tx.hostTransaction);
      let currentBinding: IdentityAuthHonoTransactionBindingV1 | undefined;
      const host = config.hostPortsForTransaction(tx, () => {
        if (!currentBinding) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
        return currentBinding.ports;
      });
      const hostPorts = capture({ ...host, random: { ...host.random, uuid: entityPlan.attemptUuid() } });
      const committed: Array<() => void> = [];
      const binding = bindCmRemoteSessionAuthority(capture(createIdentityAuthHonoTransactionBindingV1({
        tx, hostPorts, digest: config.tokens.digest,
        loginTokens: config.tokens.loginTokens, ticketTokens: config.tokens.ticketTokens,
        rp: config.rp, accountPolicy: config.accountPolicy, emailCodeKeys: config.emailCodeKeys,
        webAuthnPolicy: { registrationUserVerification: 'preferred', authenticationUserVerification: 'required',
          registrationTimeoutMs: config.webAuthnTimeouts.registration, authenticationTimeoutMs: config.webAuthnTimeouts.authentication },
        magicLink: { baseUrl: config.magicLinkBaseUrl, tokenBytes: 32, ttlSeconds: 600 },
        social: { autoLinkProviders: ['google'] }, business: config.business, trustedRegistration,
        serviceTenancy: { enrollments: createServiceTenantEnrollmentSource(tx) },
      })), tx, committed);
      currentBinding = binding;
      try {
        const value = await work(binding, tx);
        assertCmHostHealthy(tx.hostTransaction);
        // Drain the callback-owned synchronous audit buffer before any commit/publication.
        await binding.flushAudit();
        return { value, committed, mail: binding.deferredMail.map(intent => ({ ...intent })) };
      } finally { currentBinding = undefined; }
    }));
  const publish = async <T>(result: { value: T; committed: Array<() => void>; mail: IdentityDeferredMailV1[] }): Promise<T> => {
    try {
      for (const operation of result.committed) operation();
      for (const intent of result.mail) await config.sendDeferredMail(intent);
      return result.value;
    } finally { result.mail.length = 0; }
  };
  return {
    async complete<T>(flow: IdentityAuthCompletionFlowV1, work: Work<T>, trustedRegistration: RegistrationContext = null)
      : Promise<IdentityAuthCompletionOutcomeV1<T>> {
      const entityPlan = createCmAuthEntityPlan();
      // Concurrent requests on the same custody rows abort with 40001; each
      // retry opens a fresh transaction and observes the winner (safe: an
      // aborted attempt commits nothing and publishes nothing).
      const outcome = await withSerializationRetry(() => runIdentityAuthCompletionV1({ flow, unitOfWork: cmIdentityUnitOfWork,
        options: cmRequestWriteOptions, operation: tx => attempt(tx, work, trustedRegistration, entityPlan) }));
      if (!outcome.committed) return outcome;
      return { committed: true, value: await publish(outcome.value) };
    },
    // Both WebAuthn options calls and the unchanged OAuth/middleware consumers use
    // the bare UOW, with fresh ports and audit drain on every callback execution.
    // Same serialization retry as complete (concurrent touchActivity writes abort).
    async request<T>(work: Work<T>, trustedRegistration: RegistrationContext = null): Promise<T> {
      const entityPlan = createCmAuthEntityPlan();
      const result = await withSerializationRetry(() => cmIdentityUnitOfWork.run(cmRequestWriteOptions,
        tx => attempt(tx, work, trustedRegistration, entityPlan)));
      return publish(result);
    },
    // Per-request authentication is a read-only decision: the CM session
    // validation skips subject locks and the activity touch when the
    // transaction is read-only, so the page-load fan-out (half a dozen
    // parallel GETs sharing one session) no longer aborts itself with 40001
    // on the hot login-token-binding row. Liveness stays best-effort at the
    // HTTP layer (cm-http-principal); fail-closed validation is unchanged.
    async authenticate<T>(work: Work<T>, trustedRegistration: RegistrationContext = null): Promise<T> {
      const entityPlan = createCmAuthEntityPlan();
      const result = await withSerializationRetry(() => cmIdentityUnitOfWork.run(cmRequestReadOptions,
        tx => attempt(tx, work, trustedRegistration, entityPlan)));
      return publish(result);
    },
    async registrationContext(presentation: CmRegistrationPresentation, tx: CmIdentityTransaction): Promise<Registration> {
      return resolveCmRegistrationContext({ presentation, now: new Date(),
        email: config.accountPolicy.normalizeEmail(presentation.email), invitations: tx.custody.invitations,
        digest: config.tokens.digest, ticketTokens: config.tokens.ticketTokens,
        continuationCodec: config.registrationContinuation });
    },
  };
}
