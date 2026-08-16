/**
 * object-type-registry.test.ts — BR-59 registry-v0.
 *
 * Covers the ObjectTypeRegistry (CRUD + validation + anti-pollution) AND the
 * @sentropic/ubo-contracts guards (proving the private package is consumed by api).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  objectTypeRegistry,
  ObjectTypeValidationError,
  ObjectTypeNotFoundError,
} from '../../src/services/object-registry';
import { ensureOpportunityTypeRegistered, OPPORTUNITY_JSON_SCHEMA } from '../../src/services/object-registry/opportunity-type';
import { generateZodFromJsonSchema } from '../../src/services/object-registry/json-schema-to-zod';
import {
  isObjectEnvelope,
  isObjectTypeDefinition,
  isTypedReference,
  type NewObjectTypeDefinition,
  type ObjectEnvelope,
} from '@sentropic/ubo-contracts';

const TEST_PREFIX = 'test_reg_';

async function cleanup(): Promise<void> {
  await db.run(sql`DELETE FROM control.object_type_definitions WHERE object_type LIKE ${TEST_PREFIX + '%'}`);
}

const validDef = (objectType: string): NewObjectTypeDefinition => ({
  objectType,
  jsonSchema: { type: 'object', properties: { title: { type: 'string' }, ownerId: { type: 'string' } } },
  declaredQueryableFields: ['title'],
  typedReferenceFields: [
    { field: 'ownerId', targetType: 'user', kind: 'lookup', cardinality: 'one', onDelete: 'restrict' },
  ],
  classification: [{ field: 'ownerId', flags: ['pii'] }],
});

describe('@sentropic/ubo-contracts guards', () => {
  it('isTypedReference / isObjectTypeDefinition round-trip', () => {
    const def = validDef('x');
    expect(isTypedReference(def.typedReferenceFields[0])).toBe(true);
    expect(isTypedReference({ field: 'a' })).toBe(false);
    expect(isObjectTypeDefinition({ ...def, schemaVersion: 1, status: 'active' })).toBe(true);
    expect(isObjectTypeDefinition({ ...def })).toBe(false); // missing status/schemaVersion
  });

  it('isObjectEnvelope validates the DD10 shape', () => {
    const env: ObjectEnvelope = {
      id: 'o1',
      objectType: 'user',
      scope: { tenantId: 't1', workspaceId: 'w1' },
      payloadSchemaVersion: 1,
      version: 1,
      origin: 'user',
      payload: { name: 'a' },
      createdAt: '2026-06-12T00:00:00Z',
      updatedAt: '2026-06-12T00:00:00Z',
    };
    expect(isObjectEnvelope(env)).toBe(true);
    expect(isObjectEnvelope({ ...env, origin: 'bogus' })).toBe(false);
  });
});

describe('ObjectTypeRegistry (BR-59)', () => {
  afterEach(cleanup);

  it('register → get → list (global scope)', async () => {
    const def = await objectTypeRegistry.register(validDef(`${TEST_PREFIX}invoice`));
    expect(def.objectType).toBe(`${TEST_PREFIX}invoice`);
    expect(def.status).toBe('draft');
    expect(def.schemaVersion).toBe(1);
    expect(def.tenantId).toBeNull();

    const got = await objectTypeRegistry.get(`${TEST_PREFIX}invoice`);
    expect(got?.objectType).toBe(`${TEST_PREFIX}invoice`);

    const all = await objectTypeRegistry.list();
    expect(all.some((d) => d.objectType === `${TEST_PREFIX}invoice`)).toBe(true);
  });

  it('tenant-scoped types are isolated from global', async () => {
    await objectTypeRegistry.register({ ...validDef(`${TEST_PREFIX}order`), tenantId: 'tenant-a' });
    expect(await objectTypeRegistry.get(`${TEST_PREFIX}order`, 'tenant-a')).not.toBeNull();
    expect(await objectTypeRegistry.get(`${TEST_PREFIX}order`, null)).toBeNull();
  });

  it('update bumps schemaVersion on schema change; deprecate sets status', async () => {
    await objectTypeRegistry.register(validDef(`${TEST_PREFIX}lead`));
    const updated = await objectTypeRegistry.update(`${TEST_PREFIX}lead`, {
      jsonSchema: { type: 'object', properties: { title: { type: 'string' }, ownerId: { type: 'string' }, amount: { type: 'number' } } },
      declaredQueryableFields: ['title', 'amount'],
    });
    expect(updated.schemaVersion).toBe(2);
    const dep = await objectTypeRegistry.deprecate(`${TEST_PREFIX}lead`);
    expect(dep.status).toBe('deprecated');
  });

  it('rejects malformed schema / bad typed-ref / unknown queryable field', async () => {
    await expect(
      objectTypeRegistry.register({ ...validDef(`${TEST_PREFIX}bad1`), jsonSchema: { not: 'an object schema' } as any }),
    ).rejects.toBeInstanceOf(ObjectTypeValidationError);

    await expect(
      objectTypeRegistry.register({ ...validDef(`${TEST_PREFIX}bad2`), declaredQueryableFields: ['doesNotExist'] }),
    ).rejects.toBeInstanceOf(ObjectTypeValidationError);

    await expect(
      objectTypeRegistry.register({
        ...validDef(`${TEST_PREFIX}bad3`),
        typedReferenceFields: [{ field: 'missingField', targetType: 'user', kind: 'lookup', cardinality: 'one', onDelete: 'restrict' }],
      }),
    ).rejects.toBeInstanceOf(ObjectTypeValidationError);
  });

  it('update on a missing type throws ObjectTypeNotFoundError', async () => {
    await expect(objectTypeRegistry.deprecate(`${TEST_PREFIX}ghost`)).rejects.toBeInstanceOf(ObjectTypeNotFoundError);
  });
});

describe('opportunity object type (BR-59-act)', () => {
  afterEach(async () => {
    await db.run(sql`DELETE FROM control.object_type_definitions WHERE object_type = 'opportunity' AND tenant_id IS NULL`);
  });

  it('ensureOpportunityTypeRegistered registers the type, warn-only (draft) status', async () => {
    await ensureOpportunityTypeRegistered(objectTypeRegistry);
    const def = await objectTypeRegistry.get('opportunity', null);
    expect(def).not.toBeNull();
    expect(def!.status).toBe('draft');
    expect(def!.declaredQueryableFields).toContain('name');
  });

  it('ensureOpportunityTypeRegistered is idempotent (no-op if already registered)', async () => {
    await ensureOpportunityTypeRegistered(objectTypeRegistry);
    await expect(ensureOpportunityTypeRegistered(objectTypeRegistry)).resolves.toBeUndefined();
    const all = await objectTypeRegistry.list(null);
    expect(all.filter((d) => d.objectType === 'opportunity')).toHaveLength(1);
  });

  it('generateZodFromJsonSchema(OPPORTUNITY_JSON_SCHEMA) enforces the same required fields as the prior hand-written schema', () => {
    const schema = generateZodFromJsonSchema(OPPORTUNITY_JSON_SCHEMA);

    expect(schema.safeParse({ folderId: 'f_1', name: 'Opportunity A' }).success).toBe(true);
    expect(schema.safeParse({ name: 'Missing folderId' }).success).toBe(false);
    expect(schema.safeParse({ folderId: 'f_1' }).success).toBe(false); // missing required name
    expect(schema.safeParse({ folderId: 'f_1', name: '' }).success).toBe(false); // name minLength 1

    const full = schema.safeParse({
      folderId: 'f_1',
      organizationId: 'org_1',
      name: 'Opportunity B',
      technologies: ['ai', 'postgres'],
      references: [{ title: 'Doc', url: 'https://example.com' }],
      valueScores: [{ axisId: 'value', rating: 80, description: 'High' }],
    });
    expect(full.success).toBe(true);
  });
});
