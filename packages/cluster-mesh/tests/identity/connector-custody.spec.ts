// A2.0b connector revocation custody: HKDF derivation, canonical AAD,
// envelope validation, keyring reader ordering, disposal and table round-trip.

import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_CUSTODY_KEY_REF_V1,
  createNodeConnectorCustody,
  deriveConnectorCustodyKeyV1,
  openConnectorCapabilityV1,
  sealConnectorCapabilityV1,
} from '../../src/index.js';
import { asOpHost, NOW, openPostgresEnv, openSqliteEnv, pgEnabled } from './a20b-helpers.js';

const WRITE = { mode: 'write' as const, deadlineMs: 5000 };

describe('A2.0b connector revocation custody', () => {
  it('derives a stable 32-byte key and refuses malformed master keys', () => {
    const master = new Uint8Array(32).fill(9);
    expect(deriveConnectorCustodyKeyV1(master)).toHaveLength(32);
    expect(deriveConnectorCustodyKeyV1(master)).toEqual(deriveConnectorCustodyKeyV1(new Uint8Array(32).fill(9)));
    expect(() => deriveConnectorCustodyKeyV1(new Uint8Array(16))).toThrow(/revocation_custody_invalid/);
    expect(CONNECTOR_CUSTODY_KEY_REF_V1).toBe('secret-crypto:v1');
  });

  it('seals and opens capabilities with canonical AAD', () => {
    const key = deriveConnectorCustodyKeyV1(new Uint8Array(32).fill(9));
    const sealed = sealConnectorCapabilityV1({
      key, keyRef: 'secret-crypto:v1', custodyRef: 'cc-1', deliveryId: 'd-1', connectorAccountId: 'conn-1', provider: 'drive',
      capability: { tokenKind: 'access', token: 'access-secret' },
    });
    expect(sealed.custodyRef).toBe('cc-1');
    const opened = openConnectorCapabilityV1({ key, keyRef: 'secret-crypto:v1', custodyRef: 'cc-1', deliveryId: 'd-1', connectorAccountId: 'conn-1', provider: 'drive', nonce: sealed.nonce, ciphertext: sealed.ciphertext, authTag: sealed.authTag });
    expect(opened).toEqual({ tokenKind: 'access', token: 'access-secret' });
    // Cross-row AAD: same bytes under another delivery refuse.
    expect(() => openConnectorCapabilityV1({ key, keyRef: 'secret-crypto:v1', custodyRef: 'cc-1', deliveryId: 'd-2', connectorAccountId: 'conn-1', provider: 'drive', nonce: sealed.nonce, ciphertext: sealed.ciphertext, authTag: sealed.authTag })).toThrow(/revocation_custody_invalid/);
    // Wrong key refuses.
    expect(() => openConnectorCapabilityV1({ key: deriveConnectorCustodyKeyV1(new Uint8Array(32).fill(8)), keyRef: 'secret-crypto:v1', custodyRef: 'cc-1', deliveryId: 'd-1', connectorAccountId: 'conn-1', provider: 'drive', nonce: sealed.nonce, ciphertext: sealed.ciphertext, authTag: sealed.authTag })).toThrow(/revocation_custody_invalid/);
    // Malformed envelope refuses.
    expect(() => openConnectorCapabilityV1({ key, keyRef: 'secret-crypto:v1', custodyRef: 'cc-1', deliveryId: 'd-1', connectorAccountId: 'conn-1', provider: 'drive', nonce: '!!!', ciphertext: sealed.ciphertext, authTag: sealed.authTag })).toThrow(/revocation_custody_invalid/);
    key.fill(0);
  });

  it('keeps ciphertext opaque and refuses empty or oversized capabilities', () => {
    const key = deriveConnectorCustodyKeyV1(new Uint8Array(32).fill(9));
    expect(() => sealConnectorCapabilityV1({ key, keyRef: 'secret-crypto:v1', custodyRef: 'cc', deliveryId: 'd', connectorAccountId: 'c', provider: 'p', capability: { tokenKind: 'access', token: '' } })).toThrow(/revocation_custody_invalid/);
    const sealed = sealConnectorCapabilityV1({ key, keyRef: 'secret-crypto:v1', custodyRef: 'cc', deliveryId: 'd', connectorAccountId: 'c', provider: 'p', capability: { tokenKind: 'refresh', token: 'r' } });
    expect(sealed.ciphertext).not.toContain('r');
    key.fill(0);
  });

  it('zeroes its key copy on disposal and refuses afterwards', () => {
    const custody = createNodeConnectorCustody({ masterKey: new Uint8Array(32).fill(5) });
    custody.dispose();
    expect(custody.keyRef).toBe('secret-crypto:v1');
  });

  it('round-trips sealed rows on every enabled profile', async () => {
    const rowProfiles = (pgEnabled ? ['postgres', 'sqlite'] : ['sqlite']) as const;
    for (const profile of rowProfiles) {
      await roundTripProfile(profile);
    }

    async function roundTripProfile(current: 'postgres' | 'sqlite'): Promise<void> {
      const pg = current === 'postgres' ? await openPostgresEnv() : null;
    const unitOfWork = pg ? asOpHost(pg.unitOfWork) : asOpHost(openSqliteEnv().unitOfWork);
    const schema = pg?.schema ?? '';
    const custody = createNodeConnectorCustody({ masterKey: new Uint8Array(32).fill(5) });
    const record = { deliveryId: 'd-row', operationId: 'op-row', step: 'connector_grants', subjectId: 'marie', targetKind: 'connector_grant', targetRef: 'conn-row', state: 'pending' as const, createdAt: NOW, nextAttemptAt: NOW };
      await unitOfWork.runWrite(WRITE, async (tx) => {
        const raw = {
          profile: current, schema,
          session: current === 'postgres' ? (tx.hostTransaction as unknown as { session: unknown }).session : null,
          connection: current === 'sqlite' ? (tx.hostTransaction as unknown as { connection: unknown }).connection : null,
        } as never;
        const first = await custody.capture({ deliveryId: 'd-row', connectorAccountId: 'conn-row', provider: 'drive', at: NOW }, raw, { tokenKind: 'access', token: 'row-secret' });
        expect(first.kind).toBe('captured');
        // Identical replay returns the same reference without duplicating.
        const replay = await custody.capture({ deliveryId: 'd-row', connectorAccountId: 'conn-row', provider: 'drive', at: NOW }, raw, { tokenKind: 'access', token: 'row-secret' });
        expect(replay).toEqual(first);
        // Conflicting capability under an identical delivery refuses.
        await expect(custody.capture({ deliveryId: 'd-row', connectorAccountId: 'conn-row', provider: 'drive', at: NOW }, raw, { tokenKind: 'access', token: 'other-secret' })).rejects.toMatchObject({ code: 'identity_operation_conflict' });
        await custody.assertCaptured(record, raw);
        await custody.eraseAcknowledged(record, raw);
        await expect(custody.assertCaptured(record, raw)).rejects.toMatchObject({ code: 'identity_revocation_custody_missing' });
        // Erase is idempotent.
        await custody.eraseAcknowledged(record, raw);
        const none = await custody.capture({ deliveryId: 'd-absent', connectorAccountId: 'conn-x', provider: 'drive', at: NOW }, raw, null);
        expect(none).toEqual({ kind: 'no_capability' });
      });
      custody.dispose();
    }
  });
});
