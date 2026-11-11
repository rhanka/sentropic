/**
 * Object-type registry contract (ARCH-19) — validation and port.
 *
 * Pure module: no database, no drizzle. Moved here (CODE move, T5a) so the
 * CM storage family shares one validation; the Postgres adapter stays in
 * the API (`api/src/services/object-registry/object-type-registry.ts`).
 * No state move, no migration.
 */
import { isTypedReference } from './guards.js';
import type {
  FieldClassification,
  NewObjectTypeDefinition,
  ObjectTypeDefinition,
  ObjectTypeStatus,
  TypedReference,
} from './types.js';

export type { FieldClassification, NewObjectTypeDefinition, ObjectTypeDefinition, ObjectTypeStatus, TypedReference };

export class ObjectTypeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectTypeValidationError';
  }
}

export class ObjectTypeNotFoundError extends Error {
  constructor(objectType: string) {
    super(`Object type not found: ${objectType}`);
    this.name = 'ObjectTypeNotFoundError';
  }
}

// Anti-pollution caps (registry-design requirements, not options).
export const MAX_TYPES_PER_SCOPE = 500;
export const MAX_QUERYABLE_FIELDS = 100;
export const MAX_TYPED_REFERENCES = 100;

/** Top-level property names declared in a JSON Schema object. */
export function schemaPropertyNames(jsonSchema: Record<string, unknown>): Set<string> {
  const props = jsonSchema.properties;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    return new Set(Object.keys(props as Record<string, unknown>));
  }
  return new Set();
}

/** A field path's head segment (e.g. `address.city` → `address`). */
export function fieldHead(field: string): string {
  return field.split('.')[0] ?? field;
}

export function validateDefinition(def: {
  objectType: string;
  jsonSchema: Record<string, unknown>;
  declaredQueryableFields: ReadonlyArray<string>;
  typedReferenceFields: ReadonlyArray<TypedReference>;
  classification: ReadonlyArray<FieldClassification>;
}): void {
  if (!def.objectType || typeof def.objectType !== 'string') {
    throw new ObjectTypeValidationError('objectType is required');
  }
  if (typeof def.jsonSchema !== 'object' || def.jsonSchema === null || Array.isArray(def.jsonSchema)) {
    throw new ObjectTypeValidationError('jsonSchema must be a JSON Schema object');
  }
  // Accept a minimal JSON Schema: must declare `type: object` or `properties`.
  if (def.jsonSchema.type !== 'object' && !def.jsonSchema.properties) {
    throw new ObjectTypeValidationError('jsonSchema must describe an object (type:"object" or properties)');
  }
  const props = schemaPropertyNames(def.jsonSchema);

  if (def.declaredQueryableFields.length > MAX_QUERYABLE_FIELDS) {
    throw new ObjectTypeValidationError(`too many declaredQueryableFields (max ${MAX_QUERYABLE_FIELDS})`);
  }
  for (const f of def.declaredQueryableFields) {
    if (!props.has(fieldHead(f))) {
      throw new ObjectTypeValidationError(`declaredQueryableField "${f}" is not a property of the schema`);
    }
  }

  if (def.typedReferenceFields.length > MAX_TYPED_REFERENCES) {
    throw new ObjectTypeValidationError(`too many typedReferenceFields (max ${MAX_TYPED_REFERENCES})`);
  }
  for (const ref of def.typedReferenceFields) {
    if (!isTypedReference(ref)) {
      throw new ObjectTypeValidationError(`malformed typedReference: ${JSON.stringify(ref)}`);
    }
    if (!props.has(fieldHead(ref.field))) {
      throw new ObjectTypeValidationError(`typedReference field "${ref.field}" is not a property of the schema`);
    }
  }
}

export interface ObjectTypeRegistry {
  register(def: NewObjectTypeDefinition): Promise<ObjectTypeDefinition>;
  get(objectType: string, tenantId?: string | null): Promise<ObjectTypeDefinition | null>;
  list(tenantId?: string | null): Promise<ObjectTypeDefinition[]>;
  update(
    objectType: string,
    patch: Partial<Omit<NewObjectTypeDefinition, 'objectType' | 'tenantId'>>,
    tenantId?: string | null,
  ): Promise<ObjectTypeDefinition>;
  deprecate(objectType: string, tenantId?: string | null): Promise<ObjectTypeDefinition>;
}
