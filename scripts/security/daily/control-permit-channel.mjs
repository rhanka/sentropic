// r6 §4.3.2 / T5-C6 / T6-C3 — watcher/consumer permit channel contract: AF_UNIX socket,
// host watcher UID 62001 and consumer UID 62002, kernel-translated SO_PEERCRED triples,
// ed25519-signed permits valid for at most 5 seconds.
import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';

export const WATCHER_UID = 62001;
export const CONSUMER_UID = 62002;
export const SOCKET_FAMILY = 'AF_UNIX';
export const PERMIT_VALIDITY_S = 5;

export function permitKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function signPermit(privatePem, payload) {
  return edSign(null, Buffer.from(JSON.stringify(payload)), privatePem).toString('base64url');
}

export function permitDigest(payload, signature) {
  return createHash('sha256').update(JSON.stringify(payload) + '.' + signature).digest('hex');
}

// A permit is { channelBinding, consumerUid, issuedAtMs, nonce }; it authorizes exactly
// one consumer on the bound channel for PERMIT_VALIDITY_S seconds.
export function verifyPermit(publicPem, permit, nowMs) {
  if (!permit || typeof permit !== 'object') throw new Error('permit-missing');
  if (typeof permit.signature !== 'string' || typeof permit.payload !== 'object') throw new Error('permit-malformed');
  let ok = false;
  try {
    ok = edVerify(null, Buffer.from(JSON.stringify(permit.payload)), publicPem, Buffer.from(permit.signature, 'base64url'));
  } catch { ok = false; }
  if (!ok) throw new Error('permit-forged');
  if (!Number.isSafeInteger(permit.payload.issuedAtMs) || nowMs - permit.payload.issuedAtMs > PERMIT_VALIDITY_S * 1000) {
    throw new Error('permit-expired');
  }
  if (permit.payload.issuedAtMs - nowMs > 1000) throw new Error('permit-future');
  return permit.payload;
}

// Channel admission: family, distinct fixed UIDs, translated peer triple equal to the
// expected consumer identity, and a valid signed permit. Host-value substitution (a
// translated triple identical to the host triple inside a different namespace) refuses.
export function assertChannel(opts) {
  const { socketFamily, watcherUid, consumerUid, expectedPeer, observedPeer, hostPeer, sameNamespace, permit, publicPem, nowMs } = opts;
  if (socketFamily !== SOCKET_FAMILY) throw new Error('channel-family');
  if (watcherUid !== WATCHER_UID) throw new Error('watcher-uid');
  if (consumerUid !== CONSUMER_UID) throw new Error('consumer-uid');
  if (expectedPeer.uid !== CONSUMER_UID || observedPeer.uid !== CONSUMER_UID) throw new Error('peer-uid-mismatch');
  if (expectedPeer.pid !== observedPeer.pid || expectedPeer.gid !== observedPeer.gid) throw new Error('peer-triple-mismatch');
  if (!sameNamespace && hostPeer && observedPeer.pid === hostPeer.pid && observedPeer.uid === hostPeer.uid && observedPeer.gid === hostPeer.gid) {
    throw new Error('host-value-substitution');
  }
  const payload = verifyPermit(publicPem, permit, nowMs);
  if (payload.consumerUid !== CONSUMER_UID) throw new Error('permit-consumer-mismatch');
  return payload;
}
