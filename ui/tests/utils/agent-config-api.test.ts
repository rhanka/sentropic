import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, apiPost, apiPut } from '../../src/lib/utils/api';
import { API_BASE_URL } from '../../src/lib/config';
import { setUser, clearUser } from '../../src/lib/stores/session';
import { setWorkspaceScope, workspaceScope } from '../../src/lib/stores/workspaceScope';
import { mockFetchJsonOnce, resetFetchMock } from '../test-setup';

describe('agent-config api client', () => {
  beforeEach(() => {
    resetFetchMock();
    clearUser();
    localStorage.clear();
    workspaceScope.set({ loading: false, items: [], selectedId: null, error: null });
  });

  it('fetches agent config with workspace scope', async () => {
    setUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'editor'
    });
    setWorkspaceScope('ws-21');

    mockFetchJsonOnce({
      items: [{ id: 'agent_1', name: 'Planner', model: 'gpt-4.1-mini', mode: 'linked' }]
    });

    const result = await apiGet('/agent-config');
    expect(result).toEqual({
      items: [{ id: 'agent_1', name: 'Planner', model: 'gpt-4.1-mini', mode: 'linked' }]
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/agent-config?workspace_id=ws-21`);
    expect(init?.method).toBe('GET');
  });

  it('updates agent config with deterministic payload and locale header', async () => {
    setUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'editor'
    });
    setWorkspaceScope('ws-21');
    localStorage.setItem('locale', 'en-US');

    const payload = {
      name: 'Planner v2',
      model: 'gpt-4.1-mini',
      instructions: 'Prioritize TODO orchestration output.',
      capabilities: ['todo_create', 'todo_update']
    };

    mockFetchJsonOnce({ id: 'agent_1', ...payload });

    await apiPut('/agent-config/agent_1', payload);

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/agent-config/agent_1?workspace_id=ws-21`);
    expect(init?.method).toBe('PUT');

    const headers = init?.headers as Record<string, string>;
    expect(headers['X-App-Locale']).toBe('en');

    const body = JSON.parse(String(init?.body));
    expect(body.name).toBe('Planner v2');
    expect(body.capabilities).toEqual(['todo_create', 'todo_update']);
  });

  it('surfaces fork permission errors with ApiError', async () => {
    mockFetchJsonOnce(
      { error: 'Forbidden', message: 'Only admins can fork agent configs' },
      403
    );

    await expect(
      apiPost('/agent-config/agent_1/fork', { name: 'Planner fork' })
    ).rejects.toMatchObject<ApiError>({
      status: 403,
      message: 'Only admins can fork agent configs'
    });
  });
});
