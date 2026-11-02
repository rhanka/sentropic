import { createHash } from 'node:crypto';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { decryptSecret, SecretEnvelopeError } from '../secret-crypto';
import type { ConnectorCustodyEnvelope } from './cm-connector-envelope';

export const invalidConnectorCustody = (): never => { throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid'); };
export const requireConnectorProvider = (provider: string): void => {
  if (provider !== 'google_drive' && provider !== 'gmail') invalidConnectorCustody();
};
export function readSourceConnectorCapability(source: string | null): Buffer | null {
  if (source === null || source === '') return null;
  try {
    const parsed: unknown = JSON.parse(decryptSecret(source));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalidConnectorCustody();
    const value = parsed as Record<string, unknown>;
    if ((value.refreshToken != null && typeof value.refreshToken !== 'string')
      || (value.accessToken != null && typeof value.accessToken !== 'string')) return invalidConnectorCustody();
    const refresh = typeof value.refreshToken === 'string' ? value.refreshToken : '';
    const access = typeof value.accessToken === 'string' ? value.accessToken : '';
    if (!refresh && !access) return invalidConnectorCustody();
    return Buffer.from(JSON.stringify({ tokenKind: refresh ? 'refresh' : 'access', token: refresh || access }));
  } catch (error) {
    if (error instanceof IdentityCustodyErrorV1) throw error;
    if (error instanceof SecretEnvelopeError && error.reason === 'unsupported_version') {
      throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
    }
    return invalidConnectorCustody();
  }
}
export const validateConnectorCapability = (bytes: Buffer): { tokenKind: 'access' | 'refresh'; token: string } => {
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { return invalidConnectorCustody(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidConnectorCustody();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).join(',') !== 'tokenKind,token' || (record.tokenKind !== 'access' && record.tokenKind !== 'refresh')
    || typeof record.token !== 'string' || !record.token) return invalidConnectorCustody();
  const result: { tokenKind: 'access' | 'refresh'; token: string } = { tokenKind: record.tokenKind, token: record.token };
  const canonical = Buffer.from(JSON.stringify(result));
  try { if (!canonical.equals(bytes)) return invalidConnectorCustody(); }
  finally { canonical.fill(0); }
  return result;
};
export function decodeConnectorEnvelope(row: Record<string, unknown>): ConnectorCustodyEnvelope {
  const text = (key: string): string => { const value = row[key]; return typeof value === 'string' ? value : invalidConnectorCustody(); };
  if (row.envelope_version !== '1') return invalidConnectorCustody();
  const provider = text('provider'); requireConnectorProvider(provider);
  return { custodyRef: text('custody_ref'), deliveryId: text('delivery_id'), connectorAccountId: text('connector_account_id'),
    provider, keyRef: text('key_ref'), envelopeVersion: '1', nonce: text('nonce'), ciphertext: text('ciphertext'),
    authTag: text('auth_tag'), createdAt: text('created_at') };
}

export const connectorCustodyDdl = `CREATE TABLE control.connector_revocation_custody (
  custody_ref text COLLATE "C" PRIMARY KEY, delivery_id text COLLATE "C" NOT NULL UNIQUE,
  connector_account_id text COLLATE "C" NOT NULL, provider text NOT NULL,
  envelope_version text NOT NULL CHECK (envelope_version = '1'), key_ref text NOT NULL,
  nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{16}$'),
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 21846),
  auth_tag text NOT NULL CHECK (auth_tag ~ '^[A-Za-z0-9_-]{22}$'), created_at text NOT NULL
);
CREATE INDEX connector_revocation_custody_key_ref ON control.connector_revocation_custody (key_ref);`;
export const connectorCustodyAssetSha256 = createHash('sha256').update(connectorCustodyDdl).digest('hex');
