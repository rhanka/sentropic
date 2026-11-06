import { createSign } from 'node:crypto';
import { assertGitAppPermissions, GIT_APP_PERMISSIONS, GitAppError } from './contracts.js';
import type { AppCredential, GitHubAppApi, MintedToken } from './records.js';

export const createGitHubAppApi = (input: {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>; now?: () => number;
} = {}): GitHubAppApi => {
  const fetcher = input.fetch ?? globalThis.fetch;
  const now = input.now ?? Date.now;
  const unavailable = () => new GitAppError('capability_unavailable');
  const jwt = (app: AppCredential): string => {
    try {
      const seconds = Math.floor(now() / 1000);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const message = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: app.appId })}`;
      return `${message}.${createSign('RSA-SHA256').update(message).sign(app.privateKey).toString('base64url')}`;
    } catch { throw unavailable(); }
  };
  const request = async (path: string, method: string, token?: string, body?: unknown) => {
    try {
      const response = await fetcher(`https://api.github.com${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
          'user-agent': 'sentropic-cluster-mesh', ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw unavailable();
      if (response.status === 204) return null;
      return await response.json();
    } catch { throw unavailable(); }
  };
  const numericId = (id: string) => {
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw unavailable();
    return Number(id);
  };
  const revokeToken = async (token: string) => { await request('/installation/token', 'DELETE', token); };
  const mintFor = async (app: AppCredential, installationId: string, selection: object): Promise<MintedToken & { locator: string }> => {
    numericId(installationId);
    const response = await request(`/app/installations/${installationId}/access_tokens`, 'POST', jwt(app),
      { ...selection, permissions: GIT_APP_PERMISSIONS });
    if (typeof response?.token !== 'string' || !response.token) throw unavailable();
    try {
      assertGitAppPermissions(response.permissions ?? {});
      const repositories = await request('/installation/repositories?per_page=100', 'GET', response.token);
      if (repositories?.total_count !== 1 || repositories.repositories?.length !== 1) throw unavailable();
      const repository = repositories.repositories[0];
      const id = String(repository.id);
      numericId(id);
      if (typeof repository.full_name !== 'string') throw unavailable();
      return { token: response.token, expiresAt: response.expires_at, permissions: response.permissions,
        repositoryIds: [id], locator: repository.full_name };
    } catch {
      try { await revokeToken(response.token); } catch { /* Remains unleased and never leaves custody. */ }
      throw unavailable();
    }
  };
  return {
    exchange: async (code) => {
      const data = await request(`/app-manifests/${encodeURIComponent(code)}/conversions`, 'POST');
      const appId = String(data?.id);
      numericId(appId);
      if (!/^[\w-]+$/.test(data?.slug ?? '') || typeof data?.pem !== 'string' || !data.pem ||
          typeof data?.webhook_secret !== 'string' || !data.webhook_secret) throw unavailable();
      return { appId, slug: data.slug, privateKey: data.pem, webhookSecret: data.webhook_secret };
    },
    verifyKey: async (app) => {
      const data = await request('/app', 'GET', jwt(app));
      if (String(data?.id) !== app.appId) throw unavailable();
    },
    inspectInstallation: async (app, installationId) => {
      numericId(installationId);
      const data = await request(`/app/installations/${installationId}`, 'GET', jwt(app));
      if (String(data?.app_id) !== app.appId || String(data?.id) !== installationId) throw unavailable();
      return { permissions: data.permissions ?? {}, suspended: data.suspended_at !== null };
    },
    resolveRepository: async (app, installationId, locator) => {
      const token = await mintFor(app, installationId, { repositories: [locator.split('/')[1]] });
      try {
        if (token.locator.toLowerCase() !== locator.toLowerCase()) throw unavailable();
        return token.repositoryIds[0];
      } finally { await revokeToken(token.token); }
    },
    mint: async (app, installationId, repositoryId, permissions) => {
      assertGitAppPermissions(permissions);
      const token = await mintFor(app, installationId, { repository_ids: [numericId(repositoryId)] });
      if (token.repositoryIds[0] !== repositoryId) {
        await revokeToken(token.token);
        throw unavailable();
      }
      return { token: token.token, expiresAt: token.expiresAt, permissions: token.permissions, repositoryIds: token.repositoryIds };
    },
    updateWebhookSecret: async (app) => { await request('/app/hook/config', 'PATCH', jwt(app), { secret: app.webhookSecret }); },
    revokeToken,
  };
};
