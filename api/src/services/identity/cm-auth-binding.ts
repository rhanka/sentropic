import type { AuthHonoPorts, AuthHonoRelyingPartyConfig } from '@sentropic/auth-hono';
import { createIdentityAuthHonoTransactionBindingV1, runIdentityAuthCompletionV1,
  type IdentityAuthAccountPolicyV1, type IdentityAuthBusinessHooksV1,
  type IdentityAuthCompletionFlowV1, type IdentityAuthCompletionOutcomeV1,
  type IdentityAuthHonoTransactionBindingV1, type IdentityDeferredMailV1,
  type IdentityEmailCodeKeyRingV1 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import { cmIdentityUnitOfWork, cmRequestWriteOptions, withCmIdentityTransaction,
  type CmIdentityTransaction } from './cm-transaction';
import type { createCmTokenCustodian } from './cm-token-custodian';

export interface CmAuthBindingConfig {
  readonly hostPortsForTransaction: (tx: CmIdentityTransaction) => AuthHonoPorts;
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

/** r6 §4.7: configuration is pinned before entry; handles and buffers stay in an attempt. */
export function createCmAuthRequestRunner(config: CmAuthBindingConfig) {
  const attempt = <T>(tx: CmIdentityTransaction, work: Work<T>, trustedRegistration: Registration) =>
    withCmIdentityTransaction(tx, async () => {
      const binding = createIdentityAuthHonoTransactionBindingV1({
        tx, hostPorts: config.hostPortsForTransaction(tx), digest: config.tokens.digest,
        loginTokens: config.tokens.loginTokens, ticketTokens: config.tokens.ticketTokens,
        rp: config.rp, accountPolicy: config.accountPolicy, emailCodeKeys: config.emailCodeKeys,
        webAuthnPolicy: { registrationUserVerification: 'preferred', authenticationUserVerification: 'required' },
        magicLink: { baseUrl: config.magicLinkBaseUrl, tokenBytes: 32, ttlSeconds: 900 },
        social: { autoLinkProviders: ['google'] }, business: config.business, trustedRegistration,
      });
      const value = await work(binding, tx);
      // Drain the callback-owned synchronous audit buffer before any commit/publication.
      await binding.flushAudit();
      return { value, mail: binding.deferredMail.map(intent => ({ ...intent })) };
    });
  const publish = async <T>(result: { value: T; mail: IdentityDeferredMailV1[] }): Promise<T> => {
    try {
      for (const intent of result.mail) await config.sendDeferredMail(intent);
      return result.value;
    } finally { result.mail.length = 0; }
  };
  return {
    async complete<T>(flow: IdentityAuthCompletionFlowV1, work: Work<T>, trustedRegistration: Registration = null)
      : Promise<IdentityAuthCompletionOutcomeV1<T>> {
      const outcome = await runIdentityAuthCompletionV1({ flow, unitOfWork: cmIdentityUnitOfWork,
        options: cmRequestWriteOptions, operation: tx => attempt(tx, work, trustedRegistration) });
      if (!outcome.committed) return outcome;
      return { committed: true, value: await publish(outcome.value) };
    },
    // Both WebAuthn options calls and the unchanged OAuth/middleware consumers use
    // the bare UOW, with fresh ports and audit drain on every callback execution.
    async request<T>(work: Work<T>, trustedRegistration: Registration = null): Promise<T> {
      const result = await cmIdentityUnitOfWork.run(cmRequestWriteOptions,
        tx => attempt(tx, work, trustedRegistration));
      return publish(result);
    },
  };
}
