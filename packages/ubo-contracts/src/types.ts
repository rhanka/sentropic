/**
 * UBO contracts — types only (no runtime deps).
 *
 * This is the Universal Business Object envelope (DD10) and the object-type
 * registry wire format (ARCH-19), kept DELIBERATELY separate from the published
 * `@sentropic/contracts` `EventEnvelope`: DD10 rejected a fixed `tenant:
 * TenantContext` scope in favour of a BINDING-DEFINED scope map. This package is
 * UNPUBLISHED (DD6) until the envelope is proven.
 */

// ── DD10 object envelope ──────────────────────────────────────────────────────

/** Binding-defined scope map (DD10). The Sentropic binding = `{ tenantId, workspaceId }`; external builders define their own keys. */
export type ObjectScope = Readonly<Record<string, string>>;

export type ObjectOrigin = 'user' | 'agent' | 'system' | 'import';

export interface ObjectLineage {
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly derivedFrom?: ReadonlyArray<string>;
}

/** The Universal Business Object envelope (DD10). `version` is the CAS/optimistic-concurrency counter. */
export interface ObjectEnvelope<TPayload = unknown> {
  readonly id: string;
  readonly objectType: string;
  readonly scope: ObjectScope;
  /** Per-payload schema version (DD8), distinct from the registry type's schemaVersion. */
  readonly payloadSchemaVersion: number;
  /** Optimistic-concurrency (CAS) counter — incremented on every write. */
  readonly version: number;
  readonly origin: ObjectOrigin;
  readonly idempotencyKey?: string;
  /** Soft-delete marker (ISO timestamp); null/absent = live. */
  readonly deletedAt?: string | null;
  readonly lineage?: ObjectLineage;
  readonly payload: TPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── ARCH-19 object-type registry wire format ──────────────────────────────────

/** DD7 reference semantics — modelled at the ID level, NEVER as a DB foreign key. */
export type ReferenceKind = 'lookup' | 'containment';
export type Cardinality = 'one' | 'many';
export type OnDelete = 'restrict' | 'cascade' | 'set-null';

export interface TypedReference {
  /** Payload field path holding the reference id(s). */
  readonly field: string;
  /** The `objectType` this field points at. */
  readonly targetType: string;
  readonly kind: ReferenceKind;
  readonly cardinality: Cardinality;
  /** ID-level on-delete policy (enforced by the resolver, not a DB FK — DD7). */
  readonly onDelete: OnDelete;
}

export type ClassificationFlag = 'pii' | 'secret' | 'sensitive';

export interface FieldClassification {
  readonly field: string;
  readonly flags: ReadonlyArray<ClassificationFlag>;
}

export type ObjectTypeStatus = 'draft' | 'active' | 'deprecated';

/** A registered object type — the registry row's wire shape (ARCH-19). */
export interface ObjectTypeDefinition {
  readonly objectType: string;
  /** null/absent = global / first-party type; set = tenant-scoped custom type (DD9). */
  readonly tenantId?: string | null;
  /** JSON Schema for the payload. */
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  /** Field paths exposed as queryable → drive generated indexes (index-generation is BR-61, not here). */
  readonly declaredQueryableFields: ReadonlyArray<string>;
  readonly typedReferenceFields: ReadonlyArray<TypedReference>;
  readonly classification: ReadonlyArray<FieldClassification>;
  readonly schemaVersion: number;
  readonly status: ObjectTypeStatus;
}

/** Input shape for registering/updating a type (server fills timestamps/version). */
export type NewObjectTypeDefinition = Omit<ObjectTypeDefinition, 'status' | 'schemaVersion'> & {
  readonly status?: ObjectTypeStatus;
  readonly schemaVersion?: number;
};
