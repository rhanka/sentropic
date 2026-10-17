import { CanonicalCommandError, computeProposedContentDigest } from '@sentropic/comments';
import type { CanonicalHttpPorts, CanonicalLifecycleRequest, CommandCapability, ResourceRef } from '@sentropic/comments';
import type { CommentsRevisionRequest } from './command-contracts.js';
import type { commentsRouterBinding } from './router-binding.js';
type Binding = NonNullable<ReturnType<typeof commentsRouterBinding>>;
export const checkCommentsHttpDecision = async (ports: CanonicalHttpPorts, binding: Binding, request: CommentsRevisionRequest | CanonicalLifecycleRequest, action: string): Promise<void> => {
  if (!request.decisionRef) return;
  const evidence = await ports.decisions.resolve(request.decisionRef);
  const { decisionRef: _reference, idempotencyKey: _key, expected, ...proposal } = request;
  const content = 'content' in request ? request.content : proposal;
  if (!evidence || evidence.revoked || evidence.actor !== binding.context.current().grant.principalId || evidence.action !== action || evidence.scope.tenantId !== request.scope.tenantId || evidence.scope.workspaceId !== request.scope.workspaceId ||
    (expected.kind === 'revision' ? evidence.binding.kind !== 'existing-revision' || evidence.binding.revisionHash !== expected.revisionHash
      : evidence.binding.kind !== 'creation' || evidence.binding.aggregateVersion !== expected.aggregateVersion || evidence.binding.proposedContentDigest !== computeProposedContentDigest(content as Record<string, unknown>))) throw new CanonicalCommandError('denied', 'Comments HTTP decision binding is unavailable');
  // The installed service additionally resolves its pinned authority again and
  // checks expiry with the injected domain clock at actual publication.
};
export const checkCommentsHttpTargets = async (ports: CanonicalHttpPorts, binding: Binding, capability: CommandCapability, targets: readonly ResourceRef[]): Promise<void> => {
  const principal = binding.context.current().grant.principalId;
  if (!targets.length || !await ports.capabilities.check(principal, capability, targets)) throw new CanonicalCommandError('denied', 'Comments HTTP capability is unavailable');
  for (const target of targets) if (!['exact', 'source-changed'].includes(await ports.resolver.resolve(principal, target))) throw new CanonicalCommandError('denied', 'Comments HTTP resource is unavailable');
};
export const commentsHttpRevisionTargets = async (binding: Binding, request: CommentsRevisionRequest) => {
  if (!request.content || typeof request.content !== 'object') throw new SyntaxError('Revision content is required');
  const selection = request.kind === 'annotation' ? { kind: 'annotation-revisions' as const, annotationId: request.content.annotationId } : request.kind === 'thread' ? { kind: 'thread-structure-revisions' as const, threadId: request.content.threadId } : { kind: 'comment-revisions' as const, commentId: request.content.commentId };
  const old = await binding.services.targets({ scope: request.scope, selection, capability: request.kind === 'thread' ? 'comment' : 'revise' });
  const targets = request.kind === 'annotation' ? [request.content.primary, ...request.content.secondary].map((target) => target.resource)
    : request.kind === 'thread' ? [request.content.primary.resource]
      : await binding.services.targets({ scope: request.scope, selection: { kind: 'thread-structure-revisions', threadId: request.content.threadId }, capability: old.length ? 'revise' : 'comment', hash: request.content.structureRevision.hash });
  return { targets: [...old, ...targets], capability: request.kind === 'annotation' || (request.kind === 'comment' && old.length > 0) ? 'revise' as const : 'comment' as const };
};
