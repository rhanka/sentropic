import { request } from '@playwright/test';
import { waitForMagicLinkToken } from './maildev';

export type IsolatedMember = {
  email: string;
  userId: string;
  displayName: string;
  storageState: {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Lax';
      expires: number;
    }>;
    origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
  };
};

/**
 * Creates a fresh magic-link account and adds it to the workspace.
 *
 * The server clears a user's locks and presence when that user's LAST SSE connection closes
 * (`clearLocksForUser`), across every tab and worker. Lock/presence scenarios therefore must
 * not share seeded accounts with parallel specs or with the previous test of the same file.
 */
export async function createIsolatedMember(options: {
  apiBaseUrl: string;
  ownerStatePath: string;
  workspaceId: string;
  label: string;
  role?: 'editor' | 'viewer' | 'admin';
  folderId?: string;
}): Promise<IsolatedMember> {
  const origin = process.env.UI_BASE_URL || 'http://localhost:5173';
  const email = `e2e-${options.label}-${crypto.randomUUID()}@example.com`;

  const anonymous = await request.newContext({ baseURL: options.apiBaseUrl });
  let sessionToken: string;
  try {
    const requested = await anonymous.post('/api/v1/auth/magic-link/request', { data: { email } });
    if (!requested.ok()) throw new Error(`Isolated login request failed: ${requested.status()}`);
    const token = await waitForMagicLinkToken(email, 60_000);
    const verified = await anonymous.post('/api/v1/auth/magic-link/verify', {
      data: { token },
      headers: { origin },
    });
    if (!verified.ok()) throw new Error(`Isolated login verification failed: ${verified.status()}`);
    sessionToken = (await verified.json()).sessionToken;
    if (!sessionToken) throw new Error('Isolated login did not return a session');
  } finally {
    await anonymous.dispose();
  }

  const owner = await request.newContext({ baseURL: options.apiBaseUrl, storageState: options.ownerStatePath });
  try {
    const added = await owner.post(`/api/v1/workspaces/${options.workspaceId}/members`, {
      data: { email, role: options.role ?? 'editor' },
    });
    if (!added.ok()) throw new Error(`Isolated membership failed: ${added.status()}`);
  } finally {
    await owner.dispose();
  }

  const member = await request.newContext({
    baseURL: options.apiBaseUrl,
    extraHTTPHeaders: { cookie: `session=${sessionToken}` },
  });
  let userId: string;
  let displayName: string;
  try {
    const current = await member.get('/api/v1/auth/session');
    if (!current.ok()) throw new Error(`Isolated session lookup failed: ${current.status()}`);
    const body = await current.json();
    userId = String(body.userId ?? '');
    displayName = String(body.displayName ?? '');
    if (!userId || !displayName) throw new Error('Isolated session has no user id or display name');
  } finally {
    await member.dispose();
  }

  const localStorage = [{ name: 'workspaceScopeId', value: options.workspaceId }];
  if (options.folderId) localStorage.push({ name: 'currentFolderId', value: options.folderId });
  return {
    email,
    userId,
    displayName,
    storageState: {
      cookies: [
        {
          name: 'session',
          value: sessionToken,
          domain: new URL(origin).hostname,
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
          expires: -1,
        },
      ],
      origins: [{ origin, localStorage }],
    },
  };
}
