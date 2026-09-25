/**
 * Listener configuration for the standalone gateway host (spec D3), validated once
 * at boot. Dependency configuration (identity, ledger, seats) arrives with B2-B4;
 * this module never reads secrets and never echoes raw values in its errors.
 */

export type HostMode = 'production' | 'development' | 'test';

export interface HostConfig {
  readonly mode: HostMode;
  readonly port: number;
  readonly host: string;
  /** SIGTERM drain bound for active streams (spec D3: 25 s inside a 40 s pod grace). */
  readonly drainTimeoutMs: number;
}

export const PRODUCTION_PORT = 3001;
export const PRODUCTION_HOST = '0.0.0.0';
export const DRAIN_TIMEOUT_MS = 25_000;

export class HostConfigError extends Error {
  readonly code = 'invalid_llm_gateway_host_config';

  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'HostConfigError';
  }
}

const MODES: readonly HostMode[] = ['production', 'development', 'test'];

const parseMode = (raw: string | undefined): HostMode => {
  const value = raw?.trim();
  if (!value) throw new HostConfigError('NODE_ENV', 'is required');
  if (!(MODES as readonly string[]).includes(value)) throw new HostConfigError('NODE_ENV', 'unknown mode');
  return value as HostMode;
};

const parsePort = (raw: string | undefined, mode: HostMode): number => {
  const value = raw?.trim();
  if (!value) {
    if (mode === 'production') throw new HostConfigError('PORT', 'is required in production');
    return PRODUCTION_PORT;
  }
  if (!/^\d{1,5}$/.test(value)) throw new HostConfigError('PORT', 'must be a decimal TCP port');
  const port = Number(value);
  // Port 0 (ephemeral) is only meaningful for tests; a served process needs a stable port.
  const min = mode === 'test' ? 0 : 1;
  if (port < min || port > 65_535) throw new HostConfigError('PORT', 'is out of range');
  if (mode === 'production' && port !== PRODUCTION_PORT) {
    throw new HostConfigError('PORT', `must be ${PRODUCTION_PORT} in production`);
  }
  return port;
};

const parseHost = (raw: string | undefined, mode: HostMode): string => {
  const value = raw?.trim();
  if (!value) {
    if (mode === 'production') throw new HostConfigError('HOST', 'is required in production');
    return '127.0.0.1';
  }
  if (!/^[A-Za-z0-9.:-]+$/.test(value)) throw new HostConfigError('HOST', 'is not a bind address');
  if (mode === 'production' && value !== PRODUCTION_HOST) {
    throw new HostConfigError('HOST', `must be ${PRODUCTION_HOST} in production`);
  }
  return value;
};

/** Validate the process environment into a frozen host configuration. */
export const loadHostConfig = (env: Readonly<Record<string, string | undefined>>): HostConfig => {
  const mode = parseMode(env.NODE_ENV);
  return Object.freeze({
    mode,
    port: parsePort(env.PORT, mode),
    host: parseHost(env.HOST, mode),
    drainTimeoutMs: DRAIN_TIMEOUT_MS,
  });
};
