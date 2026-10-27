// C0 gate: Comments contract boundaries, frozen-M1 preservation,
// compatibility and extension manifest validation (L3a v4.1 frozen §17 row C0, §17.4).
// Hash pins are DERIVED from docs/comments-annotations/contract/contract-v1.json
// (frozen M1 corpus under packages/comments/); the error vocabulary is DERIVED
// from the frozen M1 sources (commands.ts, command-store.ts). Any drift fails.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isStorageModuleId,
  STORAGE_MODULE_IDS,
} from '../src/storage/contracts.js';
import {
  validateModuleDescriptor,
  type ModuleDescriptor,
} from '../src/storage/descriptor.js';
import {
  CONSUMER_REQUIREMENTS,
  isProfileId,
  missingProfiles,
  satisfiesRequirements,
} from '../src/storage/profiles.js';
// Frozen M1 error vocabularies are parsed from the frozen sources
// (commands.ts, command-store.ts). Root/storage stay domain-neutral;
// the selected comments leaf may load its optional peer (§14.5).

// Resolve repository root from test location
const REPO_ROOT = resolve(__dirname, '../../..');

const CONTRACT_PATH = 'docs/comments-annotations/contract/contract-v1.json';
const FREEZE_RECEIPT_PATH = 'docs/comments-annotations/contract/freeze-receipt.md';
const MANIFEST_PATH = 'docs/comments-annotations/contract/storage-module-v1.json';
const DOC_PATH = 'docs/comments-annotations/contract/storage-compatibility.md';

const sha256File = (relPath: string): string => {
  const absPath = resolve(REPO_ROOT, relPath);
  const bytes = readFileSync(absPath);
  return createHash('sha256').update(bytes).digest('hex');
};

/**
 * Derive every frozen-M1 corpus pin from contract-v1.json. Only entries under
 * packages/comments/ are collected: .h2a review/build evidence is local
 * ignored provenance, and spec/plan/BRANCH references evolve on documentary
 * branches. Composition: 1 package manifest + 19 src modules + 1 hash vector
 * + 8 conformance files (2 runners + 6 suites) = 29 entries.
 */
const collectM1CorpusPins = (): Readonly<Record<string, string>> => {
  const contract = JSON.parse(readFileSync(resolve(REPO_ROOT, CONTRACT_PATH), 'utf8')) as unknown;
  const pins: Record<string, string> = {};
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (
        typeof record.path === 'string' &&
        typeof record.sha256 === 'string' &&
        record.path.startsWith('packages/comments/')
      ) {
        pins[record.path] = record.sha256;
      }
      for (const value of Object.values(record)) visit(value);
    }
  };
  visit(contract);
  return pins;
};

export const EXPECTED_M1_CORPUS_COUNT = 29;

// The frozen contract excludes package delivery/dependency closure. Accept only
// the digest-bound Zod migration whose two exact edits recover the original bytes.
const verifyPackageMigration = (text: string, expectedHash: string): boolean => {
  const receipt = JSON.parse(readFileSync(resolve(REPO_ROOT,
    'docs/comments-annotations/contract/package-zod4-migration.json'), 'utf8'));
  const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
  if (receipt.baselineSha256 !== expectedHash || receipt.migratedSha256 !== hash(text)) return false;
  const baseline = text
    .replace('"version": "0.3.1"', '"version": "0.3.0"')
    .replace('"zod": "^4.6.6"', '"zod": "^3.25.76"');
  return hash(baseline) === expectedHash;
};

/** Real verification function: returns the rel paths whose bytes miss their pin. */
export const verifyHashPins = (pins: Readonly<Record<string, string>>): readonly string[] => {
  const mismatches: string[] = [];
  for (const [relPath, expectedHash] of Object.entries(pins)) {
    const absPath = resolve(REPO_ROOT, relPath);
    if (!existsSync(absPath)) { mismatches.push(relPath); continue; }
    if (sha256File(relPath) === expectedHash) continue;
    if (relPath === 'packages/comments/package.json'
      && verifyPackageMigration(readFileSync(absPath, 'utf8'), expectedHash)) continue;
    mismatches.push(relPath);
  }
  return mismatches;
};

/** Parse the CanonicalCommandError code union out of the frozen commands.ts. */
const parseCommandErrorCodes = (): readonly string[] => {
  const src = readFileSync(resolve(REPO_ROOT, 'packages/comments/src/commands.ts'), 'utf8');
  const anchor = 'public readonly code:';
  const start = src.indexOf(anchor);
  expect(start, 'CanonicalCommandError code union anchor in frozen commands.ts').toBeGreaterThanOrEqual(0);
  const end = src.indexOf('message: string,', start);
  const block = src.slice(start, end);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

/** Parse the CANONICAL_WIRE_ERROR_CODES array out of the frozen command-store.ts. */
const parseWireErrorCodes = (): readonly string[] => {
  const src = readFileSync(resolve(REPO_ROOT, 'packages/comments/src/command-store.ts'), 'utf8');
  const anchor = 'export const CANONICAL_WIRE_ERROR_CODES = [';
  const start = src.indexOf(anchor);
  expect(start, 'CANONICAL_WIRE_ERROR_CODES anchor in frozen command-store.ts').toBeGreaterThanOrEqual(0);
  const end = src.indexOf('] as const;', start);
  const block = src.slice(start, end);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

const listFiles = (dir: string, suffixes = ['.ts']): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, suffixes));
    else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) out.push(abs);
  }
  return out;
};

const runtimeImportViolations = (file: string, source: string): string[] => {
  const mesh = resolve(REPO_ROOT, 'packages/cluster-mesh');
  const comments = resolve(REPO_ROOT, 'packages/comments');
  const within = (path: string, dir: string): boolean => path === dir || path.startsWith(dir + '/');
  const inMesh = within(file, mesh);
  const protectedMesh = file === resolve(mesh, 'src/index.ts') || within(file, resolve(mesh, 'src/storage'));
  return [...source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((target) => {
      const resolved = target.startsWith('.') ? resolve(dirname(file), target) : '';
      const peer = inMesh ? '@sentropic/comments' : '@sentropic/cluster-mesh';
      const peerImport = target === peer || target.startsWith(peer + '/');
      // Checkout imports cross package ownership regardless of the selected leaf.
      const checkoutImport = within(resolved, inMesh ? comments : mesh);
      return checkoutImport || (peerImport && (!inMesh || protectedMesh));
    })
    .map((target) => file + ': ' + target);
};

const DOC_RESIDUE_RULES = [
  ['m1-authoring', /being authored now|freeze authoring now|At P1 exit, comments maintainers produce|Before M2 relies[^\n]*establish this baseline|Lot 1 additionally freezes|Lot 1 must align/],
  ['m1-inventory', /Lot 1 manifest|initial manifest directly (?:records|declares)|frozen manifest declares[^\n]*cluster-mesh implementation\/export mapping|src\/conformance\/index\.ts|includes the proposed\s+\x60?@sentropic\/comments\/conformance/],
  ['m1-representation', /Replace \x60?specDigest\x60? with|\x60?specDigest\x60? replaced by|Add [^\n]*to \x60?CapacityDescriptor|Lot 1 (?:adds fragment|freezes the transport)/],
  ['postgres-placement', /live-storage\/|live-postgres-\{(?:contract|parity,recovery)|L3b-S and the proposed L3b-P/],
  ['sqlite-gate', /fixtures\/comments\/\{sqlite,pg\}|SQLite(?:\/|\s+and\s+)Postgres\s+parity|(?:shared|neutral|real|same) SQLite\/Postgres|round-trip on SQLite\/Postgres|both shared backends|L3b-S qualification|qualified L3b-S|L3b-S\/L3b-P: SQLite\/Postgres/],
  ['live-gate', /live-sqlite-runtime\.spec\.ts|live-store-\{contract,qualification|live generation[^\n]*publication|(?:requires|entry requires|gate:?)\s+live generation|generation fencing(?:\/pinned reads| and common migration)|generations\/migrations|generation\/CAS change/],
  ['invented-handoff', /freeze receipt and host acknowledgement exist|acknowledged freeze receipt \(2dabe25ce/],
  ['confirmation-citation', /§17\.4 \(confirmation items G1–G5\)/],
  ['mandatory-app-journal', /Sentropic binds to existing \x60control\.event_outbox|Bind the transactional change-log port to the existing outbox/],
  ['unconditional-purge', /Record purge intent in the tombstone transaction/],
] as const;

const stripHistoricalExcerpts = (content: string): string =>
  content.replace(/<!--\s*historical-excerpt-start\s*-->[\s\S]*?<!--\s*historical-excerpt-end\s*-->/g, '');

const documentationViolations = (content: string): string[] => {
  const clean = stripHistoricalExcerpts(content);
  return DOC_RESIDUE_RULES.filter(([, pattern]) => pattern.test(clean)).map(([id]) => id);
};

const listAlignmentDocuments = (): string[] => [
  ...listFiles(resolve(REPO_ROOT, 'docs/comments-annotations'), ['.md', '.json'])
    .filter((file) => ![CONTRACT_PATH, FREEZE_RECEIPT_PATH].some((frozen) => file === resolve(REPO_ROOT, frozen))),
  resolve(REPO_ROOT, 'spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md'),
];

const readManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(REPO_ROOT, MANIFEST_PATH), 'utf8')) as Record<string, unknown>;

describe('C0 exit proof: Frozen-M1 preservation', () => {
  it('accepts only the pinned dependency migration and rejects export drift or downgrade', () => {
    const text = readFileSync(resolve(REPO_ROOT, 'packages/comments/package.json'), 'utf8');
    const baseline = collectM1CorpusPins()['packages/comments/package.json'];
    expect(verifyPackageMigration(text, baseline)).toBe(true);
    expect(verifyPackageMigration(text.replace('./dist/index.js', './dist/other.js'), baseline)).toBe(false);
    expect(verifyPackageMigration(text.replace('^4.6.6', '^3.25.76'), baseline)).toBe(false);
    expect(verifyPackageMigration(text, '0'.repeat(64))).toBe(false);
  });

  it('pins the complete frozen M1 corpus derived from contract-v1.json', () => {
    const pins = collectM1CorpusPins();
    expect(Object.keys(pins)).toHaveLength(EXPECTED_M1_CORPUS_COUNT);
    // All 8 conformance files hashed by contract-v1.json are pinned.
    for (const suite of [
      'packages/comments/tests/conformance/comments-conformance.ts',
      'packages/comments/tests/conformance/in-memory.ts',
      'packages/comments/tests/annotation-conformance.spec.ts',
      'packages/comments/tests/revision-hash.spec.ts',
      'packages/comments/tests/annotation-anchors.spec.ts',
      'packages/comments/tests/annotation-revisions.spec.ts',
      'packages/comments/tests/annotation-reviews.spec.ts',
      'packages/comments/tests/annotation-retention.spec.ts',
    ]) {
      expect(pins, `conformance file missing from derived pins: ${suite}`).toHaveProperty(suite);
    }
    expect(verifyHashPins(pins)).toEqual([]);
  });

  it('manifest base-contract digests match the frozen contract file bytes', () => {
    const manifest = readManifest();
    const baseContract = manifest.baseContract as Record<string, unknown>;
    expect(baseContract.sha256).toBe(sha256File(CONTRACT_PATH));
    expect(baseContract.freezeReceiptSha256).toBe(sha256File(FREEZE_RECEIPT_PATH));
    expect(baseContract.contractVersion).toBe('contract-v1');
    expect(baseContract.freezeCommit).toBe('7b8e5daf022cc58819dfdfae43cd89a703a82f96');
  });

  it('verifyHashPins reports exactly the tampered entries', () => {
    const pins = collectM1CorpusPins();
    expect(verifyHashPins(pins)).toEqual([]);
    const tampered = {
      ...pins,
      'packages/comments/src/index.ts': '0000000000000000000000000000000000000000000000000000000000000000',
    };
    expect(verifyHashPins(tampered)).toEqual(['packages/comments/src/index.ts']);
    expect(verifyHashPins({ 'packages/comments/src/does-not-exist.ts': '00' })).toEqual([
      'packages/comments/src/does-not-exist.ts',
    ]);
  });

  it('preserves M1 24 store methods, 11 record kinds and derived error vocabulary', () => {
    const contract = JSON.parse(readFileSync(resolve(REPO_ROOT, CONTRACT_PATH), 'utf8')) as {
      contractVersion: string;
      hashVersion: string;
      status: string;
      recordKinds: { kind: string }[];
    };
    expect(contract.contractVersion).toBe('contract-v1');
    expect(contract.hashVersion).toBe('revision-hash-v1');
    expect(contract.status).toBe('frozen');

    const expectedKinds = [
      'annotation-revision',
      'thread-structure-revision',
      'comment-revision',
      'review-event',
      'prepared-submission-manifest',
      'import-manifest',
      'unit-receipt',
      'batch-receipt-snapshot',
      'lifecycle-event',
      'operation-audit-event',
      'conversion-report',
    ];
    expect(contract.recordKinds.map((r) => r.kind).sort()).toEqual([...expectedKinds].sort());

    const manifest = readManifest();
    const preservation = manifest.frozenM1Preservation as Record<string, unknown>;
    expect(preservation.methodsCount).toBe(24);
    expect(preservation.recordKindsCount).toBe(11);
    expect(preservation.unmodifiedSources).toBe(true);
    expect([...(preservation.recordKinds as string[])].sort()).toEqual([...expectedKinds].sort());

    // B1: the manifest vocabulary is derived from the frozen M1 sources.
    const vocabulary = preservation.errorVocabulary as {
      commandErrors: string[];
      wireErrors: string[];
    };
    expect([...parseCommandErrorCodes()].sort()).toEqual([...vocabulary.commandErrors].sort());
    const wireCodes = parseWireErrorCodes();
    expect([...wireCodes].sort()).toEqual([...vocabulary.wireErrors].sort());
    expect(vocabulary.commandErrors).toEqual([
      'cas-conflict',
      'idempotency-conflict',
      'denied',
      'invalid-command',
      'not-found',
    ]);
    expect(vocabulary.wireErrors).toEqual([
      'unauthenticated',
      'denied',
      'not-found',
      'conflict',
      'invalid-request',
      'capacity-exceeded',
      'incomplete',
    ]);
  });
});

describe('C0 exit proof: Storage compatibility and extension manifest', () => {
  it('storage-module-v1.json declares the C0 manifest with K1 profile requirements', () => {
    const manifest = readManifest();
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.contractVersion).toBe('storage-module-v1');
    expect(manifest.targetModule).toBe('comments');
    expect(manifest.status).toBe('unverified');

    const profiles = manifest.profiles as Record<string, readonly string[]>;
    expect(profiles.required).toEqual(CONSUMER_REQUIREMENTS['m1-adapter']);
    expect(profiles.operational).toEqual(CONSUMER_REQUIREMENTS['comments-operational']);
    expect(profiles.c4).toEqual(CONSUMER_REQUIREMENTS['comments-c4']);
    expect(profiles.purge).toEqual(CONSUMER_REQUIREMENTS['comments-purge']);
    for (const profile of [...profiles.required, ...profiles.operational, ...profiles.c4, ...profiles.purge]) {
      expect(isProfileId(profile)).toBe(true);
    }

    const extensions = manifest.extensions as Record<string, Record<string, unknown>>;
    expect(extensions.transport.version).toBe('transport-v1');
    expect(extensions.transport.stagedUnitsProfile).toBe('staged-units-v1');
    expect(extensions.transport.continuationEnvelopeExplicit).toBe(true);
    expect(extensions.transport.overloadFrozenDto).toBe(false);
    expect(extensions.queryProfiles).toEqual(['by-resource', 'scope-chain-index', 'retained-headers']);
  });

  it('transport declares the exact §11.3 limits, admission settings and module operations', () => {
    const manifest = readManifest();
    const transport = (manifest.extensions as Record<string, Record<string, unknown>>).transport as {
      qualification: string;
      limits: Record<string, number | null>;
      byteUnits: string;
      pagingSemantics: Record<string, string>;
      recordFramingRule: string;
      proposedHostInjectedBounds: Record<string, unknown>;
      transportQualificationRequirement: string;
      admission: Record<string, number>;
      incompatibilityRule: string;
      moduleOperations: string[];
    };
    expect(transport.qualification).toBe('unverified');
    expect(transport.limits).toEqual({
      fragmentManifestOrUnitGroupRootBytes: 65536,
      fragmentPayloadBytes: 524288,
      prepareCommitItemsPerRequest: 50,
      requestBatchManifestBytes: 262144,
      completeEncodedRequestBytes: 1048576,
      defaultPageCount: 50,
      maxPageCount: 100,
      completeEncodedPageBytes: 1048576,
      commentsCursorTtlSeconds: null,
    });
    expect(transport.byteUnits).toBe('canonical bytes');
    expect(transport.pagingSemantics).toEqual({
      ordinaryPages: 'Ordinary pages count canonical records',
      fragmentPages: 'Fragment pages count complete fragment envelopes',
      byteLimitsInclusion: 'Both count the full response envelope and cursor toward byte limits',
    });
    expect(transport.recordFramingRule).toBe(
      'Whole histories have no fragment-sized ceiling. A record plus required framing must fit an individual fragment.',
    );
    expect(transport.proposedHostInjectedBounds).toEqual({
      bodyBytes: 65536,
      segmentBytes: 16384,
      profileBytes: 16384,
      units: 'canonical bytes',
      note: 'Existing M1 body/segment/profile bounds remain host-injected; CA proposed values are 64 KiB, 16 KiB and 16 KiB respectively.',
    });
    expect(transport.transportQualificationRequirement).toBe(
      'Transport qualification must include escaping and multibyte encoding.',
    );
    expect(transport.admission).toEqual({
      segmentsPerBody: 64,
      mentionsPerBody: 64,
      profileDepth: 8,
      targetsPerAnnotation: 32,
      shapesPerAnnotation: 128,
    });
    expect(transport.incompatibilityRule).toContain('incompatibility');
    expect(transport.moduleOperations).toEqual([
      'prepareImportFragment',
      'inspectPreparedImport',
      'commitPreparedImport',
      'prepareExportBoundary',
      'continueExport',
      'readExportFragments',
      'recoverBatchReceipts',
    ]);

    const capacity = (
      manifest.extensions as Record<string, Record<string, Record<string, unknown>>>
    ).capacityDescriptor;
    expect(capacity.status).toBe('supplemental-module-settings');
    expect(capacity.defaults).toEqual({ defaultRecords: 50, cursorTtlSeconds: null });
  });

  it('oracle packaging claims no comments conformance export', () => {
    const manifest = readManifest();
    const oracle = (manifest.extensions as Record<string, Record<string, unknown>>)
      .oraclePackaging as Record<string, unknown>;
    expect(oracle.qualification).toBe('unverified');
    expect(oracle.conformanceExportLocation).toBe('unverified');
    expect(oracle.commentsConformanceExportClaimed).toBe(false);
    expect(oracle.digestPinnedArchiveRequired).toBe(true);
    expect(oracle.mutatesFrozenM1Exports).toBe(false);
    expect(oracle).not.toHaveProperty('conformancePackage');
    expect(oracle).not.toHaveProperty('conformanceExport');

    // The frozen comments package map exposes no ./conformance export.
    const commentsPackage = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'packages/comments/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    expect(commentsPackage.exports).not.toHaveProperty('./conformance');
  });

  it('storage-compatibility.md documents the frozen signatures and boundaries', () => {
    const doc = readFileSync(resolve(REPO_ROOT, DOC_PATH), 'utf8');
    expect(doc).toContain('storage-module-v1');
    expect(doc).toContain('contract-v1.json');
    expect(doc).toContain('e027fdbb4a806df39809326697bf9b60ad5cb977eb1988af3be293da07161ba0');
    expect(doc).toContain('CanonicalTransactionHandle');
    expect(doc).toContain('run<T>(operation');
    expect(doc).toContain('cas-conflict');
    expect(doc).toContain('idempotency-conflict');
    expect(doc).toContain('unauthenticated');
    expect(doc).toContain('invalid-request');
    expect(doc).toContain('incomplete');
    expect(doc).toContain('64 KiB');
    expect(doc).toContain('512 KiB');
    expect(doc).toContain('not an existing export');
    expect(doc).toContain('installed qualification target');
    expect(doc).toContain('by-resource');
    expect(doc).toContain('scope-chain-index');
    expect(doc).toContain('retained-headers');
    expect(doc).toContain('transport-v1');
    expect(doc).toContain('staged-units-v1');
    expect(doc).toContain('canonical bytes');
    expect(doc).toContain('record plus required framing');
    expect(doc).toContain('escaping and multibyte encoding');
    expect(doc).toContain('frozen L3a v4.1 §17.2 row C0');
  });

  it('production roots and storage stay decoupled while comments leaves may load their peer', () => {
    const files = [
      ...listFiles(resolve(REPO_ROOT, 'packages/cluster-mesh/src')),
      ...listFiles(resolve(REPO_ROOT, 'packages/comments/src')),
    ];
    expect(files.flatMap((file) => runtimeImportViolations(file, readFileSync(file, 'utf8')))).toEqual([]);
  });

  it.each([
    ['cluster-mesh/src/index.ts', '@sentropic/comments', true],
    ['cluster-mesh/src/storage/kernel.ts', '@sentropic/comments', true],
    ['cluster-mesh/src/storage/postgres/index.ts', '../../../../comments/src/index.js', true],
    ['cluster-mesh/src/comments/index.ts', '../../../comments/src/index.js', true],
    ['comments/src/index.ts', '@sentropic/cluster-mesh/storage', true],
    ['comments/src/index.ts', '../../cluster-mesh/src/storage/index.js', true],
    ['cluster-mesh/src/comments/index.ts', '@sentropic/comments', false],
    ['cluster-mesh/src/loaders/comments/index.ts', '../../comments/module.js', false],
    ['cluster-mesh/src/compose/comments.ts', '../comments/index.js', false],
    ['cluster-mesh/src/storage/kernel.ts', './contracts.js', false],
  ])('should classify the import from %s to %s by its resolved boundary', (file, target, blocked) => {
    for (const source of [
      "import { value } from '" + target + "';",
      'export { value } from "' + target + '";',
      "const value = import('" + target + "');",
      "import '" + target + "';",
      "const value = require('" + target + "');",
    ]) {
      expect(runtimeImportViolations(resolve(REPO_ROOT, 'packages', file), source).length > 0).toBe(blocked);
    }
  });

  it('validates a ModuleDescriptor over the 11 frozen kinds within transport bounds', () => {
    const contract = JSON.parse(readFileSync(resolve(REPO_ROOT, CONTRACT_PATH), 'utf8')) as {
      recordKinds: { kind: string }[];
    };
    const descriptor: ModuleDescriptor = {
      contractVersion: 'contract-v1',
      contractDigest: sha256File(CONTRACT_PATH),
      schemaVersions: ['1.0.0'],
      requiredProfiles: CONSUMER_REQUIREMENTS['m1-adapter'],
      optionalProfiles: ['scope-outbox-v1', 'visibility-barriers-v1', 'staged-units-v1', 'purge-jobs-v1', 'fenced-writers-v1'],
      chainKinds: contract.recordKinds.map((r) => r.kind),
      queryNames: ['by-resource', 'scope-chain-index', 'retained-headers'],
      boundaries: ['thread', 'annotation'],
      pageLimits: { maxRecords: 100, maxEncodedBytes: 1048576 },
    };

    const res = validateModuleDescriptor(descriptor);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('cluster-mesh storage contracts register comments as a known storage module', () => {
    expect(isStorageModuleId('comments')).toBe(true);
    expect(STORAGE_MODULE_IDS).toContain('comments');
  });

  it('cluster-mesh profiles satisfy m1-adapter, operational, and c4 consumer claims', () => {
    const fullAdvertised = [
      'atomic-units-v1',
      'immutable-chains-v1',
      'immutable-boundaries-v1',
      'scope-outbox-v1',
      'visibility-barriers-v1',
      'staged-units-v1',
      'purge-jobs-v1',
      'fenced-writers-v1',
    ] as const;

    expect(satisfiesRequirements(fullAdvertised, 'm1-adapter')).toBe(true);
    expect(satisfiesRequirements(fullAdvertised, 'comments-operational')).toBe(true);
    expect(satisfiesRequirements(fullAdvertised, 'comments-c4')).toBe(true);
    expect(satisfiesRequirements(fullAdvertised, 'comments-purge')).toBe(true);

    const minimal = ['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1'] as const;
    expect(satisfiesRequirements(minimal, 'm1-adapter')).toBe(true);
    expect(satisfiesRequirements(minimal, 'comments-operational')).toBe(false);
    expect(missingProfiles(minimal, CONSUMER_REQUIREMENTS['comments-operational'])).toEqual([
      'scope-outbox-v1',
      'visibility-barriers-v1',
    ]);
  });

  it.each([
    ["m1-authoring","Lot 1 must align SPEC §4.6 before freeze"],
    ["m1-representation","`specDigest` replaced by `specVersion`/`specSource`"],
    ["m1-authoring","the freeze receipt and host acknowledgement are being authored now"],
    ["m1-inventory","The initial Lot 1 manifest relies on the digest-pinned packaged conformance oracle"],
    ["m1-inventory","includes the proposed `@sentropic/comments/conformance` export"],
    ["m1-inventory","proposed `src/conformance/index.ts`, package exports/surface"],
    ["m1-inventory","The frozen manifest declares the cluster-mesh implementation/export mapping"],
    ["m1-representation","Replace `specDigest` with `specVersion`/`specSource`"],
    ["m1-representation","Add `readonly paging: { ... }` to `CapacityDescriptor`"],
    ["postgres-placement","`packages/cluster-mesh/src/live-storage/{postgres,postgres-executor,postgres-migrations}.ts`"],
    ["postgres-placement","`live-postgres-{contract,parity,recovery,exports}.spec.ts`"],
    ["sqlite-gate","| M2 | not L3b-S SQLite; prove shared SQLite/Postgres parity |"],
    ["sqlite-gate","| M2 | fixtures/comments/{sqlite,pg}/** |"],
    ["sqlite-gate","| M3 | round-trip on SQLite/Postgres |"],
    ["sqlite-gate","L3b-S/L3b-P: SQLite/Postgres + migrations"],
    ["live-gate","| M2 | generation fencing/pinned reads |"],
    ["live-gate","Required upstream evidence: `tests/live-sqlite-runtime.spec.ts` before M2 entry"],
    ["invented-handoff","the freeze receipt and host acknowledgement exist on feat/comments-annotations-model"],
    ["confirmation-citation","§17.4 (confirmation items G1–G5)"],
    ["mandatory-app-journal","Sentropic binds to existing `control.event_outbox`"],
    ["unconditional-purge","Record purge intent in the tombstone transaction"],
  ])('should detect %s in the original contradictory text: %s', (rule, original) => {
    expect(documentationViolations(original)).toContain(rule);
  });

  it.each([
    ["sqlite-gate", "| M2 | prove SQLite/Postgres parity before entry |"],
    ["postgres-placement", "M2 entry requires packages/cluster-mesh/src/live-storage/index.ts"],
    ["sqlite-gate", "M2 gate: SQLite and Postgres parity"],
    ["live-gate", "M2 requires live generation publication"],
    ["m1-inventory", "Lot 1 manifest declares the packaged oracle"],
  ])('should detect %s in the reformulated probe: %s', (rule, probe) => {
    expect(documentationViolations(probe)).toContain(rule);
  });

  it('should exclude explicitly marked historical review excerpts while detecting outside residues', () => {
    const historicalBlock = [
      '# Active section',
      'Valid active text.',
      '<!-- historical-excerpt-start -->',
      '| M2 | prove SQLite/Postgres parity before entry |',
      '<!-- historical-excerpt-end -->',
    ].join('\n');
    expect(documentationViolations(historicalBlock)).toEqual([]);

    const contaminatedBlock = [
      '# Active section',
      'M2 gate: SQLite and Postgres parity',
      '<!-- historical-excerpt-start -->',
      'Historical quote',
      '<!-- historical-excerpt-end -->',
    ].join('\n');
    expect(documentationViolations(contaminatedBlock)).toContain('sqlite-gate');
  });

  it('should accept independent qualification and separate extension declarations', () => {
    expect(documentationViolations([
      'M2 requires the reviewed common contract and selected qualified Postgres profiles.',
      'C3 separately qualifies comments on SQLite; live generations and Q do not gate PG delivery.',
      'C0 declares unverified oracle packaging; @sentropic/comments/conformance is not an existing export.',
      'Preserve specDigest and CapacityDescriptor; module settings and transport are separate.',
      'The package journal is default; Sentropic outbox is an optional qualified M5-S binding.',
      'Purge intent requires effective policy and purge authority.',
      'Host acknowledgement remains due in the owner-closed receipt.',
    ].join('\n'))).toEqual([]);
  });

  it('should accept reformulated safe text conforming to §18.2', () => {
    expect(documentationViolations([
      'M2 consumes selected qualified Postgres profiles; SQLite is qualified separately in C3.',
      'Reusable storage resides under packages/cluster-mesh/src/storage/postgres/.',
      'M2 entry requires pinned reviewed contracts; live generations are not a comments dependency.',
      'C0 manifest declares extension points; oracle packaging remains unverified until M4-I.',
      'Comments maintains domain semantics and default package journal.',
    ].join('\n'))).toEqual([]);
  });

  it('should keep every non-frozen comments document aligned with the frozen specification', () => {
    const docs = listAlignmentDocuments();
    expect(docs).toContain(resolve(REPO_ROOT, 'docs/comments-annotations/evidence/owner-decisions.md'));
    expect(docs).toContain(resolve(REPO_ROOT, 'docs/comments-annotations/contract/storage-module-v1.json'));
    expect(docs).not.toContain(resolve(REPO_ROOT, CONTRACT_PATH));
    expect(docs).not.toContain(resolve(REPO_ROOT, FREEZE_RECEIPT_PATH));
    for (const file of docs) {
      if (!file.includes('/evidence/')) {
        expect(readFileSync(file, 'utf8'), file).not.toContain('historical-excerpt-start');
      }
    }
    const violations = docs.flatMap((file) =>
      documentationViolations(readFileSync(file, 'utf8')).map((rule) => file + ': ' + rule));
    expect(violations).toEqual([]);
  });

  it('should retain journal, projection and explicit C4 obligations in all three plans', () => {
    const extensions = readManifest().extensions as { transport: { moduleOperations: string[] } };
    for (const name of ['PLAN_COMMENTS_ANNOTATIONS.md', 'PLAN_HANDOFF.md', 'BRANCH_P1_TEMPLATE.md']) {
      const content = readFileSync(resolve(REPO_ROOT, 'docs/comments-annotations/plan', name), 'utf8');
      expect(content, name).toMatch(/package journal.{0,30}default|default package journal/i);
      expect(content, name).toMatch(/outbox.{0,30}optional qualified|optional.{0,50}outbox/i);
      expect(content, name).toContain('projection assets');
      expect(content, name).toContain('host-history attachment');
      expect(content, name).toContain('C4');
      for (const operation of extensions.transport.moduleOperations) expect(content, name).toContain(operation);
    }
  });
});
