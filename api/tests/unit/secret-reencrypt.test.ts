import { createCipheriv, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_SECRET_SEED } from '../../src/config/deployment-secrets';
import {
  parseSecretReencryptRequest,
  reencryptConnectorEnvelope,
  reencryptSecretValue,
  runSecretReencrypt,
  type ReencryptQuery,
} from '../../src/scripts/secret-reencrypt';
import { deriveConnectorRevocationKey, deriveV1Key, openSecretWithKey, sealSecretWithKey } from '../../src/services/secret-crypto';
import { resealConnectorEnvelope, type ConnectorCustodyEnvelope } from '../../src/services/identity/cm-connector-envelope';

const TARGET = 'provisioned-target-key-0123456789abcdef';
const keys = { source: deriveV1Key(DEVELOPMENT_SECRET_SEED), target: deriveV1Key(TARGET) };
const tuple = { custodyRef: 'c-1', deliveryId: 'd-1', connectorAccountId: 'a-1', provider: 'google_drive', keyRef: 'secret-crypto:v1' };
/** A custody envelope sealed under the custody key derived from `v1Key`, written out independently (module AAD). */
const custodyUnder = (v1Key: Buffer): ConnectorCustodyEnvelope => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveConnectorRevocationKey(v1Key), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(JSON.stringify(['A2.0b-connector-custody', '1', tuple.custodyRef, tuple.deliveryId,
    tuple.connectorAccountId, tuple.provider, tuple.keyRef])));
  const body = Buffer.concat([cipher.update('{"tokenKind":"refresh","token":"r-1"}'), cipher.final()]);
  return { ...tuple, envelopeVersion: '1', nonce: nonce.toString('base64url'), ciphertext: body.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'), createdAt: '2026-11-08T00:00:00.000Z' };
};

describe('parseSecretReencryptRequest', () => {
  it('needs a provisioned target and exactly one source', () => {
    expect(() => parseSecretReencryptRequest({}, ['--from-development-seed'])).toThrow(/SECRET_ENCRYPTION_KEY/);
    expect(() => parseSecretReencryptRequest({ SECRET_ENCRYPTION_KEY: DEVELOPMENT_SECRET_SEED }, ['--from-development-seed']))
      .toThrow(/SECRET_ENCRYPTION_KEY/);
    expect(() => parseSecretReencryptRequest({ SECRET_ENCRYPTION_KEY: TARGET }, [])).toThrow(/exactly one source/);
    expect(() => parseSecretReencryptRequest({ SECRET_ENCRYPTION_KEY: TARGET, SECRET_REENCRYPT_SOURCE_KEY: 'old' },
      ['--from-development-seed'])).toThrow(/exactly one source/);
    expect(() => parseSecretReencryptRequest({ SECRET_ENCRYPTION_KEY: TARGET, SECRET_REENCRYPT_SOURCE_KEY: TARGET }, []))
      .toThrow(/identical/);
  });

  it('defaults to a dry run; --apply writes', () => {
    const env = { SECRET_ENCRYPTION_KEY: TARGET };
    const dry = parseSecretReencryptRequest(env, ['--from-development-seed']);
    expect(dry.apply).toBe(false);
    expect(dry.keys.source.equals(keys.source) && dry.keys.target.equals(keys.target)).toBe(true);
    expect(parseSecretReencryptRequest({ ...env, SECRET_REENCRYPT_SOURCE_KEY: 'old' }, ['--apply']).apply).toBe(true);
  });
});

describe('envelope re-encryption', () => {
  it('moves a source envelope, keeps a current one, and lists an unreadable one', () => {
    const moved = reencryptSecretValue(sealSecretWithKey('s3cret', keys.source), keys);
    expect(moved.outcome).toBe('moved');
    expect(openSecretWithKey(moved.next as string, keys.target)).toBe('s3cret');
    expect(reencryptSecretValue(sealSecretWithKey('s3cret', keys.target), keys)).toEqual({ outcome: 'current' });
    expect(reencryptSecretValue(sealSecretWithKey('s3cret', deriveV1Key('a-third-key')), keys)).toEqual({ outcome: 'unreadable' });
    expect(reencryptSecretValue('enc:v2:a:b:c', keys)).toEqual({ outcome: 'unreadable' });
  });

  it('re-seals connector custody under the target custody key, same tuple, fresh nonce', () => {
    const source = custodyUnder(keys.source);
    const result = reencryptConnectorEnvelope(source, keys);
    expect(result.outcome).toBe('moved');
    const next = result.next as ConnectorCustodyEnvelope;
    expect({ ...next, nonce: '', ciphertext: '', authTag: '' }).toEqual({ ...source, nonce: '', ciphertext: '', authTag: '' });
    expect(next.nonce).not.toBe(source.nonce);
    const target = deriveConnectorRevocationKey(keys.target);
    expect(resealConnectorEnvelope(next, target, target)).not.toBeNull();
    expect(reencryptConnectorEnvelope(next, keys)).toEqual({ outcome: 'current' });
    expect(reencryptConnectorEnvelope({ ...source, keyRef: 'secret-crypto:v9' }, keys)).toEqual({ outcome: 'unreadable' });
  });
});

describe('runSecretReencrypt', () => {
  const fakeDb = (present: Record<string, boolean>, rows: Record<string, unknown[]>) => {
    const writes: Array<{ text: string; params: unknown[] }> = [];
    const query: ReencryptQuery = async (text, params = []) => {
      if (text.includes('to_regclass')) return { rows: [{ present: present[params[0] as string] ?? false }], rowCount: 1 };
      if (text.startsWith('UPDATE')) { writes.push({ text, params }); return { rows: [], rowCount: 1 }; }
      const store = Object.keys(rows).find((name) => text.includes(name));
      return { rows: store ? rows[store] : [], rowCount: 0 };
    };
    return { query, writes };
  };
  const settingsRows = [
    { row_ref: '(0,1)', id: 'byok@u-1', value: sealSecretWithKey('k1', keys.source) },
    { row_ref: '(0,2)', id: 'byok@u-2', value: sealSecretWithKey('k2', keys.target) },
    { row_ref: '(0,3)', id: 'byok@u-3', value: sealSecretWithKey('k3', deriveV1Key('lost')) },
  ];

  it('dry run reports every store and writes nothing; absent tables are skipped', async () => {
    const db = fakeDb({ 'public.settings': true }, { 'public.settings': settingsRows });
    const report = await runSecretReencrypt(db.query, keys, false);
    expect(db.writes).toEqual([]);
    expect(report.find((store) => store.store === 'public.settings'))
      .toEqual({ store: 'public.settings', present: true, scanned: 3, current: 1, moved: 1, unreadable: ['byok@u-3'] });
    expect(report.filter((store) => !store.present).map((store) => store.store)).toEqual([
      'public.document_connector_accounts', 'public.llm_provider_accounts', 'control.connector_revocation_custody']);
  });

  it('apply swaps each moved value by compare-and-set on the old ciphertext', async () => {
    const custody = custodyUnder(keys.source);
    const custodyRow = { custody_ref: custody.custodyRef, delivery_id: custody.deliveryId, connector_account_id: custody.connectorAccountId,
      provider: custody.provider, envelope_version: '1', key_ref: custody.keyRef, nonce: custody.nonce,
      ciphertext: custody.ciphertext, auth_tag: custody.authTag, created_at: custody.createdAt };
    const db = fakeDb({ 'public.settings': true, 'control.connector_revocation_custody': true },
      { 'public.settings': settingsRows, 'control.connector_revocation_custody': [custodyRow] });
    await runSecretReencrypt(db.query, keys, true);
    expect(db.writes).toHaveLength(2);
    const [setting, custodyWrite] = db.writes;
    expect(setting.text).toBe("UPDATE public.settings SET value = $3 WHERE ctid = $1::tid AND value = $2");
    expect(setting.params[0]).toBe("(0,1)");
    expect(setting.params[1]).toBe(settingsRows[0].value);
    expect(openSecretWithKey(setting.params[2] as string, keys.target)).toBe("k1");
    expect(custodyWrite.text).toMatch(/^UPDATE control\.connector_revocation_custody SET/);
    expect(custodyWrite.params[0]).toBe(custody.custodyRef);
    expect(custodyWrite.params[4]).toBe(custody.ciphertext);
  });
});
