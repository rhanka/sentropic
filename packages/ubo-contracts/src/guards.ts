/** Pure runtime guards (no zod) — mirror the @sentropic/comments guard style. */
import type {
  Cardinality,
  ObjectEnvelope,
  ObjectOrigin,
  ObjectTypeDefinition,
  ObjectTypeStatus,
  OnDelete,
  ReferenceKind,
  TypedReference,
} from './types.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const REFERENCE_KINDS: ReadonlySet<ReferenceKind> = new Set(['lookup', 'containment']);
const CARDINALITIES: ReadonlySet<Cardinality> = new Set(['one', 'many']);
const ON_DELETE: ReadonlySet<OnDelete> = new Set(['restrict', 'cascade', 'set-null']);
const ORIGINS: ReadonlySet<ObjectOrigin> = new Set(['user', 'agent', 'system', 'import']);
const STATUSES: ReadonlySet<ObjectTypeStatus> = new Set(['draft', 'active', 'deprecated']);

export const isReferenceKind = (v: unknown): v is ReferenceKind =>
  typeof v === 'string' && REFERENCE_KINDS.has(v as ReferenceKind);
export const isObjectTypeStatus = (v: unknown): v is ObjectTypeStatus =>
  typeof v === 'string' && STATUSES.has(v as ObjectTypeStatus);

export function isTypedReference(v: unknown): v is TypedReference {
  if (!isRecord(v)) return false;
  return (
    typeof v.field === 'string' &&
    typeof v.targetType === 'string' &&
    isReferenceKind(v.kind) &&
    typeof v.cardinality === 'string' &&
    CARDINALITIES.has(v.cardinality as Cardinality) &&
    typeof v.onDelete === 'string' &&
    ON_DELETE.has(v.onDelete as OnDelete)
  );
}

export function isObjectTypeDefinition(v: unknown): v is ObjectTypeDefinition {
  if (!isRecord(v)) return false;
  return (
    typeof v.objectType === 'string' &&
    isRecord(v.jsonSchema) &&
    Array.isArray(v.declaredQueryableFields) &&
    v.declaredQueryableFields.every((f) => typeof f === 'string') &&
    Array.isArray(v.typedReferenceFields) &&
    v.typedReferenceFields.every(isTypedReference) &&
    Array.isArray(v.classification) &&
    typeof v.schemaVersion === 'number' &&
    isObjectTypeStatus(v.status)
  );
}

export function isObjectEnvelope(v: unknown): v is ObjectEnvelope {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.objectType === 'string' &&
    isRecord(v.scope) &&
    typeof v.payloadSchemaVersion === 'number' &&
    typeof v.version === 'number' &&
    typeof v.origin === 'string' &&
    ORIGINS.has(v.origin as ObjectOrigin) &&
    'payload' in v &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string'
  );
}
