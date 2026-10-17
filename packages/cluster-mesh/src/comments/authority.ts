import { CanonicalCommandError, checkDecisionEvidence, computeProposedContentDigest, validateCapacityDescriptor } from '@sentropic/comments';
import type { CanonicalLifecycleRequest, CommandCapability, ResourceRef, ExpectedState } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { ScopeGrant } from '../storage/authority.js';
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
export const assertCommentsAuthority = async (options: CommentsServiceOptions, grant: ScopeGrant<unknown>, capability: CommandCapability, targets: readonly ResourceRef[], request?: CanonicalLifecycleRequest): Promise<void> => {
    const principal = grant.principalId;
    if (!targets.length || targets.some((target) => !sameScope(target.scope, grant.scope)) || !await options.capabilities.check(principal, capability, targets)) throw new CanonicalCommandError('denied', 'Comments capability is not granted for every target');
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
export const authorizeComments = async (options: CommentsServiceOptions, context: PgInstalledContext, capability: CommandCapability, supplied: readonly ResourceRef[], request?: CanonicalLifecycleRequest): Promise<void> => {
  const targets = own(supplied);
  const check = () => assertCommentsAuthority(options, context.grant, capability, targets, request);
  await check(); context.revalidate(check);
};
export const authorizeCommentsRevisionDecision = async (options: CommentsServiceOptions, context: PgInstalledContext, input: { readonly decisionRef: string; readonly scope: CanonicalLifecycleRequest['scope']; readonly expected: ExpectedState; readonly content: unknown }, action: string): Promise<void> => {
  if (!input.decisionRef) return;
  const check = async () => {
    const evidence = await options.decisions?.resolve(input.decisionRef) ?? null;
    checkDecisionEvidence(evidence, { actor: context.grant.principalId, action, scope: input.scope, now: options.clock.now(), binding: input.expected.kind === 'revision'
      ? { kind: 'existing-revision', revisionHash: input.expected.revisionHash }
      : { kind: 'creation', aggregateVersion: input.expected.aggregateVersion, proposedContentDigest: computeProposedContentDigest(input.content as Record<string, unknown>) } });
  };
  await check(); context.revalidate(check);
};
