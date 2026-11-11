export type {
  ObjectScope,
  ObjectOrigin,
  ObjectLineage,
  ObjectEnvelope,
  ReferenceKind,
  Cardinality,
  OnDelete,
  TypedReference,
  ClassificationFlag,
  FieldClassification,
  ObjectTypeStatus,
  ObjectTypeDefinition,
  NewObjectTypeDefinition,
} from './types.js';

export {
  isReferenceKind,
  isObjectTypeStatus,
  isTypedReference,
  isObjectTypeDefinition,
  isObjectEnvelope,
} from './guards.js';

export {
  ObjectTypeValidationError,
  ObjectTypeNotFoundError,
  MAX_TYPES_PER_SCOPE,
  MAX_QUERYABLE_FIELDS,
  MAX_TYPED_REFERENCES,
  schemaPropertyNames,
  fieldHead,
  validateDefinition,
  type ObjectTypeRegistry,
} from './object-type-registry.js';
