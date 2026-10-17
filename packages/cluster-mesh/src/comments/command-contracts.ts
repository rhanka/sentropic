import type { AnnotationRevisionRecord, ThreadStructureRevisionRecord, CommentRevisionRecord, RevisionProvenance, CanonicalStoreScope, ExpectedState } from '@sentropic/comments';
export type CommentsRevisionRecord = AnnotationRevisionRecord | ThreadStructureRevisionRecord | CommentRevisionRecord;
type Content<T> = Omit<T, 'kind' | 'hash' | 'link' | 'scope' | 'provenance'> & { readonly provenance: Omit<RevisionProvenance, 'registration'> };
export type CommentsRevisionRequest = { readonly scope: CanonicalStoreScope; readonly expected: ExpectedState; readonly idempotencyKey: string; readonly decisionRef: string } & (
  { readonly kind: 'annotation'; readonly content: Content<AnnotationRevisionRecord> } |
  { readonly kind: 'thread'; readonly content: Content<ThreadStructureRevisionRecord> } |
  { readonly kind: 'comment'; readonly content: Content<CommentRevisionRecord> }
);
