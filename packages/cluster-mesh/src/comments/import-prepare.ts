import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex } from '@sentropic/comments';
import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import { stagedFragmentDigest } from '../storage/staged-codec.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { authorizeComments } from './authority.js';
import { commentsImportBindingDigest, validateCommentsImportBinding } from './binding-codec.js';
import { validateCommentsFragment } from './fragment-codec.js';
import { sameScope } from './storage-schema.js';
import { COMMENTS_IMPORT_CONTRACT_DIGEST, appendCommentsKernelCommitment, commentsKernelCommitRoot, startCommentsImportDigests, type CommentsImportState } from './import-state.js';
import { insertCommentsAcknowledgement, insertCommentsImport, readCommentsAcknowledgement, readCommentsImport, writeCommentsImport } from './import-control.js';
import { appendCommentsUnitPayload, commentsImportDataEffects, commentsImportReceiptEffects, verifyCommentsTerminal } from './import-effects.js';
import { CommentsTransportError, type CommentsPrepareImportRequest, type CommentsFragmentAcknowledgement } from './transport-contracts.js';
export const prepareCommentsImport = async (options: CommentsServiceOptions, context: PgInstalledContext, supplied: unknown): Promise<CommentsFragmentAcknowledgement> => {
  const input = supplied as CommentsPrepareImportRequest; const binding = input?.binding; const fragment = input?.fragment;
  validateCommentsImportBinding(binding);
  if (!sameScope(binding.request.scope, context.grant.scope)) throw new CommentsTransportError('denied', 'Import scope is unavailable');
  for (const capability of binding.capabilities) await authorizeComments(options, context, capability, binding.targets);
  validateCommentsFragment(fragment); const bindingDigest = commentsImportBindingDigest(binding);
  const manifest = fragment.manifest;
  if (!sameScope(manifest.scope, binding.request.scope) || manifest.operationId !== binding.operationId || manifest.bindingDigest !== bindingDigest) throw new CommentsTransportError('conflict', 'Fragment import binding differs');
  let state = await readCommentsImport(context, binding.operationId, true);
  if (!state) {
    if (manifest.ordinal !== '0') throw new CommentsTransportError('conflict', 'First fragment ordinal must be zero');
    const begin = { operationKey: `comments-import-v1:${sha256Hex(binding.operationId)}`, inputDigest: bindingDigest, contractDigest: COMMENTS_IMPORT_CONTRACT_DIGEST, sourceBoundary: binding.sourceBoundary, fence: input.fence };
    state = { version: 'comments-preparation-v1', binding, bindingDigest, begin, unit: null, issuedAt: options.clock.now(), rootReference: randomUUID(),
      nextOrdinal: '0', frontier: null, kernelFrontier: null, ...startCommentsImportDigests(binding), root: null, canonical: null, roots: [] } satisfies CommentsImportState;
    if (!Number.isSafeInteger(state.issuedAt) || state.issuedAt < 0) throw new CommentsTransportError('unavailable', 'Import clock is invalid');
    await insertCommentsImport(context, state);
    state.unit = await context.beginStaged(begin);
  }
  if (state.bindingDigest !== bindingDigest || canonicalJson(state.begin.fence) !== canonicalJson(input.fence)) throw new CommentsTransportError('conflict', 'Import preparation binding changed');
  const prior = await readCommentsAcknowledgement(context, binding.operationId, manifest.ordinal);
  if (prior) {
    if (prior.transportDigest !== fragment.digest) throw new CommentsTransportError('conflict', 'Accepted fragment bytes changed');
    context.replayed(); return prior.acknowledgement;
  }
  if (state.root || manifest.ordinal !== state.nextOrdinal || manifest.predecessorHash !== state.frontier) throw new CommentsTransportError('conflict', 'Fragment frontier differs');
  let effects;
  if (manifest.terminal) {
    state.roots = verifyCommentsTerminal(state, fragment);
    effects = await commentsImportReceiptEffects(state, context);
  } else {
    appendCommentsUnitPayload(state, fragment); effects = commentsImportDataEffects(fragment.payload);
  }
  const predecessorHash = state.kernelFrontier;
  const digest = stagedFragmentDigest({ moduleId: 'comments', scope: context.grant.scope, operationId: state.begin.operationKey, contractDigest: state.begin.contractDigest,
    sourceBoundary: state.begin.sourceBoundary, ordinal: manifest.ordinal, predecessorHash }, effects);
  appendCommentsKernelCommitment(state, effects, digest, fragment.digest);
  if (manifest.terminal) state.root = commentsKernelCommitRoot(state);
  const acknowledgement: CommentsFragmentAcknowledgement = { operationId: binding.operationId, ordinal: manifest.ordinal, fragmentDigest: fragment.digest,
    prepared: state.root ? { operationId: binding.operationId, bindingDigest, rootReference: state.rootReference } : null };
  await writeCommentsImport(context, state);
  await insertCommentsAcknowledgement(context, binding.operationId, digest, acknowledgement);
  await context.stageFragment({ unit: state.unit!, ordinal: manifest.ordinal, predecessorHash, fragmentDigest: digest, effects, fence: input.fence });
  context.replayed(); return acknowledgement;
};
