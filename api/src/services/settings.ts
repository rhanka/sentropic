import { db } from '../db/client';
import { sql, eq } from 'drizzle-orm';

export interface Setting {
  key: string;
  value: string;
  description?: string;
  updatedAt: string;
}

export class SettingsService {
  private cache = new Map<string, string>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 60000; // 1 minute

  /**
   * Récupérer une valeur de paramètre
   */
  async get(key: string): Promise<string | null> {
    // Vérifier le cache
    const cached = this.cache.get(key);
    const expiry = this.cacheExpiry.get(key);
    
    if (cached && expiry && Date.now() < expiry) {
      return cached;
    }

    // Récupérer depuis la base de données
    const result = await db.get(sql`
      SELECT value FROM settings WHERE key = ${key}
    `) as { value: string } | undefined;

    const value = result?.value || null;
    
    // Mettre en cache
    if (value) {
      this.cache.set(key, value);
      this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL);
    }

    return value;
  }

  /**
   * Récupérer une valeur de paramètre avec type
   */
  async getNumber(key: string, defaultValue: number = 0): Promise<number> {
    const value = await this.get(key);
    return value ? parseInt(value, 10) : defaultValue;
  }

  /**
   * Récupérer une valeur de paramètre booléenne
   */
  async getBoolean(key: string, defaultValue: boolean = false): Promise<boolean> {
    const value = await this.get(key);
    return value ? value.toLowerCase() === 'true' : defaultValue;
  }

  /**
   * Définir une valeur de paramètre
   */
  async set(key: string, value: string, description?: string): Promise<void> {
    await db.run(sql`
      INSERT OR REPLACE INTO settings (key, value, description, updated_at)
      VALUES (${key}, ${value}, ${description || null}, ${new Date().toISOString()})
    `);

    // Invalider le cache
    this.cache.delete(key);
    this.cacheExpiry.delete(key);
  }

  /**
   * Récupérer tous les paramètres
   */
  async getAll(): Promise<Setting[]> {
    const results = await db.all(sql`
      SELECT key, value, description, updated_at as updatedAt
      FROM settings
      ORDER BY key
    `) as Setting[];

    return results;
  }

  /**
   * Récupérer les paramètres de configuration IA
   */
  async getAISettings(): Promise<{
    concurrency: number;
    defaultModel: string;
    processingInterval: number;
  }> {
    const [concurrency, defaultModel, processingInterval] = await Promise.all([
      this.getNumber('ai_concurrency', 10),
      this.get('default_model') || 'gpt-5',
      this.getNumber('queue_processing_interval', 1000)
    ]);

    return {
      concurrency,
      defaultModel,
      processingInterval
    };
  }

  /**
   * Mettre à jour les paramètres IA
   */
  async updateAISettings(settings: {
    concurrency?: number;
    defaultModel?: string;
    processingInterval?: number;
  }): Promise<void> {
    const updates = [];
    
    if (settings.concurrency !== undefined) {
      updates.push(this.set('ai_concurrency', settings.concurrency.toString(), 'Nombre de jobs IA simultanés'));
    }
    
    if (settings.defaultModel !== undefined) {
      updates.push(this.set('default_model', settings.defaultModel, 'Modèle OpenAI par défaut'));
    }
    
    if (settings.processingInterval !== undefined) {
      updates.push(this.set('queue_processing_interval', settings.processingInterval.toString(), 'Intervalle de traitement de la queue (ms)'));
    }

    await Promise.all(updates);
  }
}

export const settingsService = new SettingsService();
