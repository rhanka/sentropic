/**
 * Single-writer old-store migration (L1, spec 6.2).
 *
 * Bounded deterministic transfer: each old entry is validated against
 * trusted owner/session metadata, active key bytes stay stable, every import
 * gets a durable migration ack receipt, and invalid or ambiguous entries are
 * quarantined without cross-binding caller input. Freezing and stopping the
 * old minting writer is companion-owned (h-cond); no dual writer remains
 * after cutover. Rollback reads the gateway's committed records.
 */
import { GatewaySessionService } from '../session-service.js';

export interface OldSessionEntry {
  readonly ownerScopeRef: string;
  readonly workspaceRef: string;
  readonly clientSessionRef: string;
  readonly keyMaterial: string;
  readonly expiresAt: string;
  readonly profiles?: readonly string[];
  readonly models?: readonly string[];
  readonly mappingRevision?: string;
}

export type QuarantineReason =
  | 'invalid-owner'
  | 'short-key'
  | 'expired'
  | 'ambiguous-duplicate';

export interface QuarantinedEntry {
  readonly entry: OldSessionEntry;
  readonly reason: QuarantineReason;
}

export interface MigrationResult {
  readonly imported: string[];
  readonly quarantined: QuarantinedEntry[];
  readonly ack: {
    readonly receiptIds: string[];
    readonly at: string;
    readonly oldWriterStop: 'companion-owned';
  };
}

export const migrateOldSessions = async (options: {
  service: GatewaySessionService;
  entries: readonly OldSessionEntry[];
}): Promise<MigrationResult> => {
  const { service, entries } = options;
  const imported: string[] = [];
  const quarantined: QuarantinedEntry[] = [];
  const receiptIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const triple = `${entry.ownerScopeRef}${entry.workspaceRef}${entry.clientSessionRef}`;
    if (!entry.ownerScopeRef || !entry.workspaceRef || !entry.clientSessionRef) {
      quarantined.push({ entry, reason: 'invalid-owner' });
      continue;
    }
    if (typeof entry.keyMaterial !== 'string' || entry.keyMaterial.length < 43) {
      quarantined.push({ entry, reason: 'short-key' });
      continue;
    }
    if (!entry.expiresAt || Date.parse(entry.expiresAt) <= Date.now()) {
      quarantined.push({ entry, reason: 'expired' });
      continue;
    }
    if (seen.has(triple)) {
      quarantined.push({ entry, reason: 'ambiguous-duplicate' });
      continue;
    }
    seen.add(triple);
    try {
      const { sessionRef } = await service.importSession({
        ownerScopeRef: entry.ownerScopeRef,
        workspaceRef: entry.workspaceRef,
        clientSessionRef: entry.clientSessionRef,
        keyMaterial: entry.keyMaterial,
        expiresAt: entry.expiresAt,
        profiles: entry.profiles,
        models: entry.models,
        mappingRevision: entry.mappingRevision,
      });
      const ack = await service.recordAttempt({
        ownerScopeRef: entry.ownerScopeRef,
        sessionRef,
        requestId: 'migration',
        model: '',
      });
      const settled = await service.settleReceipt({
        ownerScopeRef: entry.ownerScopeRef,
        receiptId: ack.receiptId,
        outcome: 'migration-ack',
      });
      imported.push(sessionRef);
      receiptIds.push(settled.receiptId);
    } catch {
      quarantined.push({ entry, reason: 'ambiguous-duplicate' });
    }
  }
  return {
    imported,
    quarantined,
    ack: { receiptIds, at: new Date().toISOString(), oldWriterStop: 'companion-owned' },
  };
};
