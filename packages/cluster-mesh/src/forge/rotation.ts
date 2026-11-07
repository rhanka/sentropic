import { createPrivateKey, randomUUID } from 'node:crypto';
import { GitAppError } from './contracts.js';
import type { GitAppOwnerRepository } from './contracts.js';
import type { GitAppLifecycleInput } from './records.js';
import { assertOwner, publicStatus, invalidateCredentials } from './lifecycle.js';

export const createGitAppRotation = (input: GitAppLifecycleInput) => {
  const { custody, github, now } = input;
  return ({
  rotateAppKey: (target: GitAppOwnerRepository, ref: string, privateKey: string) => custody.withRecord(ref, async (record) => {
    assertOwner(record, target);
    if (!record.app || record.state !== 'ready') throw new GitAppError('capability_unavailable');
    try {
      const key = createPrivateKey(privateKey);
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    } catch { throw new GitAppError('invalid_request'); }
    const replacement = { ...record.app, privateKey };
    await github.verifyKey(replacement);
    record.app = replacement;
    await invalidateCredentials(record, input);
    record.credentialVersion = randomUUID();
    record.state = 'ready';
    return publicStatus(record);
  }),
  rotateWebhook: (target: GitAppOwnerRepository, ref: string, secret: string, overlapMs: number) => custody.withRecord(ref, async (record) => {
    assertOwner(record, target);
    if (!record.app || record.state !== 'ready') throw new GitAppError('capability_unavailable');
    if (!secret || secret.length > 4096 || !Number.isSafeInteger(overlapMs) || overlapMs < 1000 || overlapMs > 3600000) {
      throw new GitAppError('invalid_request');
    }
    if (record.app.webhookSecret !== secret) {
      if (record.previousWebhook && now() < record.previousWebhook.until) throw new GitAppError('invalid_request');
      record.previousWebhook = { secret: record.app.webhookSecret, version: record.webhookVersion, until: now() + overlapMs };
      record.app.webhookSecret = secret;
      record.webhookVersion = randomUUID();
    }
    record.webhookRotationPending = true;
    return { ...publicStatus(record), overlapEndsAt: new Date(record.previousWebhook?.until ?? now()).toISOString() };
  }),
  switchWebhookSender: (target: GitAppOwnerRepository, ref: string) => custody.withRecord(ref, async (record) => {
    assertOwner(record, target);
    if (!record.app || record.state !== 'ready' || !record.webhookRotationPending) throw new GitAppError('capability_unavailable');
    await github.updateWebhookSecret(record.app);
    record.webhookRotationPending = false;
    return publicStatus(record);
  }),
  retirePreviousWebhook: (target: GitAppOwnerRepository, ref: string) => custody.withRecord(ref, async (record) => {
    assertOwner(record, target);
    if (record.webhookRotationPending || (record.previousWebhook && now() < record.previousWebhook.until)) {
      throw new GitAppError('invalid_request');
    }
    delete record.previousWebhook;
    return publicStatus(record);
  }),
  });
};
