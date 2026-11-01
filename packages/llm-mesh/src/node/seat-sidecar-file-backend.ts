// @sentropic/llm-mesh/node/seat-sidecar-file-backend.ts
//
// L1 owner helper backend: reads an explicitly provided JSON sidecar file
// the owner exported for dry-run format inspection. No home probing, no
// default paths, no keyring or environment reads. Only allowlisted,
// bounded categories are returned; anything else is refused or unverified.

import { readFile } from 'node:fs/promises';

import type { SeatCli } from '../enrollment/seat-bundle.js';
import {
  SeatStoreReadError,
  type SeatRecordSelector,
  type SeatStoreBackend,
  type SeatStoreRecordDescriptor,
} from './cli-seat-store-reader.js';

/** Documented sidecar format: categories only, never credential material. */
export interface SeatSidecar {
  cli: SeatCli;
  profileLabel: string;
  schemaVersion: string;
  credentialClass: 'renewable' | 'static-key' | 'access-only';
  refreshCapable: boolean;
}

export const SEAT_SIDECAR_MAX_BYTES = 4096;
// Schema versions are machine labels, not free text: no spaces, quotes,
// or control characters that could smuggle content through the category.
const SCHEMA_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type Categories = Omit<SeatStoreRecordDescriptor, 'cli' | 'profileLabel' | 'backend'>;

/** Parse and validate sidecar categories; throws SeatStoreReadError without echoing content. */
export function parseSeatSidecar(raw: string): Categories {
  if (new TextEncoder().encode(raw).length > SEAT_SIDECAR_MAX_BYTES) {
    throw new SeatStoreReadError('sidecar exceeds the bounded size');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SeatStoreReadError('sidecar is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SeatStoreReadError('sidecar has no category record');
  }
  const record = parsed as Record<string, unknown>;
  const rawSchemaVersion = record['schemaVersion'];
  const schemaVersion =
    typeof rawSchemaVersion === 'string' && SCHEMA_VERSION_PATTERN.test(rawSchemaVersion)
      ? rawSchemaVersion
      : null;
  const credentialClass = record['credentialClass'];
  const refreshCapable = record['refreshCapable'];
  if (!schemaVersion) throw new SeatStoreReadError('sidecar has no bounded schema version');
  if (credentialClass !== 'renewable' && credentialClass !== 'static-key' && credentialClass !== 'access-only') {
    throw new SeatStoreReadError('sidecar has no known credential class');
  }
  if (typeof refreshCapable !== 'boolean') {
    throw new SeatStoreReadError('sidecar has no refresh capability flag');
  }
  return { schemaVersion, credentialClass, refreshCapable, supported: true };
}

/** File backend over one explicit owner-provided sidecar path. */
export class SeatSidecarFileBackend implements SeatStoreBackend {
  readonly cli: SeatCli;
  readonly backend = 'file' as const;
  private readonly sidecarPath: string;

  constructor(cli: SeatCli, sidecarPath: string) {
    if (!sidecarPath) throw new SeatStoreReadError('an explicit sidecar path is required');
    this.cli = cli;
    this.sidecarPath = sidecarPath;
  }

  async readSelectedRecord(selector: SeatRecordSelector): Promise<Categories | null> {
    let raw: string;
    try {
      raw = await readFile(this.sidecarPath, 'utf8');
    } catch {
      return null;
    }
    if (new TextEncoder().encode(raw).length > SEAT_SIDECAR_MAX_BYTES) {
      throw new SeatStoreReadError('sidecar exceeds the bounded size');
    }
    let sidecar: Partial<SeatSidecar>;
    try {
      sidecar = JSON.parse(raw) as Partial<SeatSidecar>;
    } catch {
      throw new SeatStoreReadError('sidecar is not JSON');
    }
    if (sidecar.cli !== selector.cli || sidecar.profileLabel !== selector.profileLabel) return null;
    return parseSeatSidecar(raw);
  }
}
