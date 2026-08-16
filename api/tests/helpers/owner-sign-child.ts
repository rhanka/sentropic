// Cross-process child for track-event-owner-signature-port.test.ts's real-race test.
// Runs a SINGLE appendOwnerSignature call in its OWN OS process (not just its own
// Promise/event-loop turn), so two instances spawned concurrently exercise the real
// cross-process Track file-lock (O_EXCL) instead of racing inside one Node event loop.
import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  type AuthenticatedOwnPrincipal,
  type RelayerProvenance,
  type TrackNativeDecisionTarget,
  type TrackOwnerSignatureWrite,
} from '@sentropic/focus';

import { TrackEventOwnerSignaturePort } from '../../src/services/focus/track-event-owner-signature-port';

const [, , eventsPath, workspace, decisionId, idempotencyKey, ownerEmail] = process.argv;

if (!eventsPath || !workspace || !decisionId || !idempotencyKey || !ownerEmail) {
  console.error(
    'owner-sign-child: usage <eventsPath> <workspace> <decisionId> <idempotencyKey> <ownerEmail>',
  );
  process.exit(1);
}

const OWNER: AuthenticatedOwnPrincipal = {
  principalId: 'user-123',
  canonicalIdentity: { issuer: 'https://auth.example.com', subject: `human:${ownerEmail}` },
  authenticatedAt: '2026-08-10T12:00:00.000Z',
};

const RELAYER: RelayerProvenance = {
  transport: 'http',
  relayerId: 'sentropic-api',
  canonicalIdentity: { issuer: 'sentropic-api', subject: 'focus-owner-signature-route' },
};

const target: TrackNativeDecisionTarget = { workspace, decisionId };

const write: TrackOwnerSignatureWrite = {
  contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  target,
  attestation: { attester: OWNER },
  relayer: RELAYER,
  idempotencyKey,
};

new TrackEventOwnerSignaturePort({ eventsPath })
  .appendOwnerSignature(write)
  .then((receipt) => {
    process.stdout.write(JSON.stringify(receipt));
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
