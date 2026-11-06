import { generateKeyPairSync } from 'node:crypto';
import { createEncryptedGitAppCustodian } from '../../src/forge/custody.js';
import { createGitHubAppEnrollment } from '../../src/forge/enrollment.js';

export const key = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' }).toString();
export const owner = { ownerId: 'owner', storageScopeId: 'immo', repoId: 'repo-immo', locator: 'rhanka/radar-immobilier' };
export const permissions = { contents: 'write', metadata: 'read' } as const;

export const fixture = () => {
  let time = Date.parse('2026-11-05T12:00:00Z');
  const envelopes = new Map<string, string>();
  let tail = Promise.resolve();
  const store = {
    transaction: async <T>(ref: string, action: (sealed: string | null) => Promise<{ sealed: string; result: T }>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const updated = await action(envelopes.get(ref) ?? null);
        envelopes.set(ref, updated.sealed);
        return updated.result;
      } finally { release(); }
    },
  };
  const custody = createEncryptedGitAppCustodian({ store, key: new Uint8Array(32).fill(19) });
  const appKey = key();
  const minted: { repositoryId: string; permissions: Record<string, string> }[] = [];
  const revoked: string[] = [];
  let granted: Record<string, string> = permissions;
  let installed = true;
  let tokenRepos = ['101'];
  const github = {
    exchange: async () => ({ appId: '42', slug: 'test-app', privateKey: appKey, webhookSecret: 'fake-webhook' }),
    inspectInstallation: async () => {
      if (!installed) throw new Error('fake provider detail');
      return { permissions: granted, suspended: false };
    },
    mint: async (_app: unknown, installationId: string, repositoryId: string, requested: Record<string, string>) => {
      if (installationId !== '500') throw new Error('wrong installation');
      minted.push({ repositoryId, permissions: requested });
      return { token: `fake-token-${minted.length}`, expiresAt: new Date(time + 3600000).toISOString(),
        permissions: granted, repositoryIds: tokenRepos };
    },
    resolveRepository: async (_app: unknown, _installationId: string, locator: string) => locator === owner.locator ? '101' : '202',
    verifyKey: async () => undefined,
    updateWebhookSecret: async () => undefined,
    revokeToken: async (token: string) => { revoked.push(token); },
  };
  const service = createGitHubAppEnrollment({ custody, github, publicBaseUrl: 'https://mesh.example', now: () => time });
  const ready = async (target = owner) => {
    const start = await service.begin(target);
    const manifest = await service.prompt(target, start.installationRef);
    const converted = await service.convert(target, start.installationRef, { state: manifest.state, code: 'fake-code' });
    const state = new URL(converted.installationUrl).searchParams.get('state')!;
    await service.install(target, start.installationRef, { state, installationId: '500' });
    return start;
  };
  return { service, ready, envelopes, minted, revoked, appKey,
    advance: (ms: number) => { time += ms; },
    grant: (value: Record<string, string>) => { granted = value; },
    remove: () => { installed = false; },
    tokenRepos: (ids: string[]) => { tokenRepos = ids; } };
};
