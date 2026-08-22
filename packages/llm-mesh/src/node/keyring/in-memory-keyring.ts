import type { KeyringAdapter } from '../../service/facade.js';

export class InMemoryKeyring implements KeyringAdapter {
  private readonly store = new Map<string, string>();

  async getSecret(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setSecret(key: string, secret: string): Promise<void> {
    this.store.set(key, secret);
  }

  async setSecretIfAbsent(key: string, secret: string): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, secret);
    return true;
  }

  async deleteSecret(key: string): Promise<void> {
    this.store.delete(key);
  }
}
