import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import type {
  CustodyInvocationContextRequest,
  CustodyTokenVerifierPort,
  CustodyVerifiedInvocationContext,
} from './custody-types.js';
import { decodeCustodyToken } from './custody-wire.js';

export class CustodyTokenRejectedError extends Error {
  constructor(readonly reason: string) {
    super('custody token rejected');
    this.name = 'CustodyTokenRejectedError';
  }
}

export function createCustodyInvocationVerifier(input: {
  readonly context: VerifiedInvocationContextPort;
  readonly custodyTokens: CustodyTokenVerifierPort;
}): VerifiedInvocationContextPort {
  return {
    async verify(baseRequest) {
      const request = baseRequest as CustodyInvocationContextRequest;
      const context = await input.context.verify(request);
      if (request.custodyToken === undefined) return context;
      if (!request.custodyAction || !context.registration) {
        throw new Error('custody token has no action-bound registration context');
      }
      const token = (() => {
        try {
          return decodeCustodyToken(request.custodyToken!);
        } catch {
          throw new CustodyTokenRejectedError('untrusted');
        }
      })();
      // Echoing token-owned values is safe because validateCurrentBinding rechecks
      // audience and custodyId against the source's privileged binding map.
      const decision = await input.custodyTokens.verify(token, {
        audience: token.audience,
        registrationId: context.registration.registrationId,
        action: request.custodyAction,
        holderPrincipalId: context.principal.principalId,
        epoch: context.registration.custodyEpoch,
        custodyId: token.custodyId,
        invocationId: context.invocationId,
      });
      if (!decision.ok) throw new CustodyTokenRejectedError(decision.reason);
      return {
        ...context,
        custody: {
          custodyId: decision.token.custodyId,
          holderPrincipalId: decision.token.holderPrincipalId,
          epoch: decision.token.epoch,
          sourceToken: decision.token,
        },
      } satisfies CustodyVerifiedInvocationContext;
    },
  };
}
