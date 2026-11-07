import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertGitAppPermissions, GIT_APP_PERMISSIONS, GitAppError, GitAppAccessLostError } from './contracts.js';
import type { GitAppOwnerRepository, GitInstallationLeasePort, GitWebhookVerificationPort } from './contracts.js';
import type { EnrollmentRecord, GitAppLifecycleInput, GitHubAppApi, RevocationReason } from './records.js';
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
export const invalidateCredentials = async (record: EnrollmentRecord, input: GitAppLifecycleInput) => {
  record.state = 'revoked';
  record.invalidationPending = true;
  try {
    await input.onCredentialsChanged({ storageScopeId: record.target.storageScopeId, repoId: record.target.repoId,
      installationRef: record.installationRef, credentialVersion: record.credentialVersion });
    record.invalidationPending = false;
  } finally { await revokeLeases(record, input.github, input.now()); }
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

export const createGitAppLifecycle = (input: GitAppLifecycleInput) => {
  const { custody, github, now } = input;
  const acquire: GitInstallationLeasePort['acquire'] = (request) => custody.withRecord(request.installationRef, async (record) => {
    assertTuple(record, request);
    if (!['ready', 'unavailable'].includes(record.state) || !record.app || !record.installationId || !record.repositoryId) {
      if (record.state === 'revoked') await invalidateCredentials(record, input);
      throw new GitAppError('capability_unavailable');
    }
    try {
      const installed = await github.inspectInstallation(record.app, record.installationId);
      assertGitAppPermissions(installed.permissions);
      if (installed.suspended) throw new GitAppAccessLostError();
      const minted = await github.mint(record.app, record.installationId, record.repositoryId, GIT_APP_PERMISSIONS);
      record.leases = record.leases.filter((lease) => Date.parse(lease.expiresAt) > now());
      // An invalid expiry is not evidence that the minted bearer is unusable.
      // Retain it for revocation even when the forge claims it already expired.
      const expiresAt = Date.parse(minted.expiresAt);
      record.leases.push({ token: minted.token, expiresAt: Number.isFinite(expiresAt) && expiresAt > now()
        ? minted.expiresAt : new Date(now() + 3600000).toISOString() });
      assertGitAppPermissions(minted.permissions);
      if (!minted.token || minted.repositoryIds.length !== 1 || minted.repositoryIds[0] !== record.repositoryId ||
          !Number.isFinite(Date.parse(minted.expiresAt)) || Date.parse(minted.expiresAt) <= now() + 30000 ||
          Date.parse(minted.expiresAt) > now() + 3600000) {
        await revokeLeases(record, github, now());
        throw new GitAppError('capability_unavailable');
      }
      record.state = 'ready';
      return { token: minted.token, expiresAt: minted.expiresAt, repositoryId: record.repositoryId,
        permissions: { ...GIT_APP_PERMISSIONS }, credentialVersion: record.credentialVersion };
    } catch (error) {
      if (error instanceof GitAppAccessLostError) await invalidateCredentials(record, input);
      else record.state = 'unavailable';
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
    await invalidateCredentials(record, input);
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
        if (installed.suspended) throw new GitAppAccessLostError();
        if (record.state === 'unavailable') record.state = 'ready';
      } catch (error) {
        if (error instanceof GitAppAccessLostError) invalidate = true;
        else {
          if (record.state === 'ready') record.state = 'unavailable';
          throw new GitAppError('capability_unavailable');
        }
      }
    }
    if (invalidate) {
      await invalidateCredentials(record, input);
    }
    return { accepted: true };
  });
  return { acquire, verify, revoke, installationEvent, ...createGitAppRotation(input) };
};
