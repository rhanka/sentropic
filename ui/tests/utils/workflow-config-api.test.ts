import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, apiPost, apiPut } from '../../src/lib/utils/api';
import { API_BASE_URL } from '../../src/lib/config';
import { setUser, clearUser } from '../../src/lib/stores/session';
import { setWorkspaceScope, workspaceScope } from '../../src/lib/stores/workspaceScope';
import { mockFetchJsonOnce, resetFetchMock } from '../test-setup';

describe('workflow-config api client', () => {
  beforeEach(() => {
    resetFetchMock();
    clearUser();
    localStorage.clear();
    workspaceScope.set({ loading: false, items: [], selectedId: null, error: null });
  });

  it('fetches workflow config with workspace scope', async () => {
    setUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'editor'
    });
    setWorkspaceScope('ws-42');

    mockFetchJsonOnce({ items: [{ id: 'wf_1', name: 'Default workflow' }] });

    const result = await apiGet('/workflow-config');
    expect(result).toEqual({ items: [{ id: 'wf_1', name: 'Default workflow' }] });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/workflow-config?workspace_id=ws-42`);
    expect(init?.method).toBe('GET');
  });

  it('updates workflow config with deterministic payload', async () => {
    setUser({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'User',
      role: 'editor'
    });
    setWorkspaceScope('ws-42');
    localStorage.setItem('locale', 'en-US');

    mockFetchJsonOnce({ id: 'wf_1', name: 'Workflow v2' });

    const payload = {
      name: 'Workflow v2',
      description: 'Includes TODO orchestration',
      ioSchema: {
        input: { type: 'object', properties: { topic: { type: 'string' } } },
        output: { type: 'object', properties: { summary: { type: 'string' } } }
      }
    };

    await apiPut('/workflow-config/wf_1', payload);

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE_URL}/workflow-config/wf_1?workspace_id=ws-42`);
    expect(init?.method).toBe('PUT');

    const headers = init?.headers as Record<string, string>;
    expect(headers['X-App-Locale']).toBe('en');

    const body = JSON.parse(String(init?.body));
    expect(body.name).toBe('Workflow v2');
    expect(body.ioSchema.input.properties.topic.type).toBe('string');
  });

  it('surfaces fork permission errors with ApiError', async () => {
    mockFetchJsonOnce(
      { error: 'Forbidden', message: 'Only editors can fork workflow configs' },
      403
    );

    await expect(
      apiPost('/workflow-config/wf_1/fork', { name: 'Workflow fork' })
    ).rejects.toMatchObject<ApiError>({
      status: 403,
      message: 'Only editors can fork workflow configs'
    });
  });
});
