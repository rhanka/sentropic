import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  chmod,
  link,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { KeyringAdapter } from '../../service/facade.js';

interface EncryptedRecord {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

const isErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

export class EncryptedFileKeyring implements KeyringAdapter {
  private readonly directory: string;

  constructor(
    directory =
      process.env.SENTROPIC_LLM_MESH_KEYRING_DIR ??
      join(homedir(), '.sentropic', 'llm-mesh-keyring'),
  ) {
    this.directory = directory;
  }

  async getSecret(key: string): Promise<string | null> {
    let raw: string;
    try {
      raw = await readFile(this.secretPath(key), 'utf8');
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) return null;
      throw error;
    }

    const masterKey = await this.readMasterKey(false);
    let record: EncryptedRecord;
    try {
      record = JSON.parse(raw) as EncryptedRecord;
      if (
        record.v !== 1 ||
        typeof record.iv !== 'string' ||
        typeof record.tag !== 'string' ||
        typeof record.data !== 'string'
      ) {
        throw new Error('invalid record');
      }
    } catch {
      throw new Error(`Encrypted keyring record is corrupt for key '${key}'`);
    }

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        masterKey,
        Buffer.from(record.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(key, 'utf8'));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(record.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error(`Encrypted keyring authentication failed for key '${key}'`);
    }
  }

  async setSecret(key: string, secret: string): Promise<void> {
    const record = await this.encryptSecret(key, secret);
    const destination = this.secretPath(key);
    const temporary = `${destination}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
      await rename(temporary, destination);
      await chmod(destination, 0o600);
    } catch (error) {
      await this.unlinkIfPresent(temporary);
      throw error;
    }
  }

  async setSecretIfAbsent(key: string, secret: string): Promise<boolean> {
    const record = await this.encryptSecret(key, secret);
    const destination = this.secretPath(key);
    const temporary = `${destination}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    try {
      try {
        await link(temporary, destination);
      } catch (error) {
        if (isErrorCode(error, 'EEXIST')) return false;
        throw error;
      }
      await chmod(destination, 0o600);
      return true;
    } finally {
      await this.unlinkIfPresent(temporary);
    }
  }

  async deleteSecret(key: string): Promise<void> {
    await this.unlinkIfPresent(this.secretPath(key));
  }

  private secretPath(key: string): string {
    const filename = createHash('sha256').update(key).digest('hex');
    return join(this.directory, `${filename}.json`);
  }

  private async encryptSecret(key: string, secret: string): Promise<EncryptedRecord> {
    const masterKey = await this.readMasterKey(true);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
    cipher.setAAD(Buffer.from(key, 'utf8'));
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(secret, 'utf8')),
      cipher.final(),
    ]);
    return {
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    };
  }

  private async readMasterKey(create: boolean): Promise<Buffer> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const path = join(this.directory, '.key');
    try {
      return await this.loadAndValidateMasterKey(path);
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT') || !create) {
        if (isErrorCode(error, 'ENOENT')) {
          throw new Error('Encrypted keyring master key is missing');
        }
        throw error;
      }
    }

    const candidate = randomBytes(32);
    const temporary = join(
      this.directory,
      `.key.${randomBytes(8).toString('hex')}.tmp`,
    );
    await writeFile(temporary, candidate, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, path);
    } catch (error) {
      if (!isErrorCode(error, 'EEXIST')) throw error;
    } finally {
      await this.unlinkIfPresent(temporary);
    }
    await chmod(path, 0o600);
    return this.loadAndValidateMasterKey(path);
  }

  private async loadAndValidateMasterKey(path: string): Promise<Buffer> {
    const masterKey = await readFile(path);
    if (masterKey.length !== 32) {
      throw new Error('Encrypted keyring master key is corrupt');
    }
    return masterKey;
  }

  private async unlinkIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error;
    }
  }
}
