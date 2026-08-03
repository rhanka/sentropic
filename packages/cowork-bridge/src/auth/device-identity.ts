/**
 * Persisted device identity data. The bridge deliberately supplies only the
 * storage contract: platform-specific key generation and signing stay in the
 * desktop host, so browsers are not forced to handle a native private key.
 */
export interface StoredDeviceIdentity {
    deviceId: string;
    publicKey: string;
    privateKey: string;
}

export interface DeviceIdentityStorageAdapter {
    readDeviceIdentity(): Promise<StoredDeviceIdentity | null>;
    writeDeviceIdentity(identity: StoredDeviceIdentity): Promise<void>;
    clearDeviceIdentity(): Promise<void>;
}

export interface DeviceIdentitySigner {
    deviceId: string;
    publicKey: string;
    sign(payload: string): Promise<string>;
}
