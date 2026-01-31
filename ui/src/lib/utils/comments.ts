import { apiDelete, apiGet, apiPatch, apiPost } from '$lib/utils/api';

export type CommentContextType = 'organization' | 'folder' | 'usecase' | 'matrix' | 'executive_summary';
export type CommentStatus = 'open' | 'closed';

export type CommentUser = {
  id: string;
  email: string | null;
  displayName: string | null;
};

export type CommentItem = {
  id: string;
  context_type: CommentContextType;
  context_id: string;
  section_key: string | null;
  created_by: string;
  assigned_to: string | null;
  status: CommentStatus;
  thread_id: string;
  content: string;
  created_at: string;
  updated_at: string | null;
  created_by_user: CommentUser | null;
  assigned_to_user: CommentUser | null;
};

export type MentionMember = {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: 'viewer' | 'commenter' | 'editor' | 'admin';
};

export async function listComments(params: {
  contextType: CommentContextType;
  contextId: string;
  sectionKey?: string | null;
  status?: CommentStatus;
}): Promise<{ items: CommentItem[] }> {
  const search = new URLSearchParams();
  search.set('context_type', params.contextType);
  search.set('context_id', params.contextId);
  if (params.sectionKey) search.set('section_key', params.sectionKey);
  if (params.status) search.set('status', params.status);
  return apiGet(`/comments?${search.toString()}`);
}

export async function createComment(params: {
  contextType: CommentContextType;
  contextId: string;
  sectionKey?: string | null;
  content: string;
  assignedTo?: string | null;
  threadId?: string | null;
}): Promise<{ id: string; thread_id: string }> {
  return apiPost('/comments', {
    context_type: params.contextType,
    context_id: params.contextId,
    section_key: params.sectionKey || undefined,
    content: params.content,
    assigned_to: params.assignedTo ?? undefined,
    thread_id: params.threadId ?? undefined,
  });
}

export async function updateComment(
  id: string,
  params: { content?: string; assignedTo?: string | null }
): Promise<{ success: boolean }> {
  return apiPatch(`/comments/${id}`, {
    content: params.content,
    assigned_to: params.assignedTo ?? undefined,
  });
}

export async function closeComment(id: string): Promise<{ success: boolean }> {
  return apiPost(`/comments/${id}/close`);
}

export async function reopenComment(id: string): Promise<{ success: boolean }> {
  return apiPost(`/comments/${id}/reopen`);
}

export async function deleteComment(id: string): Promise<{ success: boolean }> {
  return apiDelete(`/comments/${id}`);
}

export async function listMentionMembers(workspaceId: string): Promise<{ items: MentionMember[] }> {
  return apiGet(`/workspaces/${workspaceId}/members`);
}
