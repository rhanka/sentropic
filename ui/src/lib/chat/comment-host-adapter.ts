/**
 * comment-host-adapter.ts
 *
 * Sentropic implementation of CommentHost.
 * Wires REST utils, RBAC stores, i18n, and streamHub into the generic
 * CommentHost interface from @sentropic/chat-ui/comments.
 *
 * SECTION_LABEL_KEYS and CommentContextType stay here (domain-specific).
 * Zero domain strings in the package.
 */

import type { CommentHost } from '@sentropic/chat-ui/comments';
import {
  listComments,
  createComment,
  updateComment,
  closeComment,
  reopenComment,
  deleteComment,
  listMentionMembers,
  type CommentItem,
} from '$lib/utils/comments';
import {
  workspaceCanComment,
  selectedWorkspaceRole,
  getScopedWorkspaceIdForUser,
} from '$lib/stores/workspaceScope';
import { session } from '$lib/stores/session';
import { streamHub } from '$lib/stores/streamHub';
import { get } from 'svelte/store';

// ---------------------------------------------------------------------------
// Domain: section label keys (app-side, never in the package)
// ---------------------------------------------------------------------------

const SECTION_LABEL_KEYS: Record<string, Record<string, string>> = {
  usecase: {
    name: 'common.name',
    description: 'chat.sections.usecase.description',
    problem: 'chat.sections.usecase.problem',
    solution: 'chat.sections.usecase.solution',
    benefits: 'chat.sections.usecase.benefits',
    constraints: 'chat.sections.usecase.constraints',
    risks: 'chat.sections.usecase.risks',
    metrics: 'chat.sections.usecase.metrics',
    nextSteps: 'chat.sections.usecase.nextSteps',
    technologies: 'chat.sections.usecase.technologies',
    dataSources: 'chat.sections.usecase.dataSources',
    dataObjects: 'chat.sections.usecase.dataObjects',
    valueScores: 'chat.sections.usecase.valueScores',
    complexityScores: 'chat.sections.usecase.complexityScores',
    references: 'chat.sections.usecase.references',
    contact: 'chat.sections.usecase.contact',
    domain: 'chat.sections.usecase.domain',
    deadline: 'chat.sections.usecase.deadline',
  },
  organization: {
    name: 'common.name',
    industry: 'organization.fields.industry',
    size: 'chat.sections.organization.size',
    technologies: 'chat.sections.organization.technologies',
    products: 'chat.sections.organization.products',
    processes: 'chat.sections.organization.processes',
    kpis: 'chat.sections.organization.kpis',
    challenges: 'chat.sections.organization.challenges',
    objectives: 'chat.sections.organization.objectives',
    references: 'chat.sections.organization.references',
  },
  folder: {
    description: 'chat.sections.folder.description',
    name: 'chat.sections.folder.name',
  },
  executive_summary: {
    name: 'chat.sections.folder.name',
    introduction: 'chat.sections.executiveSummary.introduction',
    analyse: 'chat.sections.executiveSummary.analysis',
    analysis: 'chat.sections.executiveSummary.analysis',
    recommandation: 'chat.sections.executiveSummary.recommendations',
    recommendations: 'chat.sections.executiveSummary.recommendations',
    synthese_executive: 'chat.sections.executiveSummary.summary',
    synthese: 'chat.sections.executiveSummary.summary',
    summary: 'chat.sections.executiveSummary.summary',
    references: 'chat.sections.executiveSummary.references',
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a sentropic-wired CommentHost.
 *
 * @param translate — the svelte-i18n $_ function, provided by the mounting component.
 */
export function createSentropicCommentHost(
  translate: (key: string) => string,
): CommentHost {
  return {
    async listComments(params) {
      return listComments({
        contextType: params.contextType as any,
        contextId: params.contextId,
        sectionKey: params.sectionKey,
      });
    },

    async createComment(params) {
      return createComment({
        contextType: params.contextType as any,
        contextId: params.contextId,
        sectionKey: params.sectionKey,
        content: params.content,
        assignedTo: params.assignedTo,
        threadId: params.threadId,
      });
    },

    async updateComment(id, params) {
      return updateComment(id, { content: params.content, assignedTo: params.assignedTo });
    },

    async closeComment(id) {
      return closeComment(id);
    },

    async reopenComment(id) {
      return reopenComment(id);
    },

    async deleteComment(id) {
      return deleteComment(id);
    },

    async listMentionMembers() {
      const workspaceId = getScopedWorkspaceIdForUser();
      if (!workspaceId) return { items: [] };
      return listMentionMembers(workspaceId);
    },

    canComment() {
      return get(workspaceCanComment);
    },

    canResolve(comment: CommentItem) {
      const user = get(session).user;
      const role = get(selectedWorkspaceRole);
      if (!user) return false;
      const byId = user.id && comment.created_by === user.id;
      const byEmail = user.email && comment.created_by === user.email;
      return Boolean(byId || byEmail || role === 'admin');
    },

    resolveSectionLabel(type, key) {
      if (!type) return null;
      if (!key) return translate('common.general');
      const i18nKey = SECTION_LABEL_KEYS[type]?.[key];
      return i18nKey ? translate(i18nKey) : key;
    },

    currentUser() {
      const user = get(session).user;
      if (!user) return null;
      return {
        id: user.id ?? null,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
      };
    },

    subscribeCommentUpdates(contextType, contextId, cb) {
      const hubKey = `commentThreads:${Math.random().toString(36).slice(2)}`;
      streamHub.set(hubKey, (evt: any) => {
        if (evt?.type !== 'comment_update') return;
        if (evt.contextType !== contextType || evt.contextId !== contextId) return;
        cb();
      });
      return () => {
        streamHub.delete(hubKey);
      };
    },

    confirmDelete(message) {
      return typeof window !== 'undefined' ? confirm(message) : false;
    },
  };
}
