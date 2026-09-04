import type { AnnotationPort, AnnotationRecord, NewAnnotation } from './types';

/**
 * In-memory `AnnotationPort` — the default for dev and for anonymous-first
 * surfaces that have no persistence yet.
 *
 * This is deliberately NOT a comment domain: it stores exactly what the overlay
 * renders (anchor key + body + thread grouping), and nothing about tenancy,
 * authorship identity, assignment or lifecycle. A real host implements the same
 * port over `@sentropic/comments`, which owns all of that.
 */
export function createInMemoryAnnotationPort(
  opts: { idFactory?: () => string } = {},
): AnnotationPort {
  let seq = 0;
  const nextId = opts.idFactory ?? (() => `ann-${(seq += 1)}`);
  const records: AnnotationRecord[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((cb) => cb());

  return {
    listOpen: () => records.filter((r) => !r.resolved),
    add(input: NewAnnotation): AnnotationRecord {
      const record: AnnotationRecord = {
        id: nextId(),
        anchorKey: input.anchorKey,
        body: input.body,
        threadId: input.threadId ?? nextId(),
        origin: input.origin ?? 'human',
        resolved: false,
      };
      records.push(record);
      emit();
      return record;
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * Structured annotation context for a model: anchor + text + provenance, never
 * pixels. The host decides how to inject it (e.g. through a local-tool handoff).
 * `origin` is carried through so machine-proposed content is never laundered
 * into looking human-authored.
 */
export function annotationsForAI(
  port: AnnotationPort,
): Array<{ threadId: string; anchorKey: string; body: string; origin: 'human' | 'machine' }> {
  return port.listOpen().map((r) => ({
    threadId: r.threadId ?? r.id,
    anchorKey: r.anchorKey,
    body: r.body,
    origin: r.origin ?? 'human',
  }));
}
