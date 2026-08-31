import type { TenantContext } from '@sentropic/contracts';
import type { Context } from 'hono';

import type { CommentStore } from './store.js';

export interface CommentsHttpPrincipal {
  readonly userId: string;
  readonly workspaceId: string;
}

export interface CommentsHttpUser {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

export interface CommentsAuthzPort {
  resolvePrincipal(
    context: Context,
  ): CommentsHttpPrincipal | undefined | Promise<CommentsHttpPrincipal | undefined>;
  authorize(input: {
    readonly principal: CommentsHttpPrincipal;
    readonly action: 'read' | 'comment' | 'admin';
  }): Promise<boolean>;
}

export interface CommentsTenantPort {
  resolve(principal: CommentsHttpPrincipal): Promise<TenantContext>;
  contextExists(input: {
    readonly contextType: string;
    readonly contextId: string;
    readonly workspaceId: string;
  }): Promise<boolean>;
  memberExists(input: {
    readonly userId: string;
    readonly workspaceId: string;
  }): Promise<boolean>;
  resolveUsers(input: {
    readonly userIds: readonly string[];
    readonly workspaceId: string;
  }): Promise<readonly CommentsHttpUser[]>;
}

export interface CommentsHttpEventPort {
  emit(input: {
    readonly workspaceId: string;
    readonly contextType: string;
    readonly contextId: string;
    readonly action: 'created' | 'updated' | 'closed' | 'reopened' | 'deleted';
    readonly key: 'comment_id';
    readonly commentId: string;
    readonly origin: 'rest';
  }): Promise<void> | void;
}

export interface CreateCommentsRouterOptions {
  readonly store: CommentStore;
  readonly events: CommentsHttpEventPort;
  readonly tenant: CommentsTenantPort;
  readonly authz: CommentsAuthzPort;
}
