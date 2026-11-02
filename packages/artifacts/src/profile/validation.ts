import { isArtifactId, type JsonValue } from '../contracts.js';
import { ArtifactProfileInputError, type EffectiveArtifactProfile, type ArtifactSchema } from './contracts.js';
import { copyJson, freezeDeep, isRecord } from './json.js';
import { operationProfile } from './schemas.js';

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
  schema: ArtifactSchema, envelopeKey?: string): Readonly<Record<string, JsonValue>> {
  const args = copyJson(input);
  if (profile.requireExpectedCurrentReleaseId && (name === 'artifacts_publish' || name === 'artifacts_revert') &&
    isRecord(args) && !Object.hasOwn(args, 'expectedCurrentReleaseId')) throw new ArtifactProfileInputError(false, true);
  requireInput(isRecord(args) && matchesSchema(args, schema));
  const operation = name.slice('artifacts_'.length);
  const { defaults, limits } = operationProfile(profile, operation);
  const normalized = { ...copyJson(defaults) as Record<string, JsonValue>, ...args } as Record<string, JsonValue>;
  if (operation === 'ensure' || operation === 'publish' || operation === 'commit_upload' || operation === 'revert') {
    const key = args.idempotencyKey;
    requireInput(typeof key === 'string' && key.trim().length > 0 && key.length <= limits.idempotencyKeyMaxUnits);
    requireInput(envelopeKey === undefined || envelopeKey === key);
  } else requireInput(envelopeKey === undefined);
  if (Object.hasOwn(args, 'artifactId')) requireInput(isArtifactId(args.artifactId));
  if (Object.hasOwn(args, 'releaseId')) requireInput(isArtifactId(args.releaseId));
  if (Object.hasOwn(args, 'expectedCurrentReleaseId')) requireInput(args.expectedCurrentReleaseId === null || isArtifactId(args.expectedCurrentReleaseId));
  if (operation === 'publish') {
    const hasFiles = Object.hasOwn(args, 'files');
    const hasEdits = Object.hasOwn(args, 'edits');
    // Exactly one content source: a full file set, or small edits on the current release.
    requireInput(hasFiles !== hasEdits);
    if (hasFiles) {
      const paths = new Set<string>();
      let total = 0;
      normalized.files = (args.files as Record<string, JsonValue>[]).map((file) => {
        const path = file.path as string;
        requireInput(!paths.has(path) && Buffer.byteLength(path, 'utf8') <= profile.rules.pathMaxBytes);
        paths.add(path);
        const bytes = Object.hasOwn(file, 'text') ? Array.from(Buffer.from(file.text as string, 'utf8')) : file.bytes as number[];
        total += bytes.length;
        requireInput(bytes.length <= limits.maxDecodedFileBytes && total <= limits.maxDecodedTotalBytes);
        return { path, mimeType: file.mimeType, bytes };
      });
    }
  }
  return freezeDeep(normalized);
}
