// Mode (b) artifact store: the "write" is the build step. It RE-VALIDATES (injected envelope validator) and NEVER rebuilds.
// Integrity bytes source (spec §5, mode (b)): JCS(payload) of the sealed envelope, hashed through DigestPort at build.
// At runtime only the registry metadata is checked (loadRegistry); no payload re-hash exists in the GAS runtime.
import { StoreRefusedError } from './errors.js';
import type { DigestPort } from './digest.js';
import { payloadDigest } from './jcs.js';
import { assertNextVersion, loadRegistry, type RegistryEntry, type RegistryPort } from './registry.js';

export interface StorePins {
  readonly validatorSha256: string;
  readonly rendererSha256: string;
  /** Pin of the validator IIFE (G6, mode (a)); absent in S1 where no validator code ships in the runtime. */
  readonly validatorIifeSha256?: string;
}
export interface EnvelopeError {
  readonly path: string;
  readonly msg: string;
}
/** Build-time (Node) envelope validator, e.g. contracts/dossier-publish validate-dossier.mjs. Empty array = valid. */
export type EnvelopeValidator = (envelope: unknown) => readonly EnvelopeError[];

export interface PublishResult {
  readonly entry: RegistryEntry;
  /** false while payload.build is absent (R5 builder lot pending, CONTRACT r3.1 §8): pins could not be checked. */
  readonly buildChecked: boolean;
}

export function assertPinned(label: string, actualSha256: string, pinnedSha256: string): void {
  if (actualSha256 !== pinnedSha256) throw new StoreRefusedError('build_pin_mismatch', `${label} sha256 ${actualSha256} != pin ${pinnedSha256}`);
}

export function createBuildStore(input: {
  readonly digest: DigestPort;
  readonly tenantId: string;
  readonly pins: StorePins;
  readonly validate: EnvelopeValidator;
  readonly fileFor?: (id: string, version: number) => string;
  readonly initial?: readonly RegistryEntry[];
}) {
  const fileFor = input.fileFor || ((id: string, version: number) => 'dossiers/' + id + '-v' + version + '.html');
  const entries: RegistryEntry[] = (input.initial || []).slice();
  loadRegistry(entries); // an inconsistent starting registry refuses to start
  const latestOf = (id: string) => entries.reduce((m, e) => (e.id === id && e.version > m ? e.version : m), 0);
  return {
    publish(envelope: any): PublishResult {
      const errors = input.validate(envelope);
      if (errors.length > 0) throw new StoreRefusedError('envelope_invalid', errors.map((e) => e.path + ' ' + e.msg).join('; '));
      const artifact = envelope.artifact;
      const declared = envelope.integrity && envelope.integrity.payloadSha256;
      const actual = payloadDigest(input.digest, envelope.payload);
      if (actual.sha256 !== declared) throw new StoreRefusedError('integrity_mismatch', 'payloadSha256 != sha256(JCS(payload))');
      const build = envelope.payload && envelope.payload.build;
      if (build !== undefined) {
        if (!build || build.validatorSha256 !== input.pins.validatorSha256) throw new StoreRefusedError('build_pin_mismatch', 'payload.build.validatorSha256');
        if (build.rendererSha256 !== input.pins.rendererSha256) throw new StoreRefusedError('build_pin_mismatch', 'payload.build.rendererSha256');
      }
      assertNextVersion(artifact.id, latestOf(artifact.id), artifact.version);
      const entry: RegistryEntry = {
        id: artifact.id,
        version: artifact.version,
        tenantId: input.tenantId,
        file: fileFor(artifact.id, artifact.version),
        title: artifact.title,
        createdAt: artifact.createdAt,
        payloadSha256: actual.sha256,
        bytes: actual.bytes,
      };
      loadRegistry(entries.concat([entry])); // same predicate and shape checks as the runtime load
      entries.push(entry);
      return { entry, buildChecked: build !== undefined };
    },
    entries: (): RegistryEntry[] => entries.slice(),
    registry: (): RegistryPort => loadRegistry(entries),
    /** Deterministic Registry.js text: sorted by (id, version), fixed key order, LF. */
    toRegistryJs(): string {
      const sorted = entries.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version - b.version));
      const rows = sorted.map((e) => JSON.stringify({ id: e.id, version: e.version, tenantId: e.tenantId, file: e.file, title: e.title, createdAt: e.createdAt, payloadSha256: e.payloadSha256, bytes: e.bytes }));
      return 'var REGISTRY_ENTRIES = [\n' + rows.join(',\n') + '\n];\n';
    },
  };
}
