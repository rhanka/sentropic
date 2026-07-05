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
