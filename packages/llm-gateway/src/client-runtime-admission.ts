/**
 * Published client runtime admission (L0, spec 7.3/10.1).
 *
 * Pure helper over the `tools/gateway-evolution/clients.json` inventory. The
 * manifest is an admission classification, never a qualification: unresolved
 * rows refuse, unknown runtimes refuse until distribution inspection proves
 * them, and Python runtimes stay owner-machine-only.
 */
export type VendorRuntimeKind = 'native' | 'node' | 'python' | 'unknown';
export type AdmissionContext = 'owner-machine' | 'private-job';

export interface VendorRuntime {
  readonly kind: VendorRuntimeKind;
  readonly version: string;
}

export interface ClientInventoryRow {
  readonly distribution: string;
  readonly version: string;
  readonly os: readonly string[];
  readonly digest: string;
  readonly status: string;
  readonly vendorRuntime: VendorRuntime;
  readonly launcherDependencies: readonly string[];
  readonly allowedContexts: readonly string[];
  readonly recipe: string;
}

export interface ClientsManifest {
  readonly schemaVersion: number;
  readonly clients: Record<string, ClientInventoryRow>;
}

export interface AdmissionDecision {
  readonly admitted: boolean;
  readonly reason: string;
}

export class ClientManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientManifestError';
  }
}

const MANIFEST_KEYS = new Set(['$comment', 'schemaVersion', 'clients']);
const ROW_KEYS = new Set([
  'distribution',
  'version',
  'os',
  'digest',
  'status',
  'vendorRuntime',
  'launcherDependencies',
  'allowedContexts',
  'recipe',
]);
const RUNTIME_KINDS: readonly string[] = ['native', 'node', 'python', 'unknown'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Closed manifest validation: unknown keys, kinds, or shapes fail, never pass. */
export const loadClientsManifest = (input: unknown): ClientsManifest => {
  if (!isRecord(input)) throw new ClientManifestError('manifest must be an object');
  for (const key of Object.keys(input)) {
    if (!MANIFEST_KEYS.has(key)) throw new ClientManifestError(`unknown manifest key: ${key}`);
  }
  if (input.schemaVersion !== 1) throw new ClientManifestError('manifest schemaVersion must be 1');
  if (!isRecord(input.clients) || Object.keys(input.clients).length === 0) {
    throw new ClientManifestError('manifest clients must be a nonempty map');
  }
  for (const [id, row] of Object.entries(input.clients)) {
    if (!isRecord(row)) throw new ClientManifestError(`client ${id} must be an object`);
    for (const key of Object.keys(row)) {
      if (!ROW_KEYS.has(key)) throw new ClientManifestError(`unknown client key: ${id}.${key}`);
    }
    const runtime = row.vendorRuntime;
    if (!isRecord(runtime) || typeof runtime.kind !== 'string') {
      throw new ClientManifestError(`client ${id} vendorRuntime.kind must be a string`);
    }
    if (!RUNTIME_KINDS.includes(runtime.kind)) {
      throw new ClientManifestError(`unknown vendorRuntime kind: ${id}.${runtime.kind}`);
    }
    if (!Array.isArray(row.allowedContexts) || row.allowedContexts.length === 0) {
      throw new ClientManifestError(`client ${id} allowedContexts must be nonempty`);
    }
  }
  return input as unknown as ClientsManifest;
};

/**
 * Admission for one inventory row in one execution context. A local pass
 * never qualifies a CI cell; receipts arrive with L4 owner-machine evidence.
 */
export const classifyClientRuntime = (
  row: ClientInventoryRow,
  context: AdmissionContext,
): AdmissionDecision => {
  if (row.vendorRuntime.kind === 'unknown') {
    return { admitted: false, reason: 'unknown-runtime, job-excluded-until-proven' };
  }
  if (row.status !== 'resolved' || !row.digest) {
    if (row.vendorRuntime.kind === 'python' && context === 'private-job') {
      return { admitted: false, reason: 'unqualified (python-runtime, job-excluded)' };
    }
    return { admitted: false, reason: 'unresolved-receipt' };
  }
  if (row.vendorRuntime.kind === 'python' && context === 'private-job') {
    return { admitted: false, reason: 'unqualified (python-runtime, job-excluded)' };
  }
  if (!row.allowedContexts.includes(context)) {
    return { admitted: false, reason: 'context-not-allowed' };
  }
  return { admitted: true, reason: 'resolved native/node row in an allowed context' };
};
