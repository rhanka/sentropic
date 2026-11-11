/**
 * Object-type registry (ARCH-19 / BR-59) — Postgres adapter.
 *
 * Validation and the `ObjectTypeRegistry` port live in
 * `@sentropic/ubo-contracts` (CODE move, T5a); this module keeps only the
 * Postgres adapter over `control.object_type_definitions`.
 * No state move, no migration.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { objectTypeDefinitions, type ObjectTypeDefinitionRow } from '../../db/control-schema';
import { createId } from '../../utils/id';
import {
  MAX_TYPES_PER_SCOPE,
  ObjectTypeNotFoundError,
  ObjectTypeValidationError,
  validateDefinition,
  type FieldClassification,
  type NewObjectTypeDefinition,
  type ObjectTypeDefinition,
  type ObjectTypeRegistry,
  type ObjectTypeStatus,
  type TypedReference,
} from '@sentropic/ubo-contracts';

export type { ObjectTypeRegistry };
export { ObjectTypeValidationError, ObjectTypeNotFoundError };

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
