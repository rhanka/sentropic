/**
 * BR-59-act: the `opportunity` object type — shape-mined from the `initiatives`
 * route's prior hand-written zod (Axis-B proof, SPEC_EVOL_DATA_ARCHITECTURE.md:355-359).
 *
 * This JSON Schema literal is the SINGLE SOURCE OF TRUTH (DD2a=B): it is both
 * (a) registered into `control.object_type_definitions` at boot — the registry's
 * first production caller — and (b) used to GENERATE the initiatives route zod
 * (`generateZodFromJsonSchema`, one direction, registry → zod).
 *
 * Warn-only validation ladder (DD2a): status stays 'draft', no enforce flip here.
 */
import type { NewObjectTypeDefinition } from '@sentropic/ubo-contracts';
import type { ObjectTypeRegistry } from './object-type-registry';

const scoreEntrySchema = {
  type: 'object',
  properties: {
    axisId: { type: 'string' },
    rating: { type: 'number', minimum: 0, maximum: 100 },
    description: { type: 'string' },
  },
  required: ['axisId', 'rating', 'description'],
} as const;

export const OPPORTUNITY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    folderId: { type: 'string' },
    organizationId: { type: 'string' },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    problem: { type: 'string' },
    solution: { type: 'string' },
    process: { type: 'string' },
    domain: { type: 'string' },
    technologies: { type: 'array', items: { type: 'string' } },
    deadline: { type: 'string' },
    contact: { type: 'string' },
    benefits: { type: 'array', items: { type: 'string' } },
    metrics: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    dataSources: { type: 'array', items: { type: 'string' } },
    dataObjects: { type: 'array', items: { type: 'string' } },
    references: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          excerpt: { type: 'string' },
        },
        required: ['title', 'url'],
      },
    },
    valueScores: { type: 'array', items: scoreEntrySchema },
    complexityScores: { type: 'array', items: scoreEntrySchema },
  },
  required: ['folderId', 'name'],
} as const;

const OPPORTUNITY_DECLARED_QUERYABLE_FIELDS = ['folderId', 'organizationId', 'name'] as const;

export const opportunityTypeDefinition: NewObjectTypeDefinition = {
  objectType: 'opportunity',
  tenantId: null,
  jsonSchema: OPPORTUNITY_JSON_SCHEMA,
  declaredQueryableFields: [...OPPORTUNITY_DECLARED_QUERYABLE_FIELDS],
  typedReferenceFields: [],
  classification: [],
};

/**
 * Idempotently ensure the `opportunity` type is registered. Safe to call on
 * every boot: no-ops if a definition already exists for this scope.
 */
export async function ensureOpportunityTypeRegistered(
  registry: Pick<ObjectTypeRegistry, 'get' | 'register'>
): Promise<void> {
  const existing = await registry.get('opportunity', null);
  if (existing) return;
  await registry.register(opportunityTypeDefinition);
}
