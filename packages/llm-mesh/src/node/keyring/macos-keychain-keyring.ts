import type { KeyringAdapter } from '../../service/facade.js';

export class MacOSKeychainKeyring implements KeyringAdapter {
  private readonly memoryStore = new Map<string, string>();
  private readonly serviceName: string;

  constructor(serviceName = 'sentropic-llm-mesh') {
    this.serviceName = serviceName;
  }

  async getSecret(key: string): Promise<string | null> {
    return this.memoryStore.get(`${this.serviceName}:${key}`) ?? null;
  }

  async setSecret(key: string, secret: string): Promise<void> {
    this.memoryStore.set(`${this.serviceName}:${key}`, secret);
  }

  async setSecretIfAbsent(key: string, secret: string): Promise<boolean> {
    const scopedKey = `${this.serviceName}:${key}`;
    if (this.memoryStore.has(scopedKey)) return false;
    this.memoryStore.set(scopedKey, secret);
    return true;
  }

  async deleteSecret(key: string): Promise<void> {
    this.memoryStore.delete(`${this.serviceName}:${key}`);
  }
}
