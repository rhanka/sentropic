import { CommentsTransportError } from './transport-contracts.js';
export const COMMENTS_ADMISSION = Object.freeze({
  segmentsPerBody: 64,
  mentionsPerBody: 64,
  profileDepth: 8,
  targetsPerAnnotation: 32,
  shapesPerAnnotation: 128,
  defaultPageRecords: 50,
  cursorTtlSeconds: null,
});
// Count depth iteratively, before the frozen recursive profile validator or
// canonical encoder sees untrusted fields. These are module settings, not M1.
export const validateCommentsAdmission = (supplied: unknown): void => {
  if (!supplied || typeof supplied !== 'object') return;
  const record = supplied as Record<string, unknown>;
  const body = record.body as Record<string, unknown> | undefined;
  const fail = (name: string): never => {
    throw new CommentsTransportError('capacity-exceeded', `Comments admission ${name} bound exceeded`);
  };
  if (body && typeof body === 'object') {
    if (Array.isArray(body.segments) && body.segments.length > COMMENTS_ADMISSION.segmentsPerBody) fail('segments');
    if (Array.isArray(body.mentions) && body.mentions.length > COMMENTS_ADMISSION.mentionsPerBody) fail('mentions');
    const fields = (body.profile as { fields?: unknown } | undefined)?.fields;
    const pending = fields && typeof fields === 'object' ? [{ value: fields, depth: 1 }] : [];
    while (pending.length) {
      const item = pending.pop()!;
      if (item.depth > COMMENTS_ADMISSION.profileDepth) fail('profile depth');
      for (const value of Object.values(item.value))
        if (value && typeof value === 'object') pending.push({ value, depth: item.depth + 1 });
    }
  }
  if (record.kind === 'annotation-revision') {
    if (Array.isArray(record.secondary) && record.secondary.length + 1 > COMMENTS_ADMISSION.targetsPerAnnotation)
      fail('targets');
    if (Array.isArray(record.visualAnchors) && record.visualAnchors.length > COMMENTS_ADMISSION.shapesPerAnnotation)
      fail('shapes');
  }
};
