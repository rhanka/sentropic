import { CanonicalCommandError, checkDecisionEvidence, computeProposedContentDigest, validateCapacityDescriptor } from '@sentropic/comments';
import type { CanonicalLifecycleRequest, CommandCapability, ResourceRef } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { own, sameScope } from './storage-schema.js';
export const pinCommentsServices = (supplied: CommentsServiceOptions): CommentsServiceOptions => {
  const capacity = own(supplied.capacity); validateCapacityDescriptor(capacity);
  return Object.freeze({ capacity,
    capabilities: Object.freeze({ check: supplied.capabilities.check.bind(supplied.capabilities) }),
    resolver: Object.freeze({ resolve: supplied.resolver.resolve.bind(supplied.resolver) }),
    decisions: supplied.decisions ? Object.freeze({ resolve: supplied.decisions.resolve.bind(supplied.decisions) }) : undefined,
    clock: Object.freeze({ now: supplied.clock.now.bind(supplied.clock) }),
  });
};
export const authorizeComments = async (options: CommentsServiceOptions, context: PgInstalledContext, capability: CommandCapability, supplied: readonly ResourceRef[], request?: CanonicalLifecycleRequest): Promise<void> => {
  const targets = own(supplied);
  const check = async () => {
    const principal = context.grant.principalId;
    if (!targets.length || targets.some((target) => !sameScope(target.scope, context.grant.scope)) || !await options.capabilities.check(principal, capability, targets)) throw new CanonicalCommandError('denied', 'Comments capability is not granted for every target');
    for (const target of targets) {
      const outcome = await options.resolver.resolve(principal, target);
      if (outcome !== 'exact' && outcome !== 'source-changed') throw new CanonicalCommandError('denied', 'Comments resource is unavailable');
    }
    if (request?.decisionRef) {
      const { decisionRef, idempotencyKey: _key, expected, ...proposal } = request;
      const evidence = await options.decisions?.resolve(decisionRef) ?? null;
      checkDecisionEvidence(evidence, { actor: principal, action: request.action, scope: request.scope, now: options.clock.now(),
        binding: expected.kind === 'revision' ? { kind: 'existing-revision', revisionHash: expected.revisionHash } : { kind: 'creation', aggregateVersion: expected.aggregateVersion, proposedContentDigest: computeProposedContentDigest(proposal) } });
    }
  };
  await check(); context.revalidate(check);
};
