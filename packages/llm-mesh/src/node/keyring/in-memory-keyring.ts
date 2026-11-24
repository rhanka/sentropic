import type {
  KeyringAdapter,
  KeyringCasGuard,
  KeyringCasUpdate,
} from '../../service/facade.js';

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

  async compareAndSetSecret(
    key: string,
    expected: string | null,
    secret: string,
  ): Promise<boolean> {
    return this.compareAndSetSecrets([{ key, expected, secret }]);
  }

  async compareAndSetSecrets(
    updates: readonly KeyringCasUpdate[],
    guards: readonly KeyringCasGuard[] = [],
  ): Promise<boolean> {
    for (const entry of [...guards, ...updates]) {
      if ((this.store.get(entry.key) ?? null) !== entry.expected) return false;
    }
    const previous = updates.map((u) => ({ key: u.key, value: this.store.get(u.key) }));
    try {
      for (const update of updates) {
        await this.setSecret(update.key, update.secret);
      }
      return true;
    } catch (error) {
      for (const entry of previous) {
        if (entry.value === undefined) this.store.delete(entry.key);
        else this.store.set(entry.key, entry.value);
      }
      throw error;
    }
  }

  async deleteSecret(key: string): Promise<void> {
    this.store.delete(key);
  }
}
