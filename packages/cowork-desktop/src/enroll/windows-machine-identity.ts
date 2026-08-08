import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DeviceIdentitySigner } from '@sentropic/cowork-bridge/auth';

const execFileAsync = promisify(execFile);
const IDENTITY_FILE = 'device-identity.dpapi.json';
type ProtectedIdentity = { deviceId: string; publicKey: string; protectedPrivateKey: string };

const DPAPI_SCRIPT = String.raw`
$bytes = [Convert]::FromBase64String($env:SENTROPIC_COWORK_DPAPI_DATA)
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($env:SENTROPIC_COWORK_DPAPI_MODE -eq 'protect') {
  [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope))
} else {
  [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope))
}
`;

async function dpapi(mode: 'protect' | 'unprotect', bytes: Buffer): Promise<Buffer> {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT], {
        windowsHide: true,
        env: { ...process.env, SENTROPIC_COWORK_DPAPI_MODE: mode, SENTROPIC_COWORK_DPAPI_DATA: bytes.toString('base64') },
    });
    return Buffer.from(stdout.trim(), 'base64');
}

const toSigner = (identity: { deviceId: string; publicKey: string; privateKey: string }): DeviceIdentitySigner => {
    const privateKey = createPrivateKey({ key: Buffer.from(identity.privateKey, 'base64url'), format: 'der', type: 'pkcs8' });
    return {
        deviceId: identity.deviceId,
        publicKey: identity.publicKey,
        async sign(payload: string): Promise<string> { return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url'); },
    };
};

/** Windows-DPAPI CurrentUser makes a copied app directory fail to sign elsewhere. */
export async function loadOrCreateWindowsMachineIdentity(appDir: string): Promise<DeviceIdentitySigner> {
    if (process.platform !== 'win32') throw new Error('Cowork kiosk identity requires Windows DPAPI.');
    const path = join(appDir, IDENTITY_FILE);
    try {
        const stored = JSON.parse(await readFile(path, 'utf8')) as ProtectedIdentity;
        const privateKey = (await dpapi('unprotect', Buffer.from(stored.protectedPrivateKey, 'base64'))).toString('base64url');
        return toSigner({ ...stored, privateKey });
    } catch (error) {
        try { await readFile(path); } catch {
            const pair = generateKeyPairSync('ed25519');
            const identity = {
                deviceId: randomUUID(),
                publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
                privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
            };
            const protectedPrivateKey = (await dpapi('protect', Buffer.from(identity.privateKey, 'base64url'))).toString('base64');
            await mkdir(appDir, { recursive: true });
            await writeFile(path, JSON.stringify({ deviceId: identity.deviceId, publicKey: identity.publicKey, protectedPrivateKey }), { mode: 0o600 });
            return toSigner(identity);
        }
        throw new Error(`Cowork machine identity cannot be decrypted on this Windows user/host: ${error instanceof Error ? error.message : String(error)}`);
    }
}
