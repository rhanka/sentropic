import { identityCustodySchemaAssetV1 } from '@sentropic/cluster-mesh';
import { env } from '../../config/env';
import { resolveSessionTokenSecret } from '../../routes/auth/oauth';
import { resolveEmailVerificationTokenSecret } from '../email-verification';
import { getWebAuthnConfig } from '../webauthn-config';
import { loadCmCutoverCheckpoint } from './cm-cutover-checkpoint';
import { connectorCustodyAssetSha256 } from './cm-connector-custody-values';
import { a4MappingAssetSha256 } from './cm-import-manifest';
import { loadA4RemoteSnapshot } from './cm-import-remote-snapshot';
import { createCmTokenCustodian } from './cm-token-custodian';

export const A4_CONTROL_MIGRATION_TIMESTAMP = 1793577600000;
export const A4_IDENTITY_MIGRATION_ID = '0014_app_cm_identity_cutover';

/** Resolve immutable verifier/key configuration and checkpoint files before BEGIN. */
export async function loadAppCmCutoverConfiguration() {
  const rp = getWebAuthnConfig();
  const verifier = { rpId: rp.rpID, origins: typeof rp.origin === 'string' ? [rp.origin] : [...rp.origin] };
  const identityAsset = identityCustodySchemaAssetV1('postgres');
  const mappingSha256 = a4MappingAssetSha256(verifier);
  const checkpoint = await loadCmCutoverCheckpoint(process.env.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE, {
    mappingSha256, identityAssetSha256: identityAsset.assetSha256, connectorAssetSha256: connectorCustodyAssetSha256,
  });
  const remoteSnapshot = await loadA4RemoteSnapshot(checkpoint.remoteSnapshotPath);
  const sessionKey = new TextEncoder().encode(resolveSessionTokenSecret());
  const ticketKey = new TextEncoder().encode(resolveEmailVerificationTokenSecret());
  let tokens: ReturnType<typeof createCmTokenCustodian>;
  try { tokens = createCmTokenCustodian({ sessionKey, ticketKey, emailCodeKeys: new Map() }); }
  finally { sessionKey.fill(0); ticketKey.fill(0); }
  return { checkpoint, remoteSnapshot, verifier, identityAsset, tokens, mappingSha256,
    sourceKeyState: env.SECRET_ENCRYPTION_KEY ? 'configured-v1' : 'legacy-literal-v1',
    dispose() { tokens.dispose(); } };
}
export type AppCmCutoverConfiguration = Awaited<ReturnType<typeof loadAppCmCutoverConfiguration>>;
