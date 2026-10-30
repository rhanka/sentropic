export type RefusalClass =
  | 'decode-failed'
  | 'frame-too-large'
  | 'logical-update-too-large'
  | 'incomplete-frame'
  | 'actor-denied'
  | 'scope-denied'
  | 'revoked'
  | 'reserved-meta'
  | 'foreign-field'
  | 'foreign-meta'
  | 'identity-rewrite'
  | 'invalid-separator'
  | 'duplicate-paragraph'
  | 'first-separator-delete'
  | 'unsupported-mark'
  | 'unsupported-embed'
  | 'disallowed-metadata'
  | 'stale-vector'
  | 'unresolved-struct';

export class IngressRefusal extends Error {
  constructor(readonly refusal: RefusalClass) {
    super(refusal);
  }
}

export interface ClassifiedUpdate {
  affectedTypes: string[];
  operationFamilies: string[];
  hasUnresolvedStructs: boolean;
  paragraphIds: string[];
  deletedSeparators: string[];
  marks: { name: string; value: unknown }[];
  embeds: { kind: string; payload: unknown }[];
  metaWrites: string[];
}

export interface ScratchCandidate {
  vectorAfter: string;
  deltaText: string;
  typesAfter: string[];
}

export interface IngressClassifier {
  decode(bytes: Uint8Array): unknown;
  classify(decoded: unknown, admittedFields: string[]): ClassifiedUpdate;
  applyToScratch(authoritative: unknown, decoded: unknown): ScratchCandidate;
  isVectorRegressive(vectorBefore: string, vectorAfter: string): boolean;
  validateResultingSchema(candidate: ScratchCandidate, admittedFields: string[]): void;
}

const ALLOWED_MARKS: Record<string, (value: unknown) => boolean> = {
  bold: (value) => value === true || value === null,
  italic: (value) => value === true || value === null,
  code: (value) => value === true || value === null,
};

const ALLOWED_EMBEDS = new Set(['separator', 'hard-break']);

export function classifyStateless(
  affectedTypes: string[],
  admittedFields: string[],
  options: {
    marks?: { name: string; value: unknown }[];
    embeds?: { kind: string; payload: unknown }[];
    metaWrites?: string[];
    paragraphIds?: string[];
    deletedSeparators?: string[];
    hasUnresolvedStructs?: boolean;
  } = {},
): ClassifiedUpdate {
  const operationFamilies: string[] = [];
  if (affectedTypes.some((type) => type.startsWith('field:'))) operationFamilies.push('text');
  if (affectedTypes.some((type) => type.startsWith('fieldmeta:'))) operationFamilies.push('fieldmeta');
  if (affectedTypes.includes('meta')) operationFamilies.push('meta');
  return {
    affectedTypes: [...affectedTypes],
    operationFamilies,
    hasUnresolvedStructs: options.hasUnresolvedStructs ?? false,
    paragraphIds: options.paragraphIds ?? [],
    deletedSeparators: options.deletedSeparators ?? [],
    marks: options.marks ?? [],
    embeds: options.embeds ?? [],
    metaWrites: options.metaWrites ?? [],
  };
}

export function validateClassified(
  classified: ClassifiedUpdate,
  admittedFields: string[],
  seenParagraphIds: ReadonlySet<string> = new Set(),
): void {
  if (classified.metaWrites.length > 0 || classified.affectedTypes.includes('meta')) {
    throw new IngressRefusal('reserved-meta');
  }
  for (const type of classified.affectedTypes) {
    if (type.startsWith('field:')) {
      const field = type.slice('field:'.length);
      if (!admittedFields.includes(field)) throw new IngressRefusal('foreign-field');
    } else if (type.startsWith('fieldmeta:')) {
      throw new IngressRefusal('foreign-meta');
    } else if (type !== 'meta' && !type.startsWith('field:') && !type.startsWith('fieldmeta:')) {
      throw new IngressRefusal('disallowed-metadata');
    }
  }
  const ids = new Set<string>();
  for (const id of classified.paragraphIds) {
    if (!id || ids.has(id) || seenParagraphIds.has(id)) throw new IngressRefusal('duplicate-paragraph');
    ids.add(id);
  }
  for (const mark of classified.marks) {
    const allowed = ALLOWED_MARKS[mark.name];
    if (!allowed || !allowed(mark.value)) throw new IngressRefusal('unsupported-mark');
  }
  for (const embed of classified.embeds) {
    if (!ALLOWED_EMBEDS.has(embed.kind)) throw new IngressRefusal('unsupported-embed');
    if (embed.kind === 'separator') {
      const payload = embed.payload as { paragraphId?: unknown } | null;
      if (!payload || typeof payload.paragraphId !== 'string' || payload.paragraphId.length === 0) {
        throw new IngressRefusal('invalid-separator');
      }
    }
  }
  if (classified.deletedSeparators.includes('first')) throw new IngressRefusal('first-separator-delete');
}

export function validateVectorFreshness(vectorBefore: string, vectorAfter: string): void {
  if (vectorBefore === vectorAfter) throw new IngressRefusal('stale-vector');
}
