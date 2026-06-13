/**
 * Object-type registry (ARCH-19 / BR-59) — port + Postgres adapter.
 *
 * Manages `control.object_type_definitions`: register / get / list / update /
 * deprecate object types. Validates on write (well-formed JSON Schema, typed
 * references reference declared payload fields, declared-queryable fields exist
 * in the schema) and enforces anti-pollution caps (the "registry pollution"
 * guard — SPEC_EVOL_DATA_ARCHITECTURE §risks).
 *
 * Wire shapes come from the PRIVATE @sentropic/ubo-contracts package.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { objectTypeDefinitions, type ObjectTypeDefinitionRow } from '../../db/control-schema';
import { createId } from '../../utils/id';
import {
  isTypedReference,
  type FieldClassification,
  type NewObjectTypeDefinition,
  type ObjectTypeDefinition,
  type ObjectTypeStatus,
  type TypedReference,
} from '@sentropic/ubo-contracts';

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
const MAX_TYPES_PER_SCOPE = 500;
const MAX_QUERYABLE_FIELDS = 100;
const MAX_TYPED_REFERENCES = 100;

/** Top-level property names declared in a JSON Schema object. */
function schemaPropertyNames(jsonSchema: Record<string, unknown>): Set<string> {
  const props = jsonSchema.properties;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    return new Set(Object.keys(props as Record<string, unknown>));
  }
  return new Set();
}

/** A field path's head segment (e.g. `address.city` → `address`). */
function fieldHead(field: string): string {
  return field.split('.')[0] ?? field;
}

function validateDefinition(def: {
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

function rowToDefinition(row: ObjectTypeDefinitionRow): ObjectTypeDefinition {
  return {
    objectType: row.objectType,
    tenantId: row.tenantId,
    jsonSchema: row.jsonSchema as Record<string, unknown>,
    declaredQueryableFields: (row.declaredQueryableFields as string[]) ?? [],
    typedReferenceFields: (row.typedReferenceFields as TypedReference[]) ?? [],
    classification: (row.classification as FieldClassification[]) ?? [],
    schemaVersion: row.schemaVersion,
    status: row.status as ObjectTypeStatus,
  };
}

const tenantPredicate = (tenantId?: string | null) =>
  tenantId == null ? isNull(objectTypeDefinitions.tenantId) : eq(objectTypeDefinitions.tenantId, tenantId);

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

export class PgObjectTypeRegistry implements ObjectTypeRegistry {
  async register(def: NewObjectTypeDefinition): Promise<ObjectTypeDefinition> {
    const normalized = {
      objectType: def.objectType,
      jsonSchema: def.jsonSchema as Record<string, unknown>,
      declaredQueryableFields: def.declaredQueryableFields ?? [],
      typedReferenceFields: def.typedReferenceFields ?? [],
      classification: def.classification ?? [],
    };
    validateDefinition(normalized);

    // Anti-pollution: cap the number of types per scope.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(objectTypeDefinitions)
      .where(tenantPredicate(def.tenantId));
    if (count >= MAX_TYPES_PER_SCOPE) {
      throw new ObjectTypeValidationError(`registry pollution guard: max ${MAX_TYPES_PER_SCOPE} types per scope`);
    }

    const [row] = await db
      .insert(objectTypeDefinitions)
      .values({
        id: createId(),
        objectType: def.objectType,
        tenantId: def.tenantId ?? null,
        jsonSchema: normalized.jsonSchema,
        declaredQueryableFields: normalized.declaredQueryableFields,
        typedReferenceFields: normalized.typedReferenceFields,
        classification: normalized.classification,
        schemaVersion: def.schemaVersion ?? 1,
        status: def.status ?? 'draft',
      })
      .returning();
    return rowToDefinition(row);
  }

  async get(objectType: string, tenantId?: string | null): Promise<ObjectTypeDefinition | null> {
    const [row] = await db
      .select()
      .from(objectTypeDefinitions)
      .where(and(eq(objectTypeDefinitions.objectType, objectType), tenantPredicate(tenantId)))
      .limit(1);
    return row ? rowToDefinition(row) : null;
  }

  async list(tenantId?: string | null): Promise<ObjectTypeDefinition[]> {
    const rows = await db
      .select()
      .from(objectTypeDefinitions)
      .where(tenantPredicate(tenantId));
    return rows.map(rowToDefinition);
  }

  async update(
    objectType: string,
    patch: Partial<Omit<NewObjectTypeDefinition, 'objectType' | 'tenantId'>>,
    tenantId?: string | null,
  ): Promise<ObjectTypeDefinition> {
    const current = await this.get(objectType, tenantId);
    if (!current) throw new ObjectTypeNotFoundError(objectType);

    const merged = {
      objectType,
      jsonSchema: (patch.jsonSchema as Record<string, unknown>) ?? current.jsonSchema,
      declaredQueryableFields: patch.declaredQueryableFields ?? current.declaredQueryableFields,
      typedReferenceFields: patch.typedReferenceFields ?? current.typedReferenceFields,
      classification: patch.classification ?? current.classification,
    };
    validateDefinition(merged);

    // Any schema-shape change bumps the schemaVersion (additive-preferred discipline lives upstream).
    const schemaChanged = patch.jsonSchema !== undefined;
    const [row] = await db
      .update(objectTypeDefinitions)
      .set({
        jsonSchema: merged.jsonSchema,
        declaredQueryableFields: merged.declaredQueryableFields,
        typedReferenceFields: merged.typedReferenceFields,
        classification: merged.classification,
        schemaVersion: patch.schemaVersion ?? (schemaChanged ? current.schemaVersion + 1 : current.schemaVersion),
        status: patch.status ?? current.status,
        updatedAt: sql`now()`,
      })
      .where(and(eq(objectTypeDefinitions.objectType, objectType), tenantPredicate(tenantId)))
      .returning();
    return rowToDefinition(row);
  }

  async deprecate(objectType: string, tenantId?: string | null): Promise<ObjectTypeDefinition> {
    const current = await this.get(objectType, tenantId);
    if (!current) throw new ObjectTypeNotFoundError(objectType);
    const [row] = await db
      .update(objectTypeDefinitions)
      .set({ status: 'deprecated', updatedAt: sql`now()` })
      .where(and(eq(objectTypeDefinitions.objectType, objectType), tenantPredicate(tenantId)))
      .returning();
    return rowToDefinition(row);
  }
}

export const objectTypeRegistry: ObjectTypeRegistry = new PgObjectTypeRegistry();
