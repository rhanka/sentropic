import * as Y from 'yjs';

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
  | 'preserved-content'
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
  vectorBefore: Uint8Array;
  vectorAfter: Uint8Array;
  authoritativeParagraphIds: string[];
  resultingParagraphIds: string[];
  firstSeparatorDeleted: boolean;
}

export interface YjsIngressClassifier {
  validateAgainstAuthoritative(
    bytes: Uint8Array,
    authoritative: Y.Doc,
    admittedFields: string[],
  ): { classified: ClassifiedUpdate; candidate: ScratchCandidate };
}

const ALLOWED_MARKS: Record<string, (value: unknown) => boolean> = {
  bold: (value) => value === true || value === null,
  italic: (value) => value === true || value === null,
  code: (value) => value === true || value === null,
};

const ALLOWED_EMBEDS = new Set(['separator', 'hard-break']);

const RESERVED_ROOTS = new Set(['preserved', 'preserved-bytes', 'segments']);

type QuillDelta = { insert?: unknown; retain?: number; attributes?: Record<string, unknown> }[];

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
    } else if (type === 'identity') {
      throw new IngressRefusal('identity-rewrite');
    } else if (RESERVED_ROOTS.has(type)) {
      throw new IngressRefusal('preserved-content');
    } else if (type !== 'meta') {
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

/**
 * State vectors are varuint-encoded (client, clock + 1) pairs, lib0 LEB128 style.
 */
function decodeStateVector(bytes: Uint8Array): Map<number, number> {
  let pos = 0;
  const readVarUint = (): number => {
    let num = 0;
    let mult = 1;
    for (;;) {
      if (pos >= bytes.length) throw new IngressRefusal('decode-failed');
      const byte = bytes[pos++];
      num += (byte & 0x7f) * mult;
      if (byte < 0x80) return num;
      mult *= 128;
    }
  };
  const count = readVarUint();
  const clocks = new Map<number, number>();
  for (let i = 0; i < count; i += 1) {
    const client = readVarUint();
    const clock = readVarUint();
    if (clock > 0) clocks.set(client, clock - 1);
  }
  if (pos !== bytes.length) throw new IngressRefusal('decode-failed');
  return clocks;
}

export function isVectorRegressive(vectorBefore: Uint8Array, vectorAfter: Uint8Array): boolean {
  const before = decodeStateVector(vectorBefore);
  const after = decodeStateVector(vectorAfter);
  for (const [client, clock] of before) {
    if ((after.get(client) ?? -1) < clock) return true;
  }
  return false;
}

export function validateVectorFreshness(vectorBefore: Uint8Array, vectorAfter: Uint8Array): void {
  if (isVectorRegressive(vectorBefore, vectorAfter)) throw new IngressRefusal('stale-vector');
}

export function validateResultingSchema(candidate: ScratchCandidate, _admittedFields: string[]): void {
  const seen = new Set<string>();
  for (const id of candidate.resultingParagraphIds) {
    if (!id || seen.has(id)) throw new IngressRefusal('duplicate-paragraph');
    seen.add(id);
  }
  if (candidate.firstSeparatorDeleted) throw new IngressRefusal('first-separator-delete');
}

function separatorIdsOf(delta: QuillDelta): string[] {
  const ids: string[] = [];
  for (const entry of delta) {
    const insert = entry.insert as { type?: unknown; paragraphId?: unknown } | undefined;
    if (insert && typeof insert === 'object' && insert.type === 'separator' && typeof insert.paragraphId === 'string') {
      ids.push(insert.paragraphId);
    }
  }
  return ids;
}

function collectTextDetail(
  entries: QuillDelta,
  marks: { name: string; value: unknown }[],
  embeds: { kind: string; payload: unknown }[],
  paragraphIds: string[],
): void {
  for (const entry of entries) {
    const insert = entry.insert;
    if (typeof insert === 'string') {
      // R-LIN-4: only string content carries submitter marks; embed attributes are inherited span noise.
      for (const [name, value] of Object.entries(entry.attributes ?? {})) marks.push({ name, value });
    } else if (insert && typeof insert === 'object') {
      const payload = insert as Record<string, unknown>;
      embeds.push({ kind: typeof payload.type === 'string' ? payload.type : 'unknown', payload });
      if (payload.type === 'separator' && typeof payload.paragraphId === 'string') paragraphIds.push(payload.paragraphId);
    } else if (entry.attributes) {
      // Format operations surface as retain entries carrying the span attributes they open.
      for (const [name, value] of Object.entries(entry.attributes)) marks.push({ name, value });
    }
  }
}

export function createYjsIngressClassifier(): YjsIngressClassifier {
  return {
    validateAgainstAuthoritative(bytes, authoritative, admittedFields) {
      const scratch = new Y.Doc({ gc: false });
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(authoritative));
      const vectorBefore = Y.encodeStateVector(scratch);
      const observedEvents = new Map<string, QuillDelta>();
      for (const name of scratch.share.keys()) {
        if (!name.startsWith('field:')) continue;
        scratch.getText(name).observe((event) => {
          const entries = observedEvents.get(name) ?? [];
          entries.push(...(event.delta as QuillDelta));
          observedEvents.set(name, entries);
        });
      }
      const changedTypes = new Set<unknown>();
      scratch.on('afterTransaction', (transaction) => {
        for (const type of transaction.changed.keys()) changedTypes.add(type);
      });
      try {
        Y.applyUpdate(scratch, bytes);
      } catch {
        throw new IngressRefusal('decode-failed');
      }
      const vectorAfter = Y.encodeStateVector(scratch);
      const affectedTypes = [...scratch.share.entries()]
        .filter(([, type]) => changedTypes.has(type))
        .map(([name]) => name)
        .sort();
      const operationFamilies: string[] = [];
      if (affectedTypes.some((type) => type.startsWith('field:'))) operationFamilies.push('text');
      if (affectedTypes.some((type) => type.startsWith('fieldmeta:'))) operationFamilies.push('fieldmeta');
      if (affectedTypes.includes('meta')) operationFamilies.push('meta');
      const detailRoots = affectedTypes.filter(
        (name) => name.startsWith('field:') && admittedFields.includes(name.slice('field:'.length)),
      );
      const marks: { name: string; value: unknown }[] = [];
      const embeds: { kind: string; payload: unknown }[] = [];
      const paragraphIds: string[] = [];
      const authoritativeParagraphIds: string[] = [];
      const resultingParagraphIds: string[] = [];
      let firstSeparatorDeleted = false;
      const deletedSeparators: string[] = [];
      for (const name of detailRoots) {
        const beforeDelta = authoritative.getText(name).toDelta() as QuillDelta;
        const afterDelta = scratch.getText(name).toDelta() as QuillDelta;
        const events = observedEvents.get(name);
        // A root the authoritative state never held was created by this candidate,
        // so its whole resulting content is the submitted detail.
        collectTextDetail(events ?? afterDelta, marks, embeds, paragraphIds);
        const beforeSeps = separatorIdsOf(beforeDelta);
        const afterSeps = separatorIdsOf(afterDelta);
        authoritativeParagraphIds.push(...beforeSeps);
        resultingParagraphIds.push(...afterSeps);
        const survivors = new Set(afterSeps);
        for (const id of beforeSeps) {
          if (!survivors.has(id)) deletedSeparators.push(id);
        }
        if (beforeSeps.length > 0 && !survivors.has(beforeSeps[0])) firstSeparatorDeleted = true;
      }
      if (firstSeparatorDeleted) deletedSeparators.push('first');
      return {
        classified: {
          affectedTypes,
          operationFamilies,
          hasUnresolvedStructs: scratch.store.pendingStructs !== null || scratch.store.pendingDs !== null,
          paragraphIds,
          deletedSeparators,
          marks,
          embeds,
          metaWrites: affectedTypes.filter((type) => type === 'meta'),
        },
        candidate: {
          vectorBefore,
          vectorAfter,
          authoritativeParagraphIds,
          resultingParagraphIds,
          firstSeparatorDeleted,
        },
      };
    },
  };
}
