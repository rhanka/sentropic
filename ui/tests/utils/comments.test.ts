import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetFetchMock, mockFetchJsonOnce } from '../test-setup';
import { API_BASE_URL } from '../../src/lib/config';
import {
  listComments,
  createComment,
  updateComment,
  closeComment,
  reopenComment,
  deleteComment,
  listMentionMembers,
} from '../../src/lib/utils/comments';
import { setUser, clearUser } from '../../src/lib/stores/session';
import { setWorkspaceScope, workspaceScope } from '../../src/lib/stores/workspaceScope';

describe('comments utils', () => {
  beforeEach(() => {
    resetFetchMock();
    clearUser();
    localStorage.clear();
    workspaceScope.set({ loading: false, items: [], selectedId: null, error: null });
  });

  it('lists comments with context filters', async () => {
    mockFetchJsonOnce({ items: [] });

    await listComments({
      contextType: 'usecase',
      contextId: 'uc_1',
      sectionKey: 'description',
      status: 'open',
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`${API_BASE_URL}/comments?`);
    expect(String(url)).toContain('context_type=usecase');
    expect(String(url)).toContain('context_id=uc_1');
    expect(String(url)).toContain('section_key=description');
    expect(String(url)).toContain('status=open');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
  });

  it('creates comments with optional assignment and thread', async () => {
    mockFetchJsonOnce({ id: 'c_1', thread_id: 't_1' });

    await createComment({
      contextType: 'folder',
      contextId: 'f_1',
      sectionKey: 'summary',
      content: 'Hello',
      assignedTo: 'user_1',
      threadId: 't_1',
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/comments`);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body).toEqual({
      context_type: 'folder',
      context_id: 'f_1',
      section_key: 'summary',
      content: 'Hello',
      assigned_to: 'user_1',
      thread_id: 't_1',
    });
  });

  it('updates comment content and assignment', async () => {
    mockFetchJsonOnce({ success: true });

    await updateComment('c_1', { content: 'Updated', assignedTo: 'user_2' });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/comments/c_1`);
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(String(init?.body ?? '{}'));
    expect(body).toEqual({ content: 'Updated', assigned_to: 'user_2' });
  });

  it('closes and reopens comment threads', async () => {
    mockFetchJsonOnce({ success: true });
    await closeComment('c_1');

    let fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/comments/c_1/close`);
    expect(init?.method).toBe('POST');

    resetFetchMock();
    mockFetchJsonOnce({ success: true });
    await reopenComment('c_1');
    fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/comments/c_1/reopen`);
    expect(init?.method).toBe('POST');
  });

  it('deletes comments', async () => {
    mockFetchJsonOnce({ success: true });

    await deleteComment('c_1');

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/comments/c_1`);
    expect(init?.method).toBe('DELETE');
  });

  it('lists mention members without workspace_id query', async () => {
    setUser({ id: 'user-1', email: 'user@example.com', displayName: 'User', role: 'editor' });
    setWorkspaceScope('ws-selected');
    mockFetchJsonOnce({ items: [] });

    await listMentionMembers('ws-target');

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/workspaces/ws-target/members`);
  });

  it('scopes list comments with workspace_id when available', async () => {
    setUser({ id: 'user-1', email: 'user@example.com', displayName: 'User', role: 'editor' });
    setWorkspaceScope('ws-selected');
    mockFetchJsonOnce({ items: [] });

    await listComments({ contextType: 'usecase', contextId: 'uc_2' });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`${API_BASE_URL}/comments?`);
    expect(String(url)).toContain('workspace_id=ws-selected');
  });
});
