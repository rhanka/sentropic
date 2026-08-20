import type { KeyringAdapter } from '../../service/facade.js';

export class EnvKeyring implements KeyringAdapter {
  private readonly envPrefix: string;
  private readonly memoryFallback = new Map<string, string>();

  constructor(envPrefix = 'SENTROPIC_KEYRING_') {
    this.envPrefix = envPrefix;
  }

  private envKey(key: string): string {
    return `${this.envPrefix}${key.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()}`;
  }

  async getSecret(key: string): Promise<string | null> {
    const envVal = process.env[this.envKey(key)] ?? process.env[key];
    if (typeof envVal === 'string' && envVal.length > 0) {
      return envVal;
    }
    return this.memoryFallback.get(key) ?? null;
  }

  async setSecret(key: string, secret: string): Promise<void> {
    process.env[this.envKey(key)] = secret;
    this.memoryFallback.set(key, secret);
  }

  async setSecretIfAbsent(key: string, secret: string): Promise<boolean> {
    const scopedKey = this.envKey(key);
    const envVal = process.env[scopedKey] ?? process.env[key];
    if ((typeof envVal === 'string' && envVal.length > 0) || this.memoryFallback.has(key)) {
      return false;
    }
    process.env[scopedKey] = secret;
    this.memoryFallback.set(key, secret);
    return true;
  }

  async deleteSecret(key: string): Promise<void> {
    delete process.env[this.envKey(key)];
    this.memoryFallback.delete(key);
  }
}
