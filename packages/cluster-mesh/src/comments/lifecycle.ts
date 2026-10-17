import {
  CanonicalCommandError,
  commandPayloadDigest,
  createLifecycleEvent,
  isLifecycleObjectKind,
  sha256Hex,
} from '@sentropic/comments';
import type { CanonicalLifecycleRequest, LifecycleEventRecord, CommandCapability } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import { emptyEffects } from '../storage/staged-preparation.js';
import type {
  CommentsServiceOptions,
  CommentsLifecycleResult,
  CommentsLifecycleControl,
} from './lifecycle-contracts.js';
import { lifecycleControlKey, purgeControlKey } from './lifecycle-contracts.js';
import { authorizeComments } from './authority.js';
import { installedLifecycleStore } from './installed-store.js';
import {
  appendLifecycleAudit,
  lifecycleResources,
  readLifecycleControl,
  retainedHead,
  writeLifecycleControl,
} from './lifecycle-io.js';
import { commandKey, commentsObjectKey, invalid, sameScope } from './storage-schema.js';
import { retainedCommentsLifecycleBasis } from './lifecycle-evidence.js';
export const executeCommentsLifecycle = async (
  options: CommentsServiceOptions,
  context: PgInstalledContext,
  supplied: unknown,
): Promise<CommentsLifecycleResult> => {
  const request = supplied as CanonicalLifecycleRequest;
  if (
    !request ||
    !sameScope(request.scope, context.grant.scope) ||
    !isLifecycleObjectKind(request.objectKind) ||
    typeof request.objectId !== 'string' ||
    !request.objectId ||
    !['archive', 'restore', 'tombstone', 'purge-intent'].includes(request.action) ||
    typeof request.idempotencyKey !== 'string' ||
    !request.idempotencyKey
  )
    return invalid('invalid operational lifecycle request');
  const target = commentsObjectKey(request.objectKind, request.objectId);
  const digest = commandPayloadDigest(request);
  const control = await readLifecycleControl(context, target);
  const targets = control.value?.targets ?? (await lifecycleResources(context, request));
  const capability: CommandCapability =
    request.action === 'purge-intent'
      ? 'purge'
      : request.action === 'archive'
        ? request.archiveKind === 'personal'
          ? 'personal-archive'
          : 'shared-archive'
        : request.action === 'restore'
          ? 'shared-restore'
          : 'tombstone';
  await authorizeComments(options, context, capability, targets, request);
  const previousCommand = await context.index(commandKey(request.idempotencyKey));
  if (previousCommand) {
    if (previousCommand.digest !== digest)
      throw new CanonicalCommandError('idempotency-conflict', 'Lifecycle command identity changed');
    context.replayed();
    return {
      hash: previousCommand.resultHash!,
      objectKind: request.objectKind,
      objectId: request.objectId,
      action: request.action,
      intentId: previousCommand.resultIds[1] ?? null,
    };
  }
  if (request.action !== 'purge-intent' && !(await context.available(target)))
    throw new CanonicalCommandError('denied', 'Lifecycle object is covered');
  if (control.value?.tombstoned && request.action !== 'purge-intent')
    throw new CanonicalCommandError('denied', 'A tombstone cannot be reversed');
  const selection = { kind: 'lifecycle-events' as const, objectKind: request.objectKind, objectId: request.objectId };
  const previous = await retainedHead<LifecycleEventRecord>(context, selection);
  const basis = await retainedCommentsLifecycleBasis(context, selection, previous);
  const tombstoned = Boolean(control.value?.tombstoned || basis.some((event) => event.action === 'tombstone'));
  if (request.action === 'purge-intent' && (!tombstoned || control.value?.intentId))
    return invalid('purge intent requires an uncompleted tombstone');
  const input = {
    scope: request.scope,
    objectKind: request.objectKind,
    objectId: request.objectId,
    action: request.action,
    archiveKind: request.archiveKind,
    reason: request.reason,
    actor: { principal: context.grant.principalId },
  };
  const store = installedLifecycleStore(context);
  const record = createLifecycleEvent(basis, input, options.capacity);
  await store.appendLifecycleEvent(request.scope, request.objectKind, request.objectId, record, request.expected);
  await appendLifecycleAudit(context, options, target, request);
  let intent = request.action === 'purge-intent' ? record : null;
  const requiredIntent = async () =>
    context.policy === 'required' &&
    context.grant.operations.includes('maintain') &&
    (await options.capabilities.check(context.grant.principalId, 'purge', targets));
  const createIntent = request.action === 'tombstone' && (await requiredIntent());
  if (request.action === 'tombstone')
    context.revalidate(async () => {
      if ((await requiredIntent()) !== createIntent)
        throw new CanonicalCommandError('denied', 'Purge authority changed before tombstone publication');
    });
  if (createIntent) {
    await authorizeComments(options, context, 'purge', targets);
    if (!context.grant.operations.includes('maintain'))
      throw new CanonicalCommandError('denied', 'Purge requires maintenance authority');
    intent = createLifecycleEvent(
      [record],
      { ...input, action: 'purge-intent', archiveKind: null, reason: null },
      options.capacity,
    );
    await store.appendLifecycleEvent(request.scope, request.objectKind, request.objectId, intent, {
      kind: 'revision',
      revisionHash: record.hash,
    });
  }
  if (intent && (context.policy === 'unconfigured' || !context.grant.operations.includes('maintain')))
    throw new CanonicalCommandError('denied', 'Purge is not configured or authorized');
  const intentId = intent ? `comments-purge:${sha256Hex(`${context.stream.incarnation}:${intent.hash}`)}` : null;
  const value: CommentsLifecycleControl = {
    targets,
    tombstoned: Boolean(tombstoned || request.action === 'tombstone'),
    intentId,
    ...(intent
      ? {
          candidate: createLifecycleEvent(
            [intent],
            { ...input, action: 'purge-outcome', archiveKind: null, reason: null },
            options.capacity,
          ),
        }
      : {}),
  };
  await writeLifecycleControl(context, target, control.version, value);
  await context.apply({
    ...emptyEffects(),
    barriers: request.action === 'tombstone' ? [{ boundary: target, reason: 'comments-tombstone' }] : [],
    purgeIntents: intentId ? [{ target, intentId, authorizedBy: context.grant.principalId }] : [],
    indexWrites: [
      {
        key: commandKey(request.idempotencyKey),
        digest,
        resultIds: [request.objectId, ...(intentId ? [intentId] : [])],
        resultHash: record.hash,
      },
      ...(intentId
        ? [
            {
              key: purgeControlKey(intentId),
              digest: intent!.hash,
              resultIds: [lifecycleControlKey(target)],
              resultHash: value.candidate!.hash,
            },
          ]
        : []),
    ],
  });
  return {
    hash: record.hash,
    objectKind: request.objectKind,
    objectId: request.objectId,
    action: request.action,
    intentId,
  };
};
