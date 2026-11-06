import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { assertGitAppPermissions, GIT_APP_PERMISSIONS, GitAppError } from './contracts.js';
import type { GitAppOwnerRepository, GitInstallationLeasePort, GitWebhookVerificationPort } from './contracts.js';
import type { EnrollmentRecord, GitAppCustodian, GitHubAppApi, RevocationReason } from './records.js';
import { createGitAppRotation } from './rotation.js';

export const assertTuple = (record: EnrollmentRecord, input: { storageScopeId: string; repoId: string }) => {
  if (record.target.storageScopeId !== input.storageScopeId || record.target.repoId !== input.repoId) {
    throw new GitAppError('access_denied');
  }
};
export const assertOwner = (record: EnrollmentRecord, input: GitAppOwnerRepository) => {
  assertTuple(record, input);
  if (record.target.ownerId !== input.ownerId || record.target.locator !== input.locator) throw new GitAppError('access_denied');
};
export const publicStatus = (record: EnrollmentRecord) => ({
  installationRef: record.installationRef, webhookSecretRef: record.webhookSecretRef,
  storageScopeId: record.target.storageScopeId, repoId: record.target.repoId,
  state: record.state, credentialVersion: record.credentialVersion,
  webhookRotationPending: record.webhookRotationPending ?? false,
  webhookOverlapEndsAt: record.previousWebhook ? new Date(record.previousWebhook.until).toISOString() : null,
});

export const revokeLeases = async (record: EnrollmentRecord, github: GitHubAppApi, now: number) => {
  const pending = [];
  for (const lease of record.leases) {
    if (Date.parse(lease.expiresAt) <= now) continue;
    try { await github.revokeToken(lease.token); }
    catch { pending.push(lease); }
  }
  record.leases = pending;
  if (pending.length) throw new GitAppError('capability_unavailable');
};
export const webhookMatch = (record: EnrollmentRecord, rawBody: Uint8Array, signature: string, now: number) => {
  if (!record.app || !/^sha256=[a-f0-9]{64}$/.test(signature)) return { valid: false };
  if (record.previousWebhook && now >= record.previousWebhook.until) delete record.previousWebhook;
  const candidates = [{ secret: record.app.webhookSecret, version: record.webhookVersion },
    ...(record.previousWebhook ? [record.previousWebhook] : [])];
  const presented = Buffer.from(signature.slice(7), 'hex');
  for (const candidate of candidates) {
    const expected = createHmac('sha256', candidate.secret).update(rawBody).digest();
    if (timingSafeEqual(expected, presented)) return { valid: true, secretVersion: candidate.version };
  }
  return { valid: false };
};

export const createGitAppLifecycle = (input: { custody: GitAppCustodian; github: GitHubAppApi; now: () => number }) => {
  const { custody, github, now } = input;
  const acquire: GitInstallationLeasePort['acquire'] = (request) => custody.withRecord(request.installationRef, async (record) => {
    assertTuple(record, request);
    if (record.state !== 'ready' || !record.app || !record.installationId || !record.repositoryId) {
      await revokeLeases(record, github, now());
      throw new GitAppError('capability_unavailable');
    }
    try {
      const installed = await github.inspectInstallation(record.app, record.installationId);
      assertGitAppPermissions(installed.permissions);
      if (installed.suspended) throw new GitAppError('capability_unavailable');
      const minted = await github.mint(record.app, record.installationId, record.repositoryId, GIT_APP_PERMISSIONS);
      record.leases = record.leases.filter((lease) => Date.parse(lease.expiresAt) > now());
      record.leases.push({ token: minted.token, expiresAt: minted.expiresAt });
      assertGitAppPermissions(minted.permissions);
      if (!minted.token || minted.repositoryIds.length !== 1 || minted.repositoryIds[0] !== record.repositoryId ||
          !Number.isFinite(Date.parse(minted.expiresAt)) || Date.parse(minted.expiresAt) <= now() + 30000 ||
          Date.parse(minted.expiresAt) > now() + 3600000) throw new GitAppError('capability_unavailable');
      return { token: minted.token, expiresAt: minted.expiresAt, repositoryId: record.repositoryId,
        permissions: { ...GIT_APP_PERMISSIONS }, credentialVersion: record.credentialVersion };
    } catch {
      record.state = 'revoked';
      record.credentialVersion = randomUUID();
      await revokeLeases(record, github, now());
      throw new GitAppError('capability_unavailable');
    }
  });
  const verify: GitWebhookVerificationPort['verify'] = (request) => custody.withRecord(request.webhookSecretRef, async (record) => {
    assertTuple(record, request);
    if (record.webhookSecretRef !== request.webhookSecretRef || !request.deliveryId || record.state !== 'ready') return { valid: false };
    return webhookMatch(record, request.rawBody, request.signature, now());
  });
  const revoke = (target: GitAppOwnerRepository, ref: string, _reason: RevocationReason) => custody.withRecord(ref, async (record) => {
    assertOwner(record, target);
    record.state = 'revoked';
    record.credentialVersion = randomUUID();
    await revokeLeases(record, github, now());
    return publicStatus(record);
  });
  const installationEvent = (ref: string, rawBody: Uint8Array, signature: string, event: string) => custody.withRecord(ref, async (record) => {
    if (!webhookMatch(record, rawBody, signature, now()).valid) throw new GitAppError('access_denied');
    if (event !== 'installation' && event !== 'installation_repositories') throw new GitAppError('invalid_request');
    let payload;
    try { payload = JSON.parse(Buffer.from(rawBody).toString('utf8')); }
    catch { throw new GitAppError('invalid_request'); }
    if (String(payload?.installation?.id) !== record.installationId) throw new GitAppError('access_denied');
    let invalidate = event === 'installation' && ['deleted', 'suspend'].includes(payload.action);
    if (event === 'installation_repositories' && payload.action === 'removed') {
      invalidate = Array.isArray(payload.repositories_removed) &&
        payload.repositories_removed.some((repository: { id: unknown }) => String(repository.id) === record.repositoryId);
    }
    if (event === 'installation' && payload.action === 'new_permissions_accepted') {
      try {
        const installed = await github.inspectInstallation(record.app!, record.installationId!);
        assertGitAppPermissions(installed.permissions);
        invalidate = installed.suspended;
      } catch { invalidate = true; }
    }
    if (invalidate) {
      record.state = 'revoked';
      record.credentialVersion = randomUUID();
      await revokeLeases(record, github, now());
    }
    return { accepted: true };
  });
  return { acquire, verify, revoke, installationEvent, ...createGitAppRotation(input) };
};
