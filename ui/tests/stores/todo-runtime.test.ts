import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPatch, apiPost } from '../../src/lib/utils/api';
import { API_BASE_URL } from '../../src/lib/config';
import { setUser, clearUser } from '../../src/lib/stores/session';
import { setWorkspaceScope, workspaceScope } from '../../src/lib/stores/workspaceScope';
import { mockFetchJsonOnce, resetFetchMock } from '../test-setup';

describe('todo runtime api flows', () => {
  beforeEach(() => {
    resetFetchMock();
    clearUser();
    localStorage.clear();
    workspaceScope.set({ loading: false, items: [], selectedId: null, error: null });
  });

  it('creates a todo under a plan with scoped workspace query', async () => {
    setUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'editor'
    });
    setWorkspaceScope('ws-rt');
    localStorage.setItem('locale', 'en-US');

    mockFetchJsonOnce({
      todo: {
        id: 'todo_1',
        planId: 'plan_1',
        title: 'Lot 2 runtime',
        derivedStatus: 'todo'
      }
    });

    const result = await apiPost('/plans/plan_1/todos', {
      title: 'Lot 2 runtime',
      description: 'Integrate TODO runtime flow'
    });

    expect(result).toEqual({
      todo: {
        id: 'todo_1',
        planId: 'plan_1',
        title: 'Lot 2 runtime',
        derivedStatus: 'todo'
      }
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/plans/plan_1/todos?workspace_id=ws-rt`);
    expect(init?.method).toBe('POST');

    const headers = init?.headers as Record<string, string>;
    expect(headers['X-App-Locale']).toBe('en');

    const body = JSON.parse(String(init?.body));
    expect(body.title).toBe('Lot 2 runtime');
  });

  it('assigns and closes a todo through runtime endpoints', async () => {
    setUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'editor'
    });
    setWorkspaceScope('ws-rt');

    mockFetchJsonOnce({
      todo: { id: 'todo_1', ownerUserId: 'user-2', derivedStatus: 'planned' }
    });
    mockFetchJsonOnce({
      todo: { id: 'todo_1', closedAt: '2026-02-26T20:00:00.000Z', derivedStatus: 'done' }
    });

    const assigned = await apiPost('/todos/todo_1/assign', { ownerUserId: 'user-2' });
    expect(assigned).toEqual({
      todo: { id: 'todo_1', ownerUserId: 'user-2', derivedStatus: 'planned' }
    });

    const closed = await apiPatch('/todos/todo_1', { closed: true });
    expect(closed).toEqual({
      todo: { id: 'todo_1', closedAt: '2026-02-26T20:00:00.000Z', derivedStatus: 'done' }
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [assignUrl, assignInit] = fetchMock.mock.calls[0];
    const [closeUrl, closeInit] = fetchMock.mock.calls[1];
    expect(String(assignUrl)).toBe(`${API_BASE_URL}/todos/todo_1/assign?workspace_id=ws-rt`);
    expect(assignInit?.method).toBe('POST');
    expect(String(closeUrl)).toBe(`${API_BASE_URL}/todos/todo_1?workspace_id=ws-rt`);
    expect(closeInit?.method).toBe('PATCH');
  });

  it('surfaces ApiError when todo payload is invalid', async () => {
    mockFetchJsonOnce(
      { error: 'Bad Request', message: 'title is required' },
      400
    );

    await expect(
      apiPost('/plans/plan_1/todos', { title: '' })
    ).rejects.toMatchObject<ApiError>({
      status: 400,
      message: 'title is required'
    });
  });
});
