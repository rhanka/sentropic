import type { KeyringAdapter } from '../../service/facade.js';

export class LinuxSecretstoreKeyring implements KeyringAdapter {
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

  async deleteSecret(key: string): Promise<void> {
    this.memoryStore.delete(`${this.serviceName}:${key}`);
  }
}
