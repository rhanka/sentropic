import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPost } from '../../src/lib/utils/api';
import { API_BASE_URL } from '../../src/lib/config';
import { setUser, clearUser } from '../../src/lib/stores/session';
import { setWorkspaceScope, workspaceScope } from '../../src/lib/stores/workspaceScope';
import { mockFetchJsonOnce, resetFetchMock } from '../test-setup';

describe('todo-api chat client behavior', () => {
  beforeEach(() => {
    resetFetchMock();
    clearUser();
    localStorage.clear();
    workspaceScope.set({ loading: false, items: [], selectedId: null, error: null });
  });

  it('posts chat payload for plan tool with scoped workspace query', async () => {
    setUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'editor'
    });
    setWorkspaceScope('ws-123');
    localStorage.setItem('locale', 'en-US');

    mockFetchJsonOnce({ jobId: 'job-1', streamId: 'stream-1' });

    const payload = {
      message: 'Create a TODO for release hardening',
      tools: ['plan'],
      metadata: {
        todo: {
          title: 'Release hardening',
          tasks: [{ title: 'Run regression suite' }, { title: 'Ship changelog' }]
        }
      }
    };

    const result = await apiPost('/chat/messages', payload);

    expect(result).toEqual({ jobId: 'job-1', streamId: 'stream-1' });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/chat/messages?workspace_id=ws-123`);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');

    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-App-Locale']).toBe('en');

    const body = JSON.parse(String(init?.body));
    expect(body.tools).toContain('plan');
    expect(body.metadata.todo.title).toBe('Release hardening');
    expect(body.metadata.todo.tasks).toHaveLength(2);
  });

  it('keeps explicit workspace_id when chat endpoint already provides one', async () => {
    setUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'editor'
    });
    setWorkspaceScope('ws-123');

    mockFetchJsonOnce({ ok: true });

    await apiPost('/chat/messages?workspace_id=ws-explicit', {
      message: 'Use explicit scope',
      tools: ['plan']
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/chat/messages?workspace_id=ws-explicit`);
  });

  it('surfaces API error message for invalid plan payload', async () => {
    mockFetchJsonOnce(
      { error: 'Bad Request', message: 'plan(action=create): title is required' },
      400
    );

    await expect(
      apiPost('/chat/messages', {
        message: 'Create TODO',
        tools: ['plan'],
        metadata: { todo: { title: '' } }
      })
    ).rejects.toMatchObject<ApiError>({
      status: 400,
      message: 'plan(action=create): title is required'
    });
  });
});
