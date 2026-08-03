import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type {
    DeviceIdentitySigner,
    DeviceIdentityStorageAdapter,
    StoredDeviceIdentity,
} from '@sentropic/cowork-bridge/auth';

function createStoredIdentity(): StoredDeviceIdentity {
    // OQ-1 is architect-revisable. The BR-41c foundation currently uses Ed25519
    // with base64url SPKI/PKCS#8 so server verification has one canonical shape.
    const pair = generateKeyPairSync('ed25519');
    return {
        deviceId: randomUUID(),
        publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
        privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
    };
}

function signerFromStored(identity: StoredDeviceIdentity): DeviceIdentitySigner {
    const privateKey = createPrivateKey({
        key: Buffer.from(identity.privateKey, 'base64url'),
        format: 'der',
        type: 'pkcs8',
    });
    if (privateKey.asymmetricKeyType !== 'ed25519') {
        throw new Error('Stored Cowork device identity is not an Ed25519 key');
    }
    return {
        deviceId: identity.deviceId,
        publicKey: identity.publicKey,
        async sign(payload: string): Promise<string> {
            return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
        },
    };
}

/** Load one stable device identity or create it once for a new installation. */
export async function loadOrCreateDeviceIdentity(
    storage: DeviceIdentityStorageAdapter,
): Promise<DeviceIdentitySigner> {
    const stored = await storage.readDeviceIdentity();
    if (stored) return signerFromStored(stored);

    const created = createStoredIdentity();
    await storage.writeDeviceIdentity(created);
    return signerFromStored(created);
}
