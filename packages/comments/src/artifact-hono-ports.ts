import type { TenantContext } from '@sentropic/contracts';
import type { Context } from 'hono';
import { z } from 'zod';

import type { CommentStore } from './store.js';
import type { Comment, CommentProvenance, CommentTarget, CommentThreadSummary } from './types.js';

export const ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH = 2048;
export const SECTION_KEY_TOO_LONG_CODE = 'section_key_too_long';
export const PROVENANCE_TOOL_CALL_ID_REQUIRED_CODE = 'provenance_tool_call_id_required';

export type ArtifactCommentActorKind = 'human' | 'agent' | 'nhi';

export interface ArtifactCommentsHttpPrincipal {
  readonly userId: string;
  readonly workspaceId: string;
  readonly clientId?: string;
  readonly actorKind?: ArtifactCommentActorKind;
}

export type ArtifactCommentAuthzDecision =
  | { readonly ok: true; readonly isAdmin?: boolean }
  | { readonly ok: false; readonly status: 403 | 404; readonly code: string };

export interface ArtifactCommentsAuthzPort {
  resolvePrincipal(
    context: Context,
  ): ArtifactCommentsHttpPrincipal | undefined | Promise<ArtifactCommentsHttpPrincipal | undefined>;
  authorizeArtifact(input: {
    readonly principal: ArtifactCommentsHttpPrincipal;
    readonly artifactId: string;
    readonly action: 'read' | 'comment';
  }): Promise<ArtifactCommentAuthzDecision>;
  isAdmin?(principal: ArtifactCommentsHttpPrincipal): Promise<boolean> | boolean;
}

export interface ArtifactCommentsTenantPort {
  resolve(principal: ArtifactCommentsHttpPrincipal): Promise<TenantContext>;
  memberExists(input: { readonly userId: string; readonly workspaceId: string }): Promise<boolean>;
}

export interface ArtifactCommentsEventPort {
  emit(input: {
    readonly workspaceId: string;
    readonly contextType: 'artifact';
    readonly contextId: string;
    readonly action: 'created' | 'updated' | 'closed' | 'reopened' | 'deleted' | 'reassigned';
    readonly key: 'comment_id' | 'thread_id';
    readonly commentId?: string;
    readonly threadId: string;
    readonly origin: 'rest';
  }): Promise<void> | void;
}

export interface CreateArtifactCommentsRouterOptions {
  readonly store: CommentStore;
  readonly tenant: ArtifactCommentsTenantPort;
  readonly authz: ArtifactCommentsAuthzPort;
  readonly events?: ArtifactCommentsEventPort;
  readonly nonHumanClientIds?: readonly string[];
}

const actorKindSchema = z.enum(['human', 'agent', 'nhi']);
const toolCallIdSchema = z.string().trim().min(1);

export const isArtifactTarget = (target: CommentTarget): boolean =>
  (target.recordType ?? target.kind) === 'artifact';

export const normalizeArtifactTarget = (target: CommentTarget): CommentTarget => ({
  kind: 'artifact',
  id: target.id,
  ...(target.sectionKey !== undefined ? { sectionKey: target.sectionKey } : {}),
});

export const serializeArtifactComment = (row: Comment): Comment => ({
  ...row,
  target: normalizeArtifactTarget(row.target),
});

export const serializeArtifactSummary = (row: CommentThreadSummary): CommentThreadSummary => ({
  ...row,
  contextType: 'artifact',
  target: normalizeArtifactTarget(row.target),
});

export const checkSectionKeyCap = (c: Context, value: string | undefined): Response | null =>
  value !== undefined && Array.from(value).length > ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH
    ? c.json({
      code: SECTION_KEY_TOO_LONG_CODE,
      error: `section_key exceeds maximum length of ${ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH} characters`,
      maxLength: ARTIFACT_COMMENT_SECTION_KEY_MAX_LENGTH,
    }, 400)
    : null;

export const resolveHttpProvenance = (
  c: Context,
  principal: ArtifactCommentsHttpPrincipal,
  nonHumanClients: ReadonlySet<string>,
  bodyActorKind: ArtifactCommentActorKind | undefined,
  rawProvenance: { toolCallId?: string; runId?: string } | undefined,
): { ok: true; provenance?: CommentProvenance } | { ok: false; response: Response } => {
  const rawHeader = c.req.header('x-sentropic-actor-kind');
  let headerActorKind: ArtifactCommentActorKind | undefined;
  if (rawHeader !== undefined) {
    const parsed = actorKindSchema.safeParse(rawHeader.trim().toLowerCase());
    if (!parsed.success) {
      return { ok: false, response: c.json({ code: 'invalid_request', error: 'Invalid actor_kind header' }, 400) };
    }
    headerActorKind = parsed.data;
  }
  const serverNonHuman = principal.actorKind === 'agent' || principal.actorKind === 'nhi'
    || (principal.clientId !== undefined && nonHumanClients.has(principal.clientId));
  const declaredNonHuman = bodyActorKind === 'agent' || bodyActorKind === 'nhi'
    || headerActorKind === 'agent' || headerActorKind === 'nhi';
  if (!serverNonHuman && !declaredNonHuman && rawProvenance === undefined) return { ok: true };
  const parsedToolCallId = toolCallIdSchema.safeParse(rawProvenance?.toolCallId);
  if (!parsedToolCallId.success) {
    return {
      ok: false,
      response: c.json({
        code: PROVENANCE_TOOL_CALL_ID_REQUIRED_CODE,
        error: 'Non-empty provenance.toolCallId is required',
      }, 400),
    };
  }
  return {
    ok: true,
    provenance: {
      toolCallId: parsedToolCallId.data,
      ...(rawProvenance?.runId !== undefined ? { runId: rawProvenance.runId } : {}),
    },
  };
};
