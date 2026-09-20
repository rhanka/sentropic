import { env } from '../../config/env';
import type {
  CredentialValidationResult,
  ModelCatalogEntry,
  NormalizedProviderError,
  ProviderDescriptor,
  ProviderRuntime,
} from '../provider-runtime';
import {
  buildRuntimeProviderDescriptor,
} from '../provider-runtime';

export type MuseGenerateRequest = {
  mode: 'msp';
  requestOptions: Record<string, unknown>;
  credential?: string;
  museAccountTransport?: { accessToken: string; accountId?: string | null };
  signal?: AbortSignal;
};

export type MuseStreamGenerateRequest = {
  mode: 'msp';
  requestOptions: Record<string, unknown>;
  credential?: string;
  museAccountTransport?: { accessToken: string; accountId?: string | null };
  signal?: AbortSignal;
};

export const resolveMuseApiKey = (credential?: string): string | null => {
  const direct = (credential ?? '').trim();
  if (direct.length > 0) return direct;
  // BR75-Q1: CI secret is MUSE_API_KEY; the repo-root .env carries
  // MODEL_API_KEY as fallback. No other generic name is read.
  const ciKey = (env.MUSE_API_KEY ?? '').trim();
  if (ciKey.length > 0) return ciKey;
  const modelKey = (env.MODEL_API_KEY ?? '').trim();
  return modelKey.length > 0 ? modelKey : null;
};

export class MuseProviderRuntime implements ProviderRuntime {
  readonly provider: ProviderDescriptor;

  constructor() {
    this.provider = buildRuntimeProviderDescriptor({
      providerId: 'muse',
      ready: this.validateCredential().ok,
    });
  }

  listModels(): ModelCatalogEntry[] {
    // No dispatch path exists until the Lot 2 account transport lands
    // (generate/streamGenerate reject until then). Advertising the catalog
    // models now would route live traffic into a throw and force speculative
    // stream fixtures, so the runtime lists nothing until it can serve.
    return [];
  }

  validateCredential(credential?: string): CredentialValidationResult {
    const apiKey = resolveMuseApiKey(credential);
    if (!apiKey) {
      return {
        ok: false,
        message: 'Muse API key is not configured',
      };
    }

    return { ok: true };
  }

  normalizeError(error: unknown): NormalizedProviderError {
    const record = error as Record<string, unknown> | null;
    const message =
      (record && typeof record.message === 'string' && record.message) ||
      (error instanceof Error && error.message) ||
      'Muse request failed';

    const code =
      (record && typeof record.code === 'string' && record.code) ||
      undefined;

    const status =
      (record && typeof record.status === 'number' && record.status) ||
      undefined;

    const retryable = status === 429 || (typeof status === 'number' && status >= 500);

    return {
      providerId: 'muse',
      message,
      ...(code ? { code } : {}),
      retryable,
    };
  }

  async generate(request: unknown): Promise<unknown> {
    const payload = request as MuseGenerateRequest;
    if (payload.mode !== 'msp') {
      throw new Error('MuseProviderRuntime.generate: unsupported mode');
    }
    // Lot 2 wires the `muse` account transport (CLI login import); until
    // then no direct API-key dispatch exists and inventing a Meta endpoint
    // URL here would be fabrication.
    throw new Error(
      'MuseProviderRuntime.generate: direct dispatch is not configured (account transport lands in Lot 2)',
    );
  }

  async streamGenerate(request: unknown): Promise<AsyncIterable<unknown>> {
    const payload = request as MuseStreamGenerateRequest;
    if (payload.mode !== 'msp') {
      throw new Error('MuseProviderRuntime.streamGenerate: unsupported mode');
    }
    throw new Error(
      'MuseProviderRuntime.streamGenerate: direct dispatch is not configured (account transport lands in Lot 2)',
    );
  }
}
