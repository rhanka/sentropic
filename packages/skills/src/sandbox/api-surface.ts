import {
  SandboxDenied,
  policyAllowsSurface,
  type ResolvedSandboxPolicy,
} from './policy.js';
import type { SandboxHostAdapters } from './runtime.js';

/**
 * Shape of the `files` surface visible inside the sandbox. Mirrors
 * `SandboxHostAdapters.files` but with sandbox-side input validation.
 */
export interface SandboxFilesApi {
  create(input: {
    name: string;
    mimeType: string;
    content: Uint8Array | string;
  }): Promise<{ artefactId: string; mimeType: string }>;
}

/** Shape of the `db` surface visible inside the sandbox. */
export interface SandboxDbApi {
  query(input: {
    sql: string;
    params?: ReadonlyArray<unknown>;
  }): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

/** Shape of the `fetch` surface visible inside the sandbox. */
export type SandboxFetchApi = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

/**
 * Aggregated set of host-side proxy functions injected into the isolate.
 * Members are present only when (a) the policy allowlist contains the
 * matching surface and (b) the host provided a backing adapter.
 */
export interface SandboxApiSurface {
  readonly files?: SandboxFilesApi;
  readonly db?: SandboxDbApi;
  readonly fetch?: SandboxFetchApi;
}

const MAX_FILE_NAME_LENGTH = 256;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB
const MAX_SQL_LENGTH = 8_000;
const MAX_SQL_PARAMS = 64;
const ALLOWED_FETCH_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_FETCH_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

/** Friendly type guard: a non-empty string. */
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Build the `files.create` host proxy. Validates input on the host side
 * before delegating to the adapter (defence in depth — the isolate could
 * have been tampered with).
 */
function buildFilesProxy(
  adapter: NonNullable<SandboxHostAdapters['files']>,
  policy: ResolvedSandboxPolicy,
): SandboxFilesApi {
  return {
    async create(input) {
      if (!policyAllowsSurface(policy, 'files.create')) {
        throw new SandboxDenied('files.create');
      }
      if (!input || typeof input !== 'object') {
        throw new TypeError('files.create: input must be an object');
      }
      if (!isNonEmptyString(input.name) || input.name.length > MAX_FILE_NAME_LENGTH) {
        throw new TypeError(
          `files.create: "name" must be a non-empty string ≤ ${MAX_FILE_NAME_LENGTH} chars`,
        );
      }
      if (!isNonEmptyString(input.mimeType)) {
        throw new TypeError('files.create: "mimeType" must be a non-empty string');
      }
      const contentBytes =
        typeof input.content === 'string'
          ? Buffer.byteLength(input.content, 'utf8')
          : input.content?.byteLength;
      if (contentBytes === undefined) {
        throw new TypeError('files.create: "content" must be a string or Uint8Array');
      }
      if (contentBytes > MAX_FILE_BYTES) {
        throw new RangeError(
          `files.create: content exceeds ${MAX_FILE_BYTES} bytes (got ${contentBytes})`,
        );
      }
      return adapter.create(input);
    },
  };
}

/** Build the `db.query` host proxy with strict input validation. */
function buildDbProxy(
  adapter: NonNullable<SandboxHostAdapters['db']>,
  policy: ResolvedSandboxPolicy,
): SandboxDbApi {
  return {
    async query(input) {
      if (!policyAllowsSurface(policy, 'db.query')) {
        throw new SandboxDenied('db.query');
      }
      if (!input || typeof input !== 'object') {
        throw new TypeError('db.query: input must be an object');
      }
      if (!isNonEmptyString(input.sql) || input.sql.length > MAX_SQL_LENGTH) {
        throw new TypeError(
          `db.query: "sql" must be a non-empty string ≤ ${MAX_SQL_LENGTH} chars`,
        );
      }
      const params = input.params ?? [];
      if (!Array.isArray(params) || params.length > MAX_SQL_PARAMS) {
        throw new TypeError(
          `db.query: "params" must be an array of ≤ ${MAX_SQL_PARAMS} items`,
        );
      }
      return adapter.query({ sql: input.sql, params });
    },
  };
}

/** Build the `fetch` host proxy with URL/method/body validation. */
function buildFetchProxy(
  adapter: NonNullable<SandboxHostAdapters['fetch']>,
  policy: ResolvedSandboxPolicy,
): SandboxFetchApi {
  return async (url, init) => {
    if (!policyAllowsSurface(policy, 'fetch')) {
      throw new SandboxDenied('fetch');
    }
    if (!isNonEmptyString(url)) {
      throw new TypeError('fetch: "url" must be a non-empty string');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new TypeError(`fetch: "url" is not a valid URL (${url})`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError(
        `fetch: protocol "${parsed.protocol}" not allowed (http/https only)`,
      );
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    if (!ALLOWED_FETCH_METHODS.has(method)) {
      throw new TypeError(`fetch: method "${method}" not in allowlist`);
    }
    if (init?.body !== undefined) {
      if (typeof init.body !== 'string') {
        throw new TypeError('fetch: "body" must be a string when provided');
      }
      const bodyBytes = Buffer.byteLength(init.body, 'utf8');
      if (bodyBytes > MAX_FETCH_BODY_BYTES) {
        throw new RangeError(
          `fetch: body exceeds ${MAX_FETCH_BODY_BYTES} bytes (got ${bodyBytes})`,
        );
      }
    }
    return adapter(url, { method, headers: init?.headers, body: init?.body });
  };
}

/**
 * Compose the API surface exposed to a sandboxed skill. Returns only the
 * proxies for which (a) the resolved policy declares the surface and (b) the
 * host adapter exists. Missing adapters with a declared surface are reported
 * as warnings on the returned object so the runtime can log them once.
 */
export function buildSandboxApiSurface(
  policy: ResolvedSandboxPolicy,
  adapters: SandboxHostAdapters | undefined,
): { surface: SandboxApiSurface; missing: ReadonlyArray<string> } {
  const surface: { files?: SandboxFilesApi; db?: SandboxDbApi; fetch?: SandboxFetchApi } = {};
  const missing: string[] = [];

  for (const declared of policy.surface) {
    switch (declared) {
      case 'files.create':
        if (adapters?.files) {
          surface.files = buildFilesProxy(adapters.files, policy);
        } else {
          missing.push('files.create');
        }
        break;
      case 'db.query':
        if (adapters?.db) {
          surface.db = buildDbProxy(adapters.db, policy);
        } else {
          missing.push('db.query');
        }
        break;
      case 'fetch':
        if (adapters?.fetch) {
          surface.fetch = buildFetchProxy(adapters.fetch, policy);
        } else {
          missing.push('fetch');
        }
        break;
      default:
        // Unknown surface declared — treat as missing so the runtime can warn
        // but not crash. Allowlist enforcement happens at proxy call time.
        missing.push(String(declared));
        break;
    }
  }

  return { surface, missing };
}
