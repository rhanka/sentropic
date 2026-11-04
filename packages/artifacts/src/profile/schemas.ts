import type { ArtifactCapabilityName, ArtifactProviderProfile, EffectiveArtifactProfile, ArtifactSchema, OperationProfile } from './contracts.js';
import { SERVER_MAX_FILE_BYTES, SERVER_MAX_FILES_PER_RELEASE, SERVER_MAX_TOTAL_BYTES } from '../server/publication-limits.js';

const str = { type: 'string', minLength: 1 };
const integer = (minimum: number, maximum?: number) => ({ type: 'integer', minimum,
  ...(maximum === undefined ? {} : { maximum }) });
const obj = (properties: Record<string, unknown>, required: string[] = []): ArtifactSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const primitiveRecord = { type: 'object',
  additionalProperties: { type: ['string', 'number', 'boolean', 'null'] }, default: {} };
/** Artifact display metadata: one short word for the icon. */
const metadata = {
  title: { type: 'string', minLength: 1, maxLength: 160, description: 'Artifact display title.' },
  description: { type: 'string', maxLength: 2000, description: 'Short artifact description.' },
  icon: { type: ['string', 'null'], pattern: '^[a-z][a-z0-9-]{0,31}$',
    description: 'One short lowercase word.' },
} as const;

/** Required configuration includes semantic limits absent from JSON Schema. */
export function assertCompleteOperation(config: OperationProfile): void {
  const required: Record<string, { limits: string[]; defaults: string[] }> = {
    ensure: { limits: ['bindingNameMinUnits', 'bindingNameMaxUnits', 'idempotencyKeyMaxUnits'],
      defaults: ['parameters'] },
    // publish additionally accepts the optional release-budget keys
    // releaseFilesMax / releaseFileBytesMax / releaseTotalBytesMax (files parity
    // LOT 1): they bound the final release however its files arrived and default
    // to the inline values below when absent.
    publish: { limits: ['idempotencyKeyMaxUnits', 'publishFilesMin', 'publishFilesMax',
      'maxDecodedFileBytes', 'maxDecodedTotalBytes'], defaults: ['profile'] },
    list: { limits: ['listLimitMin', 'listLimitMax'], defaults: ['limit', 'offset'] },
    commit_upload: { limits: ['idempotencyKeyMaxUnits'], defaults: ['profile'] },
    publish_bundle: { limits: ['idempotencyKeyMaxUnits'], defaults: ['profile'] },
    create_upload_page: { limits: [], defaults: [] },
    list_assets: { limits: ['listAssetsLimitMin', 'listAssetsLimitMax'], defaults: ['limit'] },
    publish_bundle_v2: { limits: ['idempotencyKeyMaxUnits'], defaults: ['profile'] },
    set_access: { limits: ['idempotencyKeyMaxUnits'], defaults: [] },
    lookup_people: { limits: ['lookupQueryMinUnits', 'lookupQueryMaxUnits', 'lookupLimitMax'], defaults: ['limit'] },
    list_access: { limits: [], defaults: [] },
    delete: { limits: ['idempotencyKeyMaxUnits'], defaults: [] },
    revert: { limits: ['idempotencyKeyMaxUnits'], defaults: [] },
    revoke_reader_consent: { limits: ['idempotencyKeyMaxUnits'], defaults: [] },
  };
  const fields = required[config.operation];
  if (fields && (fields.limits.some((key) => !Object.hasOwn(config.limits, key)) ||
    fields.defaults.some((key) => !Object.hasOwn(config.defaults, key)))) {
    throw new Error(`incomplete operation profile: ${config.operation}`);
  }
}

export function operationProfile(profile: ArtifactProviderProfile, operation: string): OperationProfile {
  const configured = profile.operations.find((entry) => entry.operation === operation);
  if (!configured) throw new Error(`missing operation profile: ${operation}`);
  return configured;
}

/** Schemas are generated from the same limits/defaults read by normalization. */
export function capabilitySchema(name: ArtifactCapabilityName, profile: EffectiveArtifactProfile): ArtifactSchema {
  const operation = name.slice('artifacts_'.length);
  const part1 = profile.profileRevisionId === undefined || profile.resultEnvelopeVersion === 2;
  const config = operationProfile(profile, operation);
  const limits = config.limits;
  const key = { type: 'string', minLength: 1, maxLength: limits.idempotencyKeyMaxUnits,
    description: 'Nonblank by JavaScript trim(); length is UTF-16 units; original bytes retained.' };
  const idOnly = obj({ artifactId: id }, ['artifactId']);
  switch (operation) {
    case 'ensure': return obj({ bindingName: { type: 'string', minLength: limits.bindingNameMinUnits,
      maxLength: limits.bindingNameMaxUnits }, parameters: { ...obj({}), default: config.defaults.parameters },
      idempotencyKey: key, ...(part1 ? metadata : {}) }, ['bindingName', 'idempotencyKey']);
    case 'publish': {
      const reserved = profile.rules.reservedFirstSegments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const path = { type: 'string', minLength: 1, maxLength: profile.rules.pathMaxBytes,
        allOf: [{ not: { pattern: profile.rules.forbiddenPathPattern } },
          { not: { pattern: '(^|/)(\\.\\.?|)(/|$)' } },
          { not: { pattern: `^(?:${reserved})(?:/|$)` } }],
        description: `At most ${profile.rules.pathMaxBytes} UTF-8 bytes; no empty/dot segments, colon or DEL.` };
      const file = { ...obj({ path, mimeType: { type: 'string', enum: profile.rules.mimeTypes },
        text: { type: 'string', maxLength: limits.maxDecodedFileBytes, description: 'UTF-8 decoded-byte budget applies.' },
        bytes: { type: 'array', maxItems: limits.maxDecodedFileBytes, items: integer(0, 255) } }, ['path', 'mimeType']),
        oneOf: [{ required: ['text'], not: { required: ['bytes'] } },
          { required: ['bytes'], not: { required: ['text'] } }] };
      const edit = obj({ path, oldStr: { type: 'string', minLength: 1, maxLength: limits.maxDecodedFileBytes,
        description: 'Must occur exactly once in the current file text.' },
        newStr: { type: 'string', maxLength: limits.maxDecodedFileBytes } }, ['path', 'oldStr', 'newStr']);
      return { ...obj({ artifactId: id, idempotencyKey: key,
        files: { type: 'array', items: file, minItems: limits.publishFilesMin, maxItems: limits.publishFilesMax,
          description: 'Full file set; required unless edits is supplied.' },
        ...(part1 ? { edits: { type: 'array', items: edit, minItems: 1, maxItems: 100,
          description: 'Small old/new edits applied to the current release text files; required unless files is supplied.' } } : {}),
        expectedCurrentReleaseId: { ...id, type: ['string', 'null'], description: 'Compare the current release atomically; null requires an unpublished artifact.' },
        profile: { ...primitiveRecord, default: config.defaults.profile },
        ...(part1 ? metadata : {}) }, ['artifactId', 'idempotencyKey', ...(!part1 ? ['files'] : []),
        ...(profile.requireExpectedCurrentReleaseId ? ['expectedCurrentReleaseId'] : [])]),
        oneOf: [{ required: ['files'], not: { required: ['edits'] } },
          { required: ['edits'], not: { required: ['files'] } }] };
    }
    case 'list': return obj({ limit: { ...integer(limits.listLimitMin, limits.listLimitMax), default: config.defaults.limit },
      offset: { ...integer(0), default: config.defaults.offset } });
    case 'get': case 'fork': case 'renew': case 'restore': return idOnly;
    case 'list_versions': return profile.resultEnvelopeVersion !== 2 ? idOnly : obj({ artifactId: id,
      limit: { ...integer(1, 100), default: 20 }, cursor: { ...str, maxLength: 4096 } }, ['artifactId']);
    case 'get_source': return obj({ artifactId: id, releaseId: id,
      // Frozen ceiling (review finding 5): maxItems 32 and the 256 KiB decoded
      // budget are part of the frozen get_source definition and must NOT move.
      // Server-side caps may only move BELOW this frozen schema; larger listings
      // belong to the new listing tools, not to this one.
      paths: { type: 'array', minItems: 1, maxItems: 32, items: { ...str, maxLength: profile.rules.pathMaxBytes },
        description: 'Unique manifest paths; omit to read the whole snapshot (max 32 files, 256 KiB decoded). ' +
          'Result files are `text` with encoding "utf8" or `base64` with encoding "base64" (never an integer ' +
          'array), plus a guideRef; the guide body is never embedded.' } }, ['artifactId']);
    case 'delete': return obj({ artifactId: id, expectedCurrentReleaseId: { ...id, type: ['string', 'null'] },
      idempotencyKey: key, confirmationRef: { ...str, maxLength: 4096 } },
      ['artifactId', 'idempotencyKey', ...(profile.requireExpectedCurrentReleaseId ? ['expectedCurrentReleaseId'] : [])]);
    case 'revert': {
      const target = profile.resultEnvelopeVersion === 2 ? 'targetReleaseId' : 'releaseId';
      return obj({ artifactId: id, [target]: id, expectedCurrentReleaseId: { ...id, type: ['string', 'null'] }, idempotencyKey: key },
        ['artifactId', target, 'idempotencyKey', ...(profile.requireExpectedCurrentReleaseId ? ['expectedCurrentReleaseId'] : [])]);
    }
    case 'get_template': return obj({ templateId: str }, ['templateId']);
    case 'get_api_guide': return obj({ version: str });
    case 'create_upload': return obj({ artifactId: id, mimeType: str, maxSize: integer(1) }, ['artifactId', 'mimeType']);
    case 'create_upload_page': return obj({ artifactId: id,
      maxFiles: { type: 'integer', minimum: 1, maximum: 255,
        description: 'Files the page may stage; capped by the release budget (min asked, profile releaseFilesMax).' },
    }, ['artifactId']);
    case 'list_assets': return obj({ artifactId: id, releaseId: id,
      state: { type: 'string', enum: ['staged', 'released', 'all'], default: 'all',
        description: 'Released assets come from the release manifest; staged assets from committed uploads.' },
      pageSessionId: { ...id, description: 'Only staged files committed through this browser page.' },
      limit: { ...integer(limits.listAssetsLimitMin, limits.listAssetsLimitMax), default: config.defaults.limit },
      cursor: { ...str, maxLength: 4096, description: 'Opaque paging cursor from a previous response.' },
    }, ['artifactId']);
    case 'commit_upload': return obj({ artifactId: id, uploadId: str, path: str, mimeType: str,
      digest: str, size: integer(0), profile: primitiveRecord, idempotencyKey: key },
    ['artifactId', 'uploadId', 'path', 'mimeType', 'digest', 'size', 'idempotencyKey']);
    case 'publish_bundle': {
      // Release budgets come from the publish operation (release* keys override the
      // inline values; absent keys default to them, never above the server maxima).
      const publishLimits = profile.operations.find((entry) => entry.operation === 'publish')?.limits;
      const filesMax = publishLimits?.releaseFilesMax ?? publishLimits?.publishFilesMax ?? SERVER_MAX_FILES_PER_RELEASE;
      const fileBytesMax = publishLimits?.releaseFileBytesMax ?? publishLimits?.maxDecodedFileBytes ?? SERVER_MAX_FILE_BYTES;
      const totalBytesMax = publishLimits?.releaseTotalBytesMax ?? publishLimits?.maxDecodedTotalBytes ?? SERVER_MAX_TOTAL_BYTES;
      const inlineFileBytesMax = publishLimits?.maxDecodedFileBytes ?? SERVER_MAX_FILE_BYTES;
      const inlineTotalBytesMax = publishLimits?.maxDecodedTotalBytes ?? SERVER_MAX_TOTAL_BYTES;
      const reserved = profile.rules.reservedFirstSegments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const bundlePath = { type: 'string', minLength: 1, maxLength: profile.rules.pathMaxBytes,
        allOf: [{ not: { pattern: profile.rules.forbiddenPathPattern } },
          { not: { pattern: '(^|/)(\\.\\.?|)(/|$)' } },
          { not: { pattern: `^(?:${reserved})(?:/|$)` } }],
        description: `At most ${profile.rules.pathMaxBytes} UTF-8 bytes; no empty/dot segments, colon or DEL.` };
      const inlineFile = { ...obj({ path: bundlePath, mimeType: { type: 'string', enum: profile.rules.mimeTypes },
        text: { type: 'string', maxLength: inlineFileBytesMax, description: 'UTF-8 decoded-byte budget applies.' },
        bytes: { type: 'array', maxItems: inlineFileBytesMax, items: integer(0, 255) } }, ['path', 'mimeType']),
        oneOf: [{ required: ['text'], not: { required: ['bytes'] } },
          { required: ['bytes'], not: { required: ['text'] } }] };
      const uploadAsset = obj({ path: bundlePath, uploadId: id,
        description: 'Staged file committed via artifacts_commit_upload; the server re-reads and re-verifies it.' },
        ['path', 'uploadId']);
      const casAsset = obj({ path: bundlePath,
        digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$',
          description: 'Canonical sha256:<hex> digest of an already-pinned blob in the same scope.' },
        size: integer(1), mimeType: { type: 'string', enum: profile.rules.mimeTypes } },
        ['path', 'digest', 'size', 'mimeType']);
      return { ...obj({ artifactId: id, idempotencyKey: key,
        files: { type: 'array', items: inlineFile, minItems: 1, maxItems: filesMax,
          description: `Inline files (bytes travel through the model, inline budget ${inlineFileBytesMax}/${inlineTotalBytesMax} bytes); at least one of files/assets is required.` },
        assets: { type: 'array', minItems: 1, maxItems: filesMax,
          items: { oneOf: [uploadAsset, casAsset] },
          description: `Assets whose bytes already left the model: an uploadId staged via create_upload/commit_upload, or a CAS reference to an already-pinned blob. Release budget (max ${filesMax} files, ${fileBytesMax} bytes/file, ${totalBytesMax} bytes total) applies to the union of files and assets.` },
        expectedCurrentReleaseId: { ...id, type: ['string', 'null'],
          description: 'Compare the current release atomically; null requires an unpublished artifact. Always required for this tool.' },
        profile: { ...primitiveRecord, default: config.defaults.profile },
        ...(part1 ? metadata : {}) },
        ['artifactId', 'idempotencyKey', 'expectedCurrentReleaseId']),
        anyOf: [{ required: ['files'] }, { required: ['assets'] }] };
    }
    case 'publish_bundle_v2': {
      // V2 carries everything v1 has, plus copy/carry asset forms and the
      // keep-unmodified carry of the expected current release. V1 is untouched.
      const publishLimits = profile.operations.find((entry) => entry.operation === 'publish')?.limits;
      const filesMax = publishLimits?.releaseFilesMax ?? publishLimits?.publishFilesMax ?? SERVER_MAX_FILES_PER_RELEASE;
      const fileBytesMax = publishLimits?.releaseFileBytesMax ?? publishLimits?.maxDecodedFileBytes ?? SERVER_MAX_FILE_BYTES;
      const totalBytesMax = publishLimits?.releaseTotalBytesMax ?? publishLimits?.maxDecodedTotalBytes ?? SERVER_MAX_TOTAL_BYTES;
      const inlineFileBytesMax = publishLimits?.maxDecodedFileBytes ?? SERVER_MAX_FILE_BYTES;
      const inlineTotalBytesMax = publishLimits?.maxDecodedTotalBytes ?? SERVER_MAX_TOTAL_BYTES;
      const reserved = profile.rules.reservedFirstSegments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const bundlePath = { type: 'string', minLength: 1, maxLength: profile.rules.pathMaxBytes,
        allOf: [{ not: { pattern: profile.rules.forbiddenPathPattern } },
          { not: { pattern: '(^|/)(\\.\\.?|)(/|$)' } },
          { not: { pattern: `^(?:${reserved})(?:/|$)` } }],
        description: `At most ${profile.rules.pathMaxBytes} UTF-8 bytes; no empty/dot segments, colon or DEL.` };
      const inlineFile = { ...obj({ path: bundlePath, mimeType: { type: 'string', enum: profile.rules.mimeTypes },
        text: { type: 'string', maxLength: inlineFileBytesMax, description: 'UTF-8 decoded-byte budget applies.' },
        bytes: { type: 'array', maxItems: inlineFileBytesMax, items: integer(0, 255) } }, ['path', 'mimeType']),
        oneOf: [{ required: ['text'], not: { required: ['bytes'] } },
          { required: ['bytes'], not: { required: ['text'] } }] };
      const uploadAsset = obj({ path: bundlePath, uploadId: id,
        description: 'Staged file committed via artifacts_commit_upload; the server re-reads and re-verifies it.' },
        ['path', 'uploadId']);
      const casAsset = obj({ path: bundlePath,
        digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$',
          description: 'Canonical sha256:<hex> digest of an already-pinned blob in the same scope.' },
        size: integer(1), mimeType: { type: 'string', enum: profile.rules.mimeTypes } },
        ['path', 'digest', 'size', 'mimeType']);
      const copyAsset = obj({ path: bundlePath, sourceArtifactId: id,
        sourcePath: bundlePath, sourceReleaseId: id,
        description: 'Copy one manifest file from another artifact of the same scope (MIME taken from the source manifest).' },
        ['path', 'sourceArtifactId']);
      const carryAsset = obj({ path: bundlePath, carryFromReleaseId: id,
        sourcePath: bundlePath,
        description: 'Carry one manifest file from a release of this artifact (defaults to the same path).' },
        ['path', 'carryFromReleaseId']);
      return { ...obj({ artifactId: id, idempotencyKey: key,
        files: { type: 'array', items: inlineFile, minItems: 1, maxItems: filesMax,
          description: `Inline files (bytes travel through the model, inline budget ${inlineFileBytesMax}/${inlineTotalBytesMax} bytes); at least one of files/assets is required.` },
        assets: { type: 'array', minItems: 1, maxItems: filesMax,
          items: { oneOf: [uploadAsset, casAsset, copyAsset, carryAsset] },
          description: `Assets whose bytes already left the model: a staged uploadId, a CAS digest, a copy from another artifact of the same scope, or a carry from a release of this artifact. Release budget (max ${filesMax} files, ${fileBytesMax} bytes/file, ${totalBytesMax} bytes total) applies to the union.` },
        expectedCurrentReleaseId: { ...id, type: ['string', 'null'],
          description: 'Compare the current release atomically; null requires an unpublished artifact. Always required for this tool.' },
        keepUnmodifiedPaths: { type: 'boolean', default: false,
          description: 'Carry every path of expectedCurrentReleaseId not overridden by an explicit file or asset.' },
        profile: { ...primitiveRecord, default: config.defaults.profile },
        ...(part1 ? metadata : {}) },
        ['artifactId', 'idempotencyKey', 'expectedCurrentReleaseId']),
        anyOf: [{ required: ['files'] }, { required: ['assets'] }] };
    }
    case 'set_access': return { ...obj({ artifactId: id, action: { type: 'string', enum: ['grant', 'revoke'] },
      principalId: { ...str, maxLength: 256 }, grant: { type: 'string', enum: ['read'] }, idempotencyKey: key },
    ['artifactId', 'action', 'principalId', 'idempotencyKey']), oneOf: [
      { properties: { action: { enum: ['grant'] } }, required: ['grant'] },
      { properties: { action: { enum: ['revoke'] } }, not: { required: ['grant'] } },
    ] };
    case 'lookup_people': return obj({ query: { type: 'string', minLength: limits.lookupQueryMinUnits,
      maxLength: limits.lookupQueryMaxUnits, description: 'Name or email fragment; matched case- and accent-insensitively against approved accounts of the scope.' },
      limit: { ...integer(1, limits.lookupLimitMax), default: config.defaults.limit } }, ['query']);
    case 'list_access': return idOnly;
    case 'promote': return obj({ artifactId: id, releaseId: id, expectedCurrent: id }, ['artifactId', 'releaseId', 'expectedCurrent']);
    case 'revoke_reader_consent': return obj({ artifactId: id,
      scope: { type: 'string', minLength: 1, maxLength: 128,
        description: 'One consent scope of this artifact; omitted revokes every scope of the artifact.' },
      idempotencyKey: key }, ['artifactId', 'idempotencyKey']);
    default: throw new Error(`unsupported operation profile: ${operation}`);
  }
}
