import type { IdentityManagementTransport } from './management-ports.js';

/** Every selector is encoded as data; the current CM domain authorizes each request. */
export function createIdentityManagementTransport(fetch: (path: string, init?: RequestInit) => Promise<Response>): IdentityManagementTransport {
  const request = async <T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(path, { method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error('identity_request_failed');
    return response.status === 204 ? undefined : await response.json();
  };
  const user = (id: string) => `/admin/users/${encodeURIComponent(id)}`;
  const memberships = (tenantId: string) => `/tenants/${encodeURIComponent(tenantId)}/memberships`;
  const members = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/members`;
  return {
    listUsers: status => request(`/admin/users${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    approveUser: (id, role) => request(`${user(id)}/approve`, 'POST', { role }),
    disableUser: id => request(`${user(id)}/disable`, 'POST', {}),
    reactivateUser: id => request(`${user(id)}/reactivate`, 'POST', {}),
    deleteUser: (id, operationId) => request(user(id), 'DELETE', undefined, { 'idempotency-key': operationId }),
    listMemberships: tenantId => request(memberships(tenantId)),
    requestMembership: tenantId => request(memberships(tenantId), 'POST', {}),
    decideMembership: (tenantId, id, decision) => request(`${memberships(tenantId)}/${encodeURIComponent(id)}/${decision}`, 'POST', {}),
    listMembers: workspaceId => request(members(workspaceId)),
    addMember: (workspaceId, email, role) => request(members(workspaceId), 'POST', { email, role }),
    setMemberRole: (workspaceId, id, role) => request(`${members(workspaceId)}/${encodeURIComponent(id)}`, 'PATCH', { role }),
    removeMember: (workspaceId, id) => request(`${members(workspaceId)}/${encodeURIComponent(id)}`, 'DELETE'),
  };
}
