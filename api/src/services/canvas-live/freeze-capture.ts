import type { LiveBaseline, LiveParagraph } from '../../../../packages/chat-core/src/live-document-port';

export interface CompleteCapture {
  complete: boolean;
  fields: readonly { fieldKey: string; blocks: readonly {
    paragraphId: string; serialized: string; representable: boolean;
  }[] }[];
}
/** Structural injection of @sentropic/focus/editing at h2a 98060bd0a.
 * A caller supplies the pinned pure API; H2 neither publishes nor advances a head. */
export interface FocusDiffPort<T> {
  diffParagraphs(baseline: LiveParagraph[], draft: LiveParagraph[], transactionId: string): T;
}
export function captureBaselineDiff<T>(baseline: LiveBaseline, capture: CompleteCapture,
  transactionId: string, focus: FocusDiffPort<T>): { baseline: LiveBaseline; transaction: T } {
  if (!capture.complete || capture.fields.length !== baseline.fields.length) throw new Error('incomplete-capture');
  const seenFields = new Set<string>(), seenParagraphs = new Set<string>();
  const draft: LiveParagraph[] = [];
  for (const field of capture.fields) {
    const mapping = baseline.fields.find(f => f.fieldKey === field.fieldKey);
    if (!mapping || seenFields.has(field.fieldKey)) throw new Error('unmapped-capture');
    seenFields.add(field.fieldKey);
    for (const block of field.blocks) {
      if (!block.representable || !block.paragraphId || seenParagraphs.has(block.paragraphId)) throw new Error('invalid-capture');
      seenParagraphs.add(block.paragraphId);
      const prior = baseline.paragraphs.find(p => p.paragraphId === block.paragraphId);
      if (prior && (prior.nodeId !== mapping.address.nodeId || prior.field !== mapping.address.field
        || prior.targetRef !== mapping.address.targetRef)) throw new Error('capture-identity-mismatch');
      draft.push({ ...mapping.address, documentRef: baseline.documentRef, paragraphId: block.paragraphId,
        blockKind: 'paragraph', text: block.serialized });
    }
  }
  return { baseline: structuredClone(baseline), transaction: focus.diffParagraphs(
    structuredClone([...baseline.paragraphs]), draft, transactionId,
  ) };
}
