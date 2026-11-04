import { isArtifactId, type JsonValue } from '../contracts.js';
import { ArtifactProfileInputError, type EffectiveArtifactProfile, type ArtifactSchema } from './contracts.js';
import { copyJson, freezeDeep, isRecord } from './json.js';
import { operationProfile } from './schemas.js';
import { SERVER_MAX_FILE_BYTES, SERVER_MAX_FILES_PER_RELEASE, SERVER_MAX_TOTAL_BYTES } from '../server/publication-limits.js';

/** Release budget of a bundle publication: the publish operation's release* keys
 *  override its inline values; absent keys default to the inline values, and the
 *  server maxima are hard ceilings either way (profile/index.ts enforces them).
 *  Exported for the HTTP layer (create_upload/commit_upload/publish_bundle). */
export function releaseBudget(profile: EffectiveArtifactProfile): { filesMax: number; fileBytesMax: number; totalBytesMax: number;
  inlineFileBytesMax: number; inlineTotalBytesMax: number } {
  const publishLimits = profile.operations.find((entry) => entry.operation === 'publish')?.limits;
  return {
    filesMax: publishLimits?.releaseFilesMax ?? publishLimits?.publishFilesMax ?? SERVER_MAX_FILES_PER_RELEASE,
    fileBytesMax: publishLimits?.releaseFileBytesMax ?? publishLimits?.maxDecodedFileBytes ?? SERVER_MAX_FILE_BYTES,
    totalBytesMax: publishLimits?.releaseTotalBytesMax ?? publishLimits?.maxDecodedTotalBytes ?? SERVER_MAX_TOTAL_BYTES,
    inlineFileBytesMax: publishLimits?.maxDecodedFileBytes ?? SERVER_MAX_FILE_BYTES,
    inlineTotalBytesMax: publishLimits?.maxDecodedTotalBytes ?? SERVER_MAX_TOTAL_BYTES,
  };
}

function requireInput(condition: unknown): asserts condition {
  if (!condition) throw new ArtifactProfileInputError();
}

/** The generated schema vocabulary, evaluated without a platform dependency. */
export function matchesSchema(value: unknown, schema: ArtifactSchema): boolean {
  const type = schema.type;
  if (Array.isArray(type)) return type.some((entry) => matchesSchema(value, { ...schema, type: entry }));
  if (type === 'object' && !isRecord(value)) return false;
  if (type === 'array' && !Array.isArray(value)) return false;
  if (type === 'string' && typeof value !== 'string') return false;
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
  if (type === 'integer' && !Number.isSafeInteger(value)) return false;
  if (type === 'boolean' && typeof value !== 'boolean') return false;
  if (type === 'null' && value !== null) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.not && matchesSchema(value, schema.not as ArtifactSchema)) return false;
  if (Array.isArray(schema.allOf) && !schema.allOf.every((s) => matchesSchema(value, s))) return false;
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((s) => matchesSchema(value, s)).length !== 1) return false;
  if (typeof value === 'number' &&
    ((typeof schema.minimum === 'number' && value < schema.minimum) ||
     (typeof schema.maximum === 'number' && value > schema.maximum))) return false;
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((v) => matchesSchema(v, schema.items as ArtifactSchema))) return false;
  }
  if (isRecord(value)) {
    if (Array.isArray(schema.required) && schema.required.some((key) => !Object.hasOwn(value, key))) return false;
    const properties = (schema.properties ?? {}) as Record<string, ArtifactSchema>;
    for (const [key, entry] of Object.entries(value)) {
      if (schema.propertyNames && !matchesSchema(key, schema.propertyNames as ArtifactSchema)) return false;
      if (Object.hasOwn(properties, key)) { if (!matchesSchema(entry, properties[key])) return false; }
      else if (schema.additionalProperties === false) return false;
      else if (isRecord(schema.additionalProperties) && !matchesSchema(entry, schema.additionalProperties)) return false;
    }
  }
  return true;
}

export function normalizeArguments(profile: EffectiveArtifactProfile, name: string, input: unknown,
  schema: ArtifactSchema, envelopeKey?: string,
  options?: { deferPrecondition: true }): Readonly<Record<string, JsonValue>> {
  const args = copyJson(input);
  if (profile.requireExpectedCurrentReleaseId && ['artifacts_publish', 'artifacts_revert', 'artifacts_delete'].includes(name) &&
    isRecord(args) && !Object.hasOwn(args, 'expectedCurrentReleaseId')) {
    if (!options?.deferPrecondition) throw new ArtifactProfileInputError(false, true, {
      profileRevisionId: profile.profileRevisionId ?? profile.version, resultEnvelopeVersion: profile.resultEnvelopeVersion ?? 1,
      requiredField: 'expectedCurrentReleaseId', readTools: ['artifacts_get', 'artifacts_list'],
    });
    schema = { ...schema, required: (schema.required as string[]).filter(key => key !== 'expectedCurrentReleaseId') };
  }
  requireInput(isRecord(args) && matchesSchema(args, schema));
  const operation = name.slice('artifacts_'.length);
  const { defaults, limits } = operationProfile(profile, operation);
  const normalized = { ...copyJson(defaults) as Record<string, JsonValue>, ...args } as Record<string, JsonValue>;
  if (['ensure', 'publish', 'commit_upload', 'publish_bundle', 'publish_bundle_v2',
    'set_access', 'delete', 'revert'].includes(operation)) {
    const key = args.idempotencyKey;
    requireInput(typeof key === 'string' && key.trim().length > 0 && key.length <= limits.idempotencyKeyMaxUnits);
    requireInput(envelopeKey === undefined || envelopeKey === key);
  } else requireInput(envelopeKey === undefined);
  if (Object.hasOwn(args, 'artifactId')) requireInput(isArtifactId(args.artifactId));
  if (operation === 'get_source' && args.paths !== undefined) {
    const paths = args.paths as string[];
    requireInput(new Set(paths).size === paths.length && paths.every((path) =>
      Buffer.byteLength(path, 'utf8') <= profile.rules.pathMaxBytes));
  }
  if (Object.hasOwn(args, 'releaseId')) requireInput(isArtifactId(args.releaseId));
  if (Object.hasOwn(args, 'expectedCurrentReleaseId')) requireInput(args.expectedCurrentReleaseId === null || isArtifactId(args.expectedCurrentReleaseId));
  const isBundle = operation === 'publish_bundle' || operation === 'publish_bundle_v2';
  if (operation === 'publish' || isBundle) {
    const hasFiles = Object.hasOwn(args, 'files');
    if (operation === 'publish') {
      const hasEdits = Object.hasOwn(args, 'edits');
      // Exactly one content source: a full file set, or small edits on the current release.
      requireInput(hasFiles !== hasEdits);
    } else {
      // A bundle needs at least one content source: inline files and/or assets.
      requireInput(hasFiles || Object.hasOwn(args, 'assets'));
    }
    if (hasFiles) {
      const paths = new Set<string>();
      let total = 0;
      const inlineFileBytesMax = operation === 'publish' ? limits.maxDecodedFileBytes : releaseBudget(profile).inlineFileBytesMax;
      const inlineTotalBytesMax = operation === 'publish' ? limits.maxDecodedTotalBytes : releaseBudget(profile).inlineTotalBytesMax;
      normalized.files = (args.files as Record<string, JsonValue>[]).map((file) => {
        const path = file.path as string;
        requireInput(!paths.has(path) && Buffer.byteLength(path, 'utf8') <= profile.rules.pathMaxBytes);
        paths.add(path);
        const bytes = Object.hasOwn(file, 'text') ? Array.from(Buffer.from(file.text as string, 'utf8')) : file.bytes as number[];
        total += bytes.length;
        requireInput(bytes.length <= inlineFileBytesMax && total <= inlineTotalBytesMax);
        return { path, mimeType: file.mimeType, bytes };
      });
      if (isBundle && Object.hasOwn(args, 'assets')) {
        // Duplicate path refused across the files/assets union.
        for (const asset of args.assets as Record<string, JsonValue>[]) {
          requireInput(!paths.has(asset.path as string));
        }
      }
    }
    if (isBundle && Object.hasOwn(args, 'assets')) {
      const paths = new Set<string>();
      if (hasFiles) for (const file of args.files as Record<string, JsonValue>[]) paths.add(file.path as string);
      normalized.assets = (args.assets as Record<string, JsonValue>[]).map((asset) => {
        const path = asset.path as string;
        requireInput(!paths.has(path) && Buffer.byteLength(path, 'utf8') <= profile.rules.pathMaxBytes);
        paths.add(path);
        if (Object.hasOwn(asset, 'uploadId')) {
          requireInput(isArtifactId(asset.uploadId as string));
          return { path, uploadId: asset.uploadId };
        }
        // LOT 2 v2 asset forms: copy from another artifact, or carry from a
        // release of this artifact. The MIME type is taken from the source
        // manifest at resolution time, never from the caller.
        if (Object.hasOwn(asset, 'sourceArtifactId')) {
          requireInput(isArtifactId(asset.sourceArtifactId as string));
          if (Object.hasOwn(asset, 'sourcePath')) {
            requireInput(typeof asset.sourcePath === 'string' &&
              Buffer.byteLength(asset.sourcePath, 'utf8') <= profile.rules.pathMaxBytes);
          }
          if (Object.hasOwn(asset, 'sourceReleaseId')) {
            requireInput(isArtifactId(asset.sourceReleaseId as string));
          }
          return { path, sourceArtifactId: asset.sourceArtifactId,
            ...(Object.hasOwn(asset, 'sourcePath') ? { sourcePath: asset.sourcePath } : {}),
            ...(Object.hasOwn(asset, 'sourceReleaseId') ? { sourceReleaseId: asset.sourceReleaseId } : {}) };
        }
        if (Object.hasOwn(asset, 'carryFromReleaseId')) {
          requireInput(isArtifactId(asset.carryFromReleaseId as string));
          if (Object.hasOwn(asset, 'sourcePath')) {
            requireInput(typeof asset.sourcePath === 'string' &&
              Buffer.byteLength(asset.sourcePath, 'utf8') <= profile.rules.pathMaxBytes);
          }
          return { path, carryFromReleaseId: asset.carryFromReleaseId,
            ...(Object.hasOwn(asset, 'sourcePath') ? { sourcePath: asset.sourcePath } : {}) };
        }
        const digest = asset.digest as string;
        requireInput(/^sha256:[0-9a-f]{64}$/.test(digest) && Number.isSafeInteger(asset.size) && (asset.size as number) >= 1 &&
          profile.rules.mimeTypes.includes(asset.mimeType as string));
        return { path, digest, size: asset.size, mimeType: asset.mimeType };
      });
    }
  }
  if (operation === 'create_upload') {
    // MIME must be inside the profile allowlist (itself within the server ceiling).
    requireInput(profile.rules.mimeTypes.includes(args.mimeType as string));
    if (Object.hasOwn(args, 'maxSize')) {
      requireInput(Number.isSafeInteger(args.maxSize) && (args.maxSize as number) >= 1 &&
        (args.maxSize as number) <= releaseBudget(profile).fileBytesMax);
    }
  }
  if (operation === 'commit_upload') {
    const path = args.path as string;
    requireInput(Buffer.byteLength(path, 'utf8') <= profile.rules.pathMaxBytes);
    requireInput(profile.rules.mimeTypes.includes(args.mimeType as string));
    requireInput(/^sha256:[0-9a-f]{64}$/.test(args.digest as string));
    requireInput(Number.isSafeInteger(args.size) && (args.size as number) >= 1 &&
      (args.size as number) <= releaseBudget(profile).fileBytesMax);
    requireInput(isArtifactId(args.uploadId as string));
  }
  return freezeDeep(normalized);
}
