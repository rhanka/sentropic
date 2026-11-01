import { canonicalize, sha256Hex } from './canonical-json.mjs';

export const PERMIT_TTL_MS = 5000;
export const CHALLENGE_TIMEOUT_MS = 3000;
export const GET_TIMEOUT_MS = 2000;
export const NONCE_BYTES = 32;
export const MAX_CHALLENGE_BYTES = 4096;
export const MAX_RESPONSE_BYTES = 16384;
export const WATCHER_UID = 62001;
export const CONSUMER_UID = 62002;
export const ELEVATION_STEP = 'launch-security-control-root';
export const ELEVATION_BINARY = 'security-control-launch';
export const GUARDIAN_EXECUTABLE = 'security-control-guardian';

const CHALLENGE_ACTIONS = new Set([
  'deadline-record',
  'health-record',
  'control-receipt',
  'state-intent',
  'collect',
  'admit-scan',
]);
const CHALLENGE_KEYS = new Set([
  'schemaVersion',
  'consumerInstanceId',
  'channelBinding',
  'action',
  'operationId',
  'requestNonce',
  'binding',
]);
const OVERFLOW_ID = 4294967295;

export function channelBinding(ctx) {
  return sha256Hex(
    canonicalize([
      1,
      ctx.hostBootId,
      ctx.watcherInstanceId,
      ctx.consumerInstanceId,
      ctx.targetRepositoryId,
      ctx.workflowSha,
      ctx.runId,
      ctx.runAttempt,
      ctx.jobId,
    ]),
  );
}

export function validateChallenge(ch, ctx) {
  const errors = [];
  if (typeof ch !== 'object' || ch === null) return ['challenge must be an object'];
  for (const key of Object.keys(ch)) {
    if (!CHALLENGE_KEYS.has(key)) errors.push(`extra challenge field ${key}`);
  }
  if (ch.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof ch.consumerInstanceId !== 'string' || ch.consumerInstanceId.length === 0) errors.push('consumerInstanceId is required');
  if (ch.channelBinding !== channelBinding(ctx)) errors.push('channelBinding mismatch');
  if (!CHALLENGE_ACTIONS.has(ch.action)) errors.push(`action ${ch.action} is not admitted`);
  if (typeof ch.operationId !== 'string' || ch.operationId.length === 0) errors.push('operationId is required');
  if (!/^[0-9a-f]{64}$/.test(ch.requestNonce ?? '')) errors.push('requestNonce must be 32 random bytes as lowercase hex');
  if (typeof ch.binding !== 'object' || ch.binding === null) errors.push('binding must be an object');
  if (Buffer.byteLength(JSON.stringify(ch), 'utf8') > MAX_CHALLENGE_BYTES) errors.push('challenge exceeds 4 KiB');
  return errors;
}

export function permitWindow({ readStartedAt, observedAt, issuedAt }) {
  return {
    notBefore: issuedAt,
    expiresAt: readStartedAt + PERMIT_TTL_MS,
    liveAt: (now) => now >= issuedAt && now < readStartedAt + PERMIT_TTL_MS,
  };
}

export function issuePermit(input) {
  if (input.consumerHasSigningKey) throw new Error('consumer must never hold a signing key');
  if (input.getResult !== true) throw new Error('permit requires a fresh literal-true GET');
  if (input.policyGeneration !== input.admittedGeneration) throw new Error('policy generation drift refuses');
  if (!(input.readStartedAt <= input.observedAt && input.observedAt <= input.issuedAt)) {
    throw new Error('readStartedAt <= observedAt <= issuedAt is required');
  }
  if (JSON.stringify(input.tuple) !== JSON.stringify(input.expectedTuple)) throw new Error('tuple mismatch refuses');
  const window = permitWindow(input);
  return {
    notBefore: window.notBefore,
    expiresAt: window.expiresAt,
    nonce: input.nonce,
    tuple: input.tuple,
  };
}

export function validatePermitUse(permit, { now, nonce, usedNonces, keepalive }) {
  const errors = [];
  if (keepalive) errors.push('keepalive cannot authorize a send');
  if (nonce !== permit.nonce) errors.push('nonce mismatch');
  if ((usedNonces ?? []).includes(nonce)) errors.push('nonce reuse refuses');
  if (!(now >= permit.notBefore && now < permit.expiresAt)) errors.push('permit outside its five-second window');
  return errors;
}

function identityErrors(label, identity) {
  const errors = [];
  if (!identity || typeof identity.pid !== 'number' || typeof identity.uid !== 'number') return [`${label} needs a numeric pid and uid`];
  if (identity.uid === OVERFLOW_ID || identity.uid < 0) errors.push(`${label} overflows or is unmapped`);
  return errors;
}

export function validatePlacementReceipt(r) {
  const errors = [];
  for (const field of ['repositoryId', 'workflow', 'runId', 'runAttempt', 'job', 'environment', 'controlDigest', 'hostBootId']) {
    if (r[field] === undefined) errors.push(`missing ${field}`);
  }
  errors.push(...identityErrors('launcher', r.launcher));
  errors.push(...identityErrors('watcher', r.watcher));
  errors.push(...identityErrors('consumer', r.consumer));
  if (r.watcher?.uid === r.consumer?.uid) errors.push('watcher and consumer must be distinct UIDs');
  if (r.watcher?.uid !== WATCHER_UID || r.consumer?.uid !== CONSUMER_UID) {
    errors.push(`expected watcher ${WATCHER_UID} and consumer ${CONSUMER_UID}`);
  }
  const namespaces = r.namespaces ?? {};
  if (namespaces.watcher === namespaces.consumer) errors.push('watcher and consumer need separate namespaces');
  const peers = r.peers ?? {};
  for (const side of ['watcherSide', 'consumerSide']) {
    const peer = peers[side] ?? {};
    if (peer.uid === OVERFLOW_ID || peer.uid === undefined) errors.push(`${side} overflows or is unmapped`);
  }
  if (peers.watcherSide && peers.consumerSide && JSON.stringify(peers.watcherSide) === JSON.stringify(peers.consumerSide)) {
    errors.push('equal peer identity refuses');
  }
  if (r.socket?.creatorUid === 0) errors.push('root-created listener refuses');
  if (!r.socket?.path || typeof r.socket?.inode !== 'number') errors.push('socket path and inode are required');
  if (r.peerVerification !== 'matched') errors.push('peer verification must match');
  if (typeof r.channelBinding !== 'string' || r.channelBinding.length === 0) errors.push('channelBinding is required');
  return errors;
}

export function validateGuardianReceipt(g) {
  const errors = [];
  if (g.executable !== GUARDIAN_EXECUTABLE) errors.push(`guardian executable must be ${GUARDIAN_EXECUTABLE}`);
  if (typeof g.configDigest !== 'string' || g.configDigest.length < 16) errors.push('guardian config digest is required');
  if (typeof g.processId !== 'number') errors.push('guardian process identity is required');
  if (!Array.isArray(g.watchedGroups) || g.watchedGroups.length === 0) errors.push('watched process groups are required');
  if (typeof g.livenessFd !== 'number' || g.livenessFd <= 0) errors.push('liveness FD is required');
  if (typeof g.clockSource !== 'string' || typeof g.clockEpoch !== 'number') errors.push('clock source and epoch are required');
  for (const behavior of ['kill', 'eof', 'pause', 'restart']) {
    if (!g.behaviors?.[behavior]) errors.push(`guardian ${behavior} behavior must be observed`);
  }
  return errors;
}
