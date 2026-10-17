// @sentropic/llm-mesh/node/cli-seat-store-reader.ts
//
// L1-local bounded reader for owner dry-run format inspection. It reads
// ONLY the explicitly selected lab record through an injected backend
// adapter and returns allowlisted schema/version/capability categories.
// It performs no refresh, mint, provider call, GitHub write, custody
// transfer, or activation, and never falls back to the live home, keyring,
// or environment. Unsupported fields and backends return an
// unverified/refused result, never raw values.

import type { SeatCli } from '../enrollment/seat-bundle.js';

/** Explicit lab-record selector; daily profiles are never a default. */
export interface SeatRecordSelector {
  cli: SeatCli;
  profileLabel: string;
}

/** Allowlisted categories only — no credential bytes, paths, or secrets. */
export interface SeatStoreRecordDescriptor {
  cli: SeatCli;
  profileLabel: string;
  backend: 'keyring' | 'file' | 'credential-manager' | 'keychain' | 'synthetic';
  schemaVersion: string | null;
  credentialClass: 'renewable' | 'static-key' | 'access-only' | 'unknown';
  refreshCapable: boolean | null;
  supported: boolean;
  reason?: string;
}

/** Injected backend adapter; tests supply synthetic backends. */
export interface SeatStoreBackend {
  readonly cli: SeatCli;
  readonly backend: SeatStoreRecordDescriptor['backend'];
  readSelectedRecord(selector: SeatRecordSelector): Promise<Omit<
    SeatStoreRecordDescriptor, 'cli' | 'profileLabel' | 'backend'
  > | null>;
}

export class SeatStoreReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeatStoreReadError';
  }
}

const CLIS: readonly SeatCli[] = ['agy', 'codex', 'vibe', 'muse', 'claude'];

/** Inspect one explicitly selected lab record; no live-home fallback. */
export async function inspectSeatStoreRecord(
  backends: readonly SeatStoreBackend[],
  selector: SeatRecordSelector,
): Promise<SeatStoreRecordDescriptor> {
  if (!CLIS.includes(selector.cli)) {
    throw new SeatStoreReadError(`unsupported CLI: ${String(selector.cli)}`);
  }
  if (typeof selector.profileLabel !== 'string' || selector.profileLabel.length === 0) {
    throw new SeatStoreReadError('a non-empty lab profile label is required');
  }
  const backend = backends.find((candidate) => candidate.cli === selector.cli);
  if (!backend) {
    return {
      cli: selector.cli,
      profileLabel: selector.profileLabel,
      backend: 'synthetic',
      schemaVersion: null,
      credentialClass: 'unknown',
      refreshCapable: null,
      supported: false,
      reason: 'no backend registered for this CLI',
    };
  }
  const record = await backend.readSelectedRecord(selector);
  if (!record) {
    return {
      cli: selector.cli,
      profileLabel: selector.profileLabel,
      backend: backend.backend,
      schemaVersion: null,
      credentialClass: 'unknown',
      refreshCapable: null,
      supported: false,
      reason: 'selected lab record not found',
    };
  }
  // Forward allowlisted categories only; a backend must never smuggle
  // credential material through extra or nested fields.
  return {
    cli: selector.cli,
    profileLabel: selector.profileLabel,
    backend: backend.backend,
    schemaVersion: record.schemaVersion,
    credentialClass: record.credentialClass,
    refreshCapable: record.refreshCapable,
    supported: record.supported,
    ...(record.reason !== undefined ? { reason: record.reason } : {}),
  };
}
