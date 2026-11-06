import { createHash, randomUUID } from 'node:crypto';
import { assertGitAppPermissions, GIT_APP_PERMISSIONS, GitAppError } from './contracts.js';
import type { GitAppOwnerRepository } from './contracts.js';
import type { EnrollmentRecord, GitAppCustodian, GitHubAppApi } from './records.js';
import { createGitAppLifecycle, assertOwner, publicStatus } from './lifecycle.js';

const digest = (state: string) => createHash('sha256').update(state).digest('hex');
const consume = (record: EnrollmentRecord, state: string, phase: string, now: number) => {
  if (record.state !== phase || !state || digest(state) !== record.callbackState || now >= record.callbackExpiresAt) {
    throw new GitAppError('access_denied');
  }
  record.callbackState = '';
};

export const createGitHubAppEnrollment = (input: {
  custody: GitAppCustodian; github: GitHubAppApi; publicBaseUrl: string; now?: () => number;
}) => {
  const now = input.now ?? Date.now;
  const origin = new URL(input.publicBaseUrl);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
    throw new GitAppError('invalid_request');
  }
  const base = origin.origin;
  const lifecycle = createGitAppLifecycle({ ...input, now });
  return {
    ...lifecycle,
    begin: async (target: GitAppOwnerRepository) => {
      if (!target.ownerId || !target.storageScopeId || !target.repoId || !/^[\w.-]+\/[\w.-]+$/.test(target.locator)) {
        throw new GitAppError('invalid_request');
      }
      const installationRef = `enroll_${randomUUID()}`;
      const record: EnrollmentRecord = {
        target: { ...target }, installationRef, webhookSecretRef: installationRef,
        state: 'manifest', callbackState: '', callbackExpiresAt: 0,
        credentialVersion: randomUUID(), webhookVersion: randomUUID(), leases: [],
      };
      await input.custody.create(record);
      return { installationRef, webhookSecretRef: record.webhookSecretRef,
        promptUrl: `${base}/github-app/${installationRef}` };
    },
    prompt: (target: GitAppOwnerRepository, ref: string) => input.custody.withRecord(ref, async (record) => {
      assertOwner(record, target);
      if (record.state !== 'manifest') throw new GitAppError('capability_unavailable');
      const state = randomUUID();
      record.callbackState = digest(state);
      record.callbackExpiresAt = now() + 600000;
      return { state, locator: record.target.locator,
        manifestUrl: `https://github.com/settings/apps/new?state=${state}`,
        manifest: {
          name: `Cluster Mesh ${ref.slice(-12)}`, url: base, public: false,
          redirect_url: `${base}/github-app/${ref}/manifest`,
          setup_url: `${base}/github-app/${ref}/installation`,
          hook_attributes: { url: `${base}/github-app/${ref}/events`, active: true },
          default_permissions: GIT_APP_PERMISSIONS,
          default_events: ['installation', 'installation_repositories'],
        } };
    }),
    convert: (target: GitAppOwnerRepository, ref: string, callback: { state: string; code: string }) =>
      input.custody.withRecord(ref, async (record) => {
        assertOwner(record, target);
        consume(record, callback.state, 'manifest', now());
        if (!callback.code || callback.code.length > 1024) throw new GitAppError('invalid_request');
        const app = await input.github.exchange(callback.code);
        await input.github.verifyKey(app);
        record.app = app;
        record.state = 'install';
        const state = randomUUID();
        record.callbackState = digest(state);
        record.callbackExpiresAt = now() + 600000;
        return { installationUrl: `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new?state=${state}` };
      }),
    install: (target: GitAppOwnerRepository, ref: string, callback: { state: string; installationId: string }) =>
      input.custody.withRecord(ref, async (record) => {
        assertOwner(record, target);
        consume(record, callback.state, 'install', now());
        if (!record.app || !/^[1-9][0-9]*$/.test(callback.installationId)) throw new GitAppError('invalid_request');
        const installed = await input.github.inspectInstallation(record.app, callback.installationId);
        assertGitAppPermissions(installed.permissions);
        if (installed.suspended) throw new GitAppError('capability_unavailable');
        const repositoryId = await input.github.resolveRepository(record.app, callback.installationId, record.target.locator);
        record.installationId = callback.installationId;
        record.repositoryId = repositoryId;
        record.state = 'ready';
        return publicStatus(record);
      }),
    status: (target: GitAppOwnerRepository, ref: string) => input.custody.withRecord(ref, async (record) => {
      assertOwner(record, target);
      return publicStatus(record);
    }),
  };
};

export type GitHubAppEnrollment = ReturnType<typeof createGitHubAppEnrollment>;
