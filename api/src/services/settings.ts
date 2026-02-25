import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { settings } from '../db/schema';

export interface Setting {
  key: string;
  userId: string | null;
  value: string;
  description?: string;
  updatedAt: string;
}

type SettingsScopeOptions = {
  userId?: string | null;
  fallbackToGlobal?: boolean;
};

const DEFAULT_SETTINGS: Record<string, string> = {
  ai_concurrency: '10',
  publishing_concurrency: '5',
  default_provider_id: 'openai',
  default_model: 'gpt-4.1-nano',
  queue_processing_interval: '1000',
};

export class SettingsService {
  private cache = new Map<string, string>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 60000; // 1 minute

  private normalizeUserId(userId?: string | null): string | null {
    if (typeof userId !== 'string') return null;
    const normalized = userId.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private buildCacheKey(key: string, userId: string | null): string {
    return `${userId ?? '__global__'}::${key}`;
  }

  private getCached(cacheKey: string): string | undefined {
    const expiry = this.cacheExpiry.get(cacheKey);
    if (!expiry) return undefined;
    if (Date.now() >= expiry) {
      this.cache.delete(cacheKey);
      this.cacheExpiry.delete(cacheKey);
      return undefined;
    }
    if (!this.cache.has(cacheKey)) return undefined;
    return this.cache.get(cacheKey);
  }

  private setCached(cacheKey: string, value: string): void {
    this.cache.set(cacheKey, value);
    this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_TTL);
  }

  private invalidateKeyCache(key: string): void {
    const suffix = `::${key}`;
    for (const cacheKey of Array.from(this.cache.keys())) {
      if (!cacheKey.endsWith(suffix)) continue;
      this.cache.delete(cacheKey);
      this.cacheExpiry.delete(cacheKey);
    }
  }

  /**
   * Récupérer une valeur de paramètre.
   * - si userId est fourni: cherche d'abord la valeur user scope
   * - puis fallback global (user_id IS NULL) si fallbackToGlobal=true
   */
  async get(key: string, options: SettingsScopeOptions = {}): Promise<string | null> {
    const userId = this.normalizeUserId(options.userId);
    const fallbackToGlobal = options.fallbackToGlobal ?? true;

    if (userId) {
      const userCacheKey = this.buildCacheKey(key, userId);
      const cached = this.getCached(userCacheKey);
      if (cached !== undefined) return cached;

      const userRows = await db
        .select({ value: settings.value })
        .from(settings)
        .where(and(eq(settings.key, key), eq(settings.userId, userId)))
        .limit(1);
      const userValue = userRows[0]?.value ?? null;
      if (userValue !== null) {
        this.setCached(userCacheKey, userValue);
        return userValue;
      }
    }

    if (!userId || fallbackToGlobal) {
      const globalCacheKey = this.buildCacheKey(key, null);
      const cached = this.getCached(globalCacheKey);
      if (cached !== undefined) return cached;

      const globalRows = await db
        .select({ value: settings.value })
        .from(settings)
        .where(and(eq(settings.key, key), isNull(settings.userId)))
        .limit(1);
      const globalValue = globalRows[0]?.value ?? null;
      if (globalValue !== null) {
        this.setCached(globalCacheKey, globalValue);
        return globalValue;
      }
    }

    const defaultValue = DEFAULT_SETTINGS[key] || null;
    if (defaultValue !== null) {
      const globalCacheKey = this.buildCacheKey(key, null);
      this.setCached(globalCacheKey, defaultValue);
    }
    return defaultValue;
  }

  async getNumber(
    key: string,
    defaultValue = 0,
    options: SettingsScopeOptions = {}
  ): Promise<number> {
    const value = await this.get(key, options);
    return value ? parseInt(value, 10) : defaultValue;
  }

  async getBoolean(
    key: string,
    defaultValue = false,
    options: SettingsScopeOptions = {}
  ): Promise<boolean> {
    const value = await this.get(key, options);
    return value ? value.toLowerCase() === 'true' : defaultValue;
  }

  /**
   * Définir une valeur de paramètre.
   * - global scope: user_id = NULL
   * - user scope: user_id = <userId>
   */
  async set(
    key: string,
    value: string,
    description?: string,
    options: SettingsScopeOptions = {}
  ): Promise<void> {
    const userId = this.normalizeUserId(options.userId);
    const now = new Date();

    if (userId) {
      await db.run(sql`
        INSERT INTO settings (key, user_id, value, description, updated_at)
        VALUES (${key}, ${userId}, ${value}, ${description || null}, ${now})
        ON CONFLICT (user_id, key) WHERE user_id IS NOT NULL
        DO UPDATE SET
          value = EXCLUDED.value,
          description = COALESCE(EXCLUDED.description, settings.description),
          updated_at = EXCLUDED.updated_at
      `);
    } else {
      await db.run(sql`
        INSERT INTO settings (key, user_id, value, description, updated_at)
        VALUES (${key}, NULL, ${value}, ${description || null}, ${now})
        ON CONFLICT (key) WHERE user_id IS NULL
        DO UPDATE SET
          value = EXCLUDED.value,
          description = COALESCE(EXCLUDED.description, settings.description),
          updated_at = EXCLUDED.updated_at
      `);
    }

    this.invalidateKeyCache(key);
  }

  /**
   * Récupérer tous les paramètres (global scope par défaut).
   */
  async getAll(options?: { includeUserScoped?: boolean }): Promise<Setting[]> {
    const includeUserScoped = options?.includeUserScoped ?? false;

    const rows = includeUserScoped
      ? ((await db.all(sql`
          SELECT key, user_id as "userId", value, description, updated_at as "updatedAt"
          FROM settings
          ORDER BY key, user_id NULLS FIRST
        `)) as Setting[])
      : ((await db.all(sql`
          SELECT key, user_id as "userId", value, description, updated_at as "updatedAt"
          FROM settings
          WHERE user_id IS NULL
          ORDER BY key
        `)) as Setting[]);

    return rows;
  }

  /**
   * Paramètres IA:
   * - queue/concurrency restent globaux
   * - default provider/model peuvent être user-scopés avec fallback global
   */
  async getAISettings(options?: {
    userId?: string | null;
  }): Promise<{
    concurrency: number;
    publishingConcurrency: number;
    defaultProviderId: string;
    defaultModel: string;
    processingInterval: number;
  }> {
    const userId = this.normalizeUserId(options?.userId);

    const [
      concurrency,
      publishingConcurrency,
      defaultProviderId,
      defaultModel,
      processingInterval,
    ] = await Promise.all([
      this.getNumber('ai_concurrency', 10, { fallbackToGlobal: true }),
      this.getNumber('publishing_concurrency', 5, { fallbackToGlobal: true }),
      this.get('default_provider_id', {
        userId,
        fallbackToGlobal: true,
      }).then((value) => value || 'openai'),
      this.get('default_model', {
        userId,
        fallbackToGlobal: true,
      }).then((value) => value || 'gpt-4.1-nano'),
      this.getNumber('queue_processing_interval', 1000, {
        fallbackToGlobal: true,
      }),
    ]);

    return {
      concurrency,
      publishingConcurrency,
      defaultProviderId,
      defaultModel,
      processingInterval,
    };
  }

  /**
   * Mettre à jour les paramètres IA globaux (admin).
   */
  async updateAISettings(settingsInput: {
    concurrency?: number;
    publishingConcurrency?: number;
    defaultProviderId?: string;
    defaultModel?: string;
    processingInterval?: number;
  }): Promise<void> {
    const updates = [];

    if (settingsInput.concurrency !== undefined) {
      updates.push(
        this.set(
          'ai_concurrency',
          settingsInput.concurrency.toString(),
          'Nombre de jobs IA simultanes'
        )
      );
    }

    if (settingsInput.publishingConcurrency !== undefined) {
      updates.push(
        this.set(
          'publishing_concurrency',
          settingsInput.publishingConcurrency.toString(),
          'Nombre de jobs publishing simultanes'
        )
      );
    }

    if (settingsInput.defaultProviderId !== undefined) {
      updates.push(
        this.set(
          'default_provider_id',
          settingsInput.defaultProviderId,
          'Default AI provider'
        )
      );
    }

    if (settingsInput.defaultModel !== undefined) {
      updates.push(
        this.set('default_model', settingsInput.defaultModel, 'Modele IA par defaut')
      );
    }

    if (settingsInput.processingInterval !== undefined) {
      updates.push(
        this.set(
          'queue_processing_interval',
          settingsInput.processingInterval.toString(),
          'Intervalle de traitement de la queue (ms)'
        )
      );
    }

    await Promise.all(updates);
  }
}

export const settingsService = new SettingsService();
