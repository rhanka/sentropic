// Host connector revocation custody: the new host-owned encrypted copy of the
// minimal revocation capability, referenced by opaque custodyRef only. CM
// identity/outbox rows never carry tokens or envelopes. Envelope v1 uses
// AES-256-GCM with a dedicated HKDF-derived key, canonical AAD and immediate
// erase-on-acknowledgement in the same transaction as the outbox ack.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ConnectorRevocationCaptureV1,
  ConnectorRevocationCustodyReferenceV1,
  IdentityExternalRevocationV1,
  IdentityRevocationClaimV1,
} from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';
import type { CustodyOpHost } from '../storage/identity/custody-host.js';
import type { SqliteConnection } from '../storage/sqlite/connection.js';
import type { PgSession, SqlValue } from '../storage/postgres/protocol.js';

export const CONNECTOR_CUSTODY_KEY_REF_V1 = 'secret-crypto:v1';
const HKDF_SALT = 'sentropic-secret-custody-v1';
const HKDF_INFO = 'A2.0b/connector-revocation/v1';
const ENVELOPE_VERSION = '1';

export const deriveConnectorCustodyKeyV1 = (masterKey: Uint8Array): Uint8Array => {
  if (masterKey.byteLength !== 32) throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  const derived = hkdfSync('sha256', Buffer.from(masterKey), HKDF_SALT, HKDF_INFO, 32);
  return new Uint8Array(derived);
};

const aadBytesV1 = (input: { readonly custodyRef: string; readonly deliveryId: string; readonly connectorAccountId: string; readonly provider: string; readonly keyRef: string }): Uint8Array =>
  Buffer.from(JSON.stringify(['A2.0b-connector-custody', '1', input.custodyRef, input.deliveryId, input.connectorAccountId, input.provider, input.keyRef]), 'utf8');

const decodeLength = (value: string, expectedBytes: number | null): Uint8Array => {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  }
  if (decoded.toString('base64url') !== value) throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  if (expectedBytes !== null && decoded.byteLength !== expectedBytes) {
    throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  }
  return decoded;
};

export interface ConnectorCapabilityV1 {
  readonly tokenKind: 'access' | 'refresh';
  readonly token: string;
}

const encodeCapability = (capability: ConnectorCapabilityV1): Uint8Array => {
  if ((capability.tokenKind !== 'access' && capability.tokenKind !== 'refresh') || capability.token.length === 0 || capability.token.length > 4096) {
    throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  }
  return Buffer.from(JSON.stringify({ tokenKind: capability.tokenKind, token: capability.token }), 'utf8');
};

const decodeCapability = (plaintext: Uint8Array): ConnectorCapabilityV1 => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(plaintext).toString('utf8'));
  } catch {
    throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length !== 2 || keys[0] !== 'tokenKind' || keys[1] !== 'token') {
    throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  }
  const record = parsed as { readonly tokenKind?: unknown; readonly token?: unknown };
  if ((record.tokenKind !== 'access' && record.tokenKind !== 'refresh') || typeof record.token !== 'string' || record.token.length === 0) {
    throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  }
  return { tokenKind: record.tokenKind, token: record.token };
};

export interface SealedCapabilityV1 {
  readonly custodyRef: string;
  readonly keyRef: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

export const sealConnectorCapabilityV1 = (input: {
  readonly key: Uint8Array;
  readonly keyRef: string;
  readonly custodyRef: string;
  readonly deliveryId: string;
  readonly connectorAccountId: string;
  readonly provider: string;
  readonly capability: ConnectorCapabilityV1;
}): SealedCapabilityV1 => {
  const plaintext = encodeCapability(input.capability);
  const nonce = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(input.key), nonce);
    cipher.setAAD(aadBytesV1(input));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    if (ciphertext.byteLength === 0 || ciphertext.byteLength > 4096) {
      throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
    }
    return {
      custodyRef: input.custodyRef,
      keyRef: input.keyRef,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      authTag: authTag.toString('base64url'),
    };
  } finally {
    plaintext.fill(0);
    nonce.fill(0);
  }
};

export const openConnectorCapabilityV1 = (input: {
  readonly key: Uint8Array;
  readonly keyRef: string;
  readonly custodyRef: string;
  readonly deliveryId: string;
  readonly connectorAccountId: string;
  readonly provider: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
}): ConnectorCapabilityV1 => {
  const nonce = decodeLength(input.nonce, 12);
  const authTag = decodeLength(input.authTag, 16);
  const ciphertext = decodeLength(input.ciphertext, null);
  if (ciphertext.byteLength === 0 || ciphertext.byteLength > 4096) {
    throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
  }
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(input.key), Buffer.from(nonce));
  decipher.setAAD(aadBytesV1(input));
  decipher.setAuthTag(Buffer.from(authTag));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
  try {
    return decodeCapability(new Uint8Array(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength));
  } finally {
    plaintext.fill(0);
    nonce.fill(0);
    (authTag as Uint8Array).fill(0);
    (ciphertext as Uint8Array).fill(0);
  }
};

/** Raw profile access for the custodian: one live transaction handle. */
export interface ConnectorCustodyRaw {
  readonly profile: 'postgres' | 'sqlite';
  readonly schema: string;
  readonly session: PgSession | null;
  readonly connection: SqliteConnection | null;
}

interface CustodyRow {
  readonly custodyRef: string;
  readonly deliveryId: string;
  readonly connectorAccountId: string;
  readonly provider: string;
  readonly keyRef: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

const custodyTableOf = (raw: ConnectorCustodyRaw): string =>
  raw.profile === 'postgres' ? `"${raw.schema}"."connector_revocation_custody"` : '"connector_revocation_custody"';

const pgExec = async (raw: ConnectorCustodyRaw, text: string, values: readonly SqlValue[]): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number }> => {
  if (!raw.session) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  const result = await raw.session.execute({ text, values });
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
};

const sqliteExec = (raw: ConnectorCustodyRaw, text: string, values: readonly (string | number | null)[]): { readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number } => {
  if (!raw.connection) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  const upper = text.trimStart().slice(0, 6).toUpperCase();
  if (upper === 'SELECT') {
    return { rows: raw.connection.prepare(text).all(...values) as readonly Record<string, unknown>[], rowCount: 0 };
  }
  const result = raw.connection.prepare(text).run(...values) as { changes: number | bigint };
  return { rows: [], rowCount: Number(result.changes) };
};

/** Test/production custodian factory. The custodian owns one internal copy of
 * the derived key; `dispose()` zeroes it. Provider delivery is bound
 * separately and never sees the key. */
export const createNodeConnectorCustody = (input: {
  readonly keyRef?: string;
  readonly masterKey: Uint8Array;
  readonly disposeMasterCopy?: boolean;
}): {
  readonly keyRef: string;
  dispose(): void;
  capture(captureInput: {
    readonly deliveryId: string;
    readonly connectorAccountId: string;
    readonly provider: string;
    readonly at: string;
  }, raw: ConnectorCustodyRaw, source: ConnectorCapabilityV1 | null): Promise<ConnectorRevocationCaptureV1>;
  assertCaptured(record: IdentityExternalRevocationV1, raw: ConnectorCustodyRaw): Promise<void>;
  eraseAcknowledged(record: IdentityExternalRevocationV1, raw: ConnectorCustodyRaw): Promise<void>;
} => {
  const keyRef = input.keyRef ?? CONNECTOR_CUSTODY_KEY_REF_V1;
  const masterCopy = new Uint8Array(input.masterKey);
  if (input.disposeMasterCopy === true) input.masterKey.fill(0);
  let key: Uint8Array | null = deriveConnectorCustodyKeyV1(masterCopy);
  masterCopy.fill(0);

  const activeKey = (): Uint8Array => {
    if (!key) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
    return key;
  };

  const findByDelivery = async (deliveryId: string, raw: ConnectorCustodyRaw): Promise<CustodyRow | null> => {
    const table = custodyTableOf(raw);
    const result = raw.profile === 'postgres'
      ? await pgExec(raw, `SELECT * FROM ${table} WHERE "delivery_id" = $1`, [deliveryId])
      : sqliteExec(raw, `SELECT * FROM ${table} WHERE "delivery_id" = ?`, [deliveryId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      custodyRef: String(row['custody_ref']),
      deliveryId: String(row['delivery_id']),
      connectorAccountId: String(row['connector_account_id']),
      provider: String(row['provider']),
      keyRef: String(row['key_ref']),
      nonce: String(row['nonce']),
      ciphertext: String(row['ciphertext']),
      authTag: String(row['auth_tag']),
    };
  };

  return {
    keyRef,
    dispose: (): void => {
      if (key) {
        key.fill(0);
        key = null;
      }
    },
    capture: async (captureInput, raw, source) => {
      if (source === null) return { kind: 'no_capability' };
      const custodyRef = `cc-${createHash('sha256').update(captureInput.deliveryId, 'utf8').digest('hex').slice(0, 32)}`;
      const existing = await findByDelivery(captureInput.deliveryId, raw);
      if (existing) {
        if (existing.connectorAccountId !== captureInput.connectorAccountId || existing.provider !== captureInput.provider) {
          throw new IdentityCustodyErrorV1('identity_operation_conflict');
        }
        const opened = openConnectorCapabilityV1({ key: activeKey(), keyRef: existing.keyRef, custodyRef: existing.custodyRef, deliveryId: captureInput.deliveryId, connectorAccountId: existing.connectorAccountId, provider: existing.provider, nonce: existing.nonce, ciphertext: existing.ciphertext, authTag: existing.authTag });
        const openedToken = Buffer.from(opened.token, 'utf8');
        const sourceToken = Buffer.from(source.token, 'utf8');
        const equal = opened.tokenKind === source.tokenKind && openedToken.byteLength === sourceToken.byteLength && timingSafeEqual(openedToken, sourceToken);
        openedToken.fill(0);
        sourceToken.fill(0);
        if (!equal) throw new IdentityCustodyErrorV1('identity_operation_conflict');
        return { kind: 'captured', reference: { custodyRef: existing.custodyRef, deliveryId: captureInput.deliveryId, connectorAccountId: existing.connectorAccountId, provider: existing.provider, createdAt: captureInput.at } };
      }
      const sealed = sealConnectorCapabilityV1({ key: activeKey(), keyRef, custodyRef, deliveryId: captureInput.deliveryId, connectorAccountId: captureInput.connectorAccountId, provider: captureInput.provider, capability: source });
      const table = custodyTableOf(raw);
      try {
        if (raw.profile === 'postgres') {
          await pgExec(raw, `INSERT INTO ${table} ("custody_ref","delivery_id","connector_account_id","provider","envelope_version","key_ref","nonce","ciphertext","auth_tag","created_at") VALUES ($1,$2,$3,$4,'1',$5,$6,$7,$8,$9)`, [custodyRef, captureInput.deliveryId, captureInput.connectorAccountId, captureInput.provider, keyRef, sealed.nonce, sealed.ciphertext, sealed.authTag, captureInput.at]);
        } else {
          sqliteExec(raw, `INSERT INTO ${table} ("custody_ref","delivery_id","connector_account_id","provider","envelope_version","key_ref","nonce","ciphertext","auth_tag","created_at") VALUES (?,?,?,?, '1',?,?,?,?,?)`, [custodyRef, captureInput.deliveryId, captureInput.connectorAccountId, captureInput.provider, keyRef, sealed.nonce, sealed.ciphertext, sealed.authTag, captureInput.at]);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('23505') || message.includes('UNIQUE constraint failed')) {
          throw new IdentityCustodyErrorV1('identity_operation_conflict');
        }
        throw error;
      }
      return { kind: 'captured', reference: { custodyRef, deliveryId: captureInput.deliveryId, connectorAccountId: captureInput.connectorAccountId, provider: captureInput.provider, createdAt: captureInput.at } };
    },
    assertCaptured: async (record, raw) => {
      if (record.targetKind !== 'connector_grant') throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
      const row = await findByDelivery(record.deliveryId, raw);
      if (!row) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
      if (row.connectorAccountId !== record.targetRef) throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
      openConnectorCapabilityV1({ key: activeKey(), keyRef: row.keyRef, custodyRef: row.custodyRef, deliveryId: row.deliveryId, connectorAccountId: row.connectorAccountId, provider: row.provider, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.authTag });
    },
    eraseAcknowledged: async (record, raw) => {
      const row = await findByDelivery(record.deliveryId, raw);
      if (!row) return;
      const table = custodyTableOf(raw);
      if (raw.profile === 'postgres') {
        await pgExec(raw, `DELETE FROM ${table} WHERE "custody_ref" = $1`, [row.custodyRef]);
      } else {
        sqliteExec(raw, `DELETE FROM ${table} WHERE "custody_ref" = ?`, [row.custodyRef]);
      }
    },
  };
};

export type NodeConnectorCustody = ReturnType<typeof createNodeConnectorCustody>;

/**
 * Acknowledges one claimed delivery and erases its connector custody row in
 * the same transaction. Non-connector deliveries skip custody.
 */
export const acknowledgeIdentityRevocationV1 = async (input: {
  readonly host: CustodyOpHost;
  readonly claim: IdentityRevocationClaimV1;
  readonly at: string;
  readonly connectorCustody: NodeConnectorCustody | null;
}): Promise<void> => {
  const journal = input.host.journal;
  const delivery = await journal.findDelivery(input.claim.deliveryId);
  if (!delivery || delivery.state !== 'pending') throw new IdentityCustodyErrorV1('identity_delivery_claim_conflict');
  await journal.acknowledgeDelivery(input.claim.deliveryId, input.claim.claimOwner, input.claim.claimVersion, input.at);
  if (delivery.targetKind === 'connector_grant') {
    if (!input.connectorCustody) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
    const schema = input.host.profile === 'postgres' ? (input.host as unknown as { readonly schema: string }).schema : '';
    const raw: ConnectorCustodyRaw = input.host.profile === 'postgres'
      ? { profile: 'postgres', schema, session: input.host.raw as PgSession, connection: null }
      : { profile: 'sqlite', schema: '', session: null, connection: input.host.raw as SqliteConnection };
    await input.connectorCustody.eraseAcknowledged(delivery, raw);
  }
};

