import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createYjsIngressClassifier,
  IngressRefusal,
  isVectorRegressive,
  validateClassified,
  validateResultingSchema,
  validateVectorFreshness,
} from '../../src/services/canvas-live/ingress';

type Separator = { type: 'separator'; paragraphId: string };

function authoritativeDoc() {
  const doc = new Y.Doc({ gc: false });
  doc.getMap('meta').set('profileId', 'full@1');
  doc.getMap('meta').set('schemaEpoch', '2');
  doc.transact(() => {
    const text = doc.getText('field:body');
    text.insert(0, 'hello');
    text.insert(5, { type: 'separator', paragraphId: 'p-1' } as unknown as string);
    text.insert(6, 'world');
  });
  return doc;
}

function deltaFrom(authoritative: Y.Doc, edit: (client: Y.Doc) => void): Uint8Array {
  const client = new Y.Doc({ gc: false });
  Y.applyUpdate(client, Y.encodeStateAsUpdate(authoritative));
  const before = Y.encodeStateVector(client);
  edit(client);
  return Y.encodeStateAsUpdate(client, before);
}

const classifier = createYjsIngressClassifier();
const validate = (bytes: Uint8Array, authoritative: Y.Doc, fields: string[] = ['body']) =>
  classifier.validateAgainstAuthoritative(bytes, authoritative, fields);

describe('canvas live ingress classification', () => {
  it('should classify a legitimate text update into the admitted field', () => {
    const authoritative = authoritativeDoc();
    const bytes = deltaFrom(authoritative, (client) => client.getText('field:body').insert(11, '!'));
    const { classified, candidate } = validate(bytes, authoritative);
    expect(classified.affectedTypes).toEqual(['field:body']);
    expect(classified.operationFamilies).toEqual(['text']);
    expect(classified.hasUnresolvedStructs).toBe(false);
    expect(candidate.resultingParagraphIds).toEqual(['p-1']);
  });

  it('should refuse undecodable input whole', () => {
    const authoritative = authoritativeDoc();
    const full = deltaFrom(authoritative, (client) => client.getText('field:body').insert(0, 'x'));
    const truncated = full.slice(0, full.byteLength - 4);
    expect(() => validate(truncated, authoritative)).toThrow(IngressRefusal);
  });

  it('should flag unresolved structs for quarantine instead of applying them', () => {
    const authoritative = authoritativeDoc();
    // op1 lands only in the client lineage; op2 references it, so op2 alone stays pending.
    const clientWithDep = new Y.Doc({ gc: false });
    Y.applyUpdate(clientWithDep, Y.encodeStateAsUpdate(authoritative));
    const forkVector = Y.encodeStateVector(clientWithDep);
    clientWithDep.getText('field:body').insert(0, 'A');
    const fork = new Y.Doc({ gc: false });
    Y.applyUpdate(fork, Y.encodeStateAsUpdate(authoritative));
    Y.applyUpdate(fork, Y.encodeStateAsUpdate(clientWithDep, forkVector));
    const forkWithDepVector = Y.encodeStateVector(fork);
    fork.getText('field:body').insert(1, 'B');
    const pendingBytes = Y.encodeStateAsUpdate(fork, forkWithDepVector);
    const { classified } = validate(pendingBytes, authoritative);
    expect(classified.hasUnresolvedStructs).toBe(true);
    expect(classified.affectedTypes).toEqual([]);
  });

  it('should refuse reserved meta writes and foreign field or meta maps from real updates', () => {
    const authoritative = authoritativeDoc();
    const metaWrite = deltaFrom(authoritative, (client) => client.getMap('meta').set('schemaEpoch', '3'));
    expect(() => validateClassified(validate(metaWrite, authoritative).classified, ['body'])).toThrow('reserved-meta');
    const foreignField = deltaFrom(authoritative, (client) => client.getText('field:other').insert(0, 'x'));
    expect(() => validateClassified(validate(foreignField, authoritative).classified, ['body'])).toThrow('foreign-field');
    const foreignMeta = deltaFrom(authoritative, (client) => client.getMap('fieldmeta:body').set('k', 1));
    expect(() => validateClassified(validate(foreignMeta, authoritative).classified, ['body'])).toThrow('foreign-meta');
  });

  it('should refuse identity rewrites and preserved bytes or segment writes', () => {
    const authoritative = authoritativeDoc();
    const identity = deltaFrom(authoritative, (client) => client.getText('identity').insert(0, 'x'));
    expect(() => validateClassified(validate(identity, authoritative).classified, ['body'])).toThrow('identity-rewrite');
    const preserved = deltaFrom(authoritative, (client) => client.getText('preserved').insert(0, 'x'));
    expect(() => validateClassified(validate(preserved, authoritative).classified, ['body'])).toThrow('preserved-content');
    const segments = deltaFrom(authoritative, (client) => client.getMap('segments').set('s', 1));
    expect(() => validateClassified(validate(segments, authoritative).classified, ['body'])).toThrow('preserved-content');
  });

  it('should accept allowed marks and refuse unsupported marks whole', () => {
    const authoritative = authoritativeDoc();
    const bold = deltaFrom(authoritative, (client) => client.getText('field:body').format(0, 5, { bold: true }));
    const boldClassified = validate(bold, authoritative).classified;
    expect(boldClassified.marks).toContainEqual({ name: 'bold', value: true });
    expect(() => validateClassified(boldClassified, ['body'])).not.toThrow();
    const underline = deltaFrom(authoritative, (client) => client.getText('field:body').format(0, 5, { underline: true }));
    expect(() => validateClassified(validate(underline, authoritative).classified, ['body'])).toThrow('unsupported-mark');
    const badValue = deltaFrom(authoritative, (client) => client.getText('field:body').format(0, 5, { bold: 'thick' }));
    expect(() => validateClassified(validate(badValue, authoritative).classified, ['body'])).toThrow('unsupported-mark');
  });

  it('should ignore inherited span attributes on separator and hard-break embeds per R-LIN-4', () => {
    const authoritative = authoritativeDoc();
    const bytes = deltaFrom(authoritative, (client) => {
      const text = client.getText('field:body');
      text.insert(11, { type: 'separator', paragraphId: 'p-2' } as unknown as string);
      text.insert(12, { type: 'hard-break' } as unknown as string);
      text.format(11, 2, { bold: true });
    });
    const { classified, candidate } = validate(bytes, authoritative);
    expect(classified.marks).toEqual([]);
    expect(() =>
      validateClassified(classified, ['body'], new Set(candidate.authoritativeParagraphIds)),
    ).not.toThrow();
    expect(candidate.resultingParagraphIds).toEqual(['p-1', 'p-2']);
  });

  it('should refuse unsupported embeds and invalid separator payloads', () => {
    const authoritative = authoritativeDoc();
    const image = deltaFrom(authoritative, (client) =>
      client.getText('field:body').insert(6, { type: 'image', url: 'http://x' } as unknown as string));
    expect(() => validateClassified(validate(image, authoritative).classified, ['body'])).toThrow('unsupported-embed');
    const badSeparator = deltaFrom(authoritative, (client) =>
      client.getText('field:body').insert(6, { type: 'separator' } as unknown as string));
    expect(() => validateClassified(validate(badSeparator, authoritative).classified, ['body'])).toThrow('invalid-separator');
  });

  it('should refuse duplicate paragraph identities and first-separator deletes on the resulting schema', () => {
    const authoritative = authoritativeDoc();
    const collision = deltaFrom(authoritative, (client) =>
      client.getText('field:body').insert(11, { type: 'separator', paragraphId: 'p-1' } as unknown as string));
    const collisionValidation = validate(collision, authoritative);
    expect(() =>
      validateResultingSchema(collisionValidation.candidate, ['body']),
    ).toThrow('duplicate-paragraph');
    const withinUpdate = deltaFrom(authoritative, (client) => {
      const text = client.getText('field:body');
      text.insert(11, { type: 'separator', paragraphId: 'p-2' } as unknown as string);
      text.insert(12, { type: 'separator', paragraphId: 'p-2' } as unknown as string);
    });
    expect(() => validateClassified(validate(withinUpdate, authoritative).classified, ['body'])).toThrow('duplicate-paragraph');
    const deleteFirst = deltaFrom(authoritative, (client) => client.getText('field:body').delete(5, 1));
    const deleteValidation = validate(deleteFirst, authoritative);
    expect(() =>
      validateClassified(deleteValidation.classified, ['body']),
    ).toThrow('first-separator-delete');
    expect(() =>
      validateResultingSchema(deleteValidation.candidate, ['body']),
    ).toThrow('first-separator-delete');
  });

  it('should refuse candidate results that regress the authoritative state vector and accept older valid concurrent updates', () => {
    const authoritativeForVectors = authoritativeDoc();
    const before = Y.encodeStateVector(authoritativeForVectors);
    const after = Y.encodeStateVector(authoritativeForVectors);
    expect(isVectorRegressive(before, after)).toBe(false);
    const docLowClock = new Y.Doc({ gc: false });
    docLowClock.getText('field:body').insert(0, 'x');
    const regressive = Y.encodeStateVector(docLowClock);
    expect(isVectorRegressive(before, regressive)).toBe(true);
    expect(() => validateVectorFreshness(before, regressive)).toThrow('stale-vector');
    expect(() => validateVectorFreshness(before, after)).not.toThrow();
    const authoritative = authoritativeDoc();
    const concurrentBase = new Y.Doc({ gc: false });
    Y.applyUpdate(concurrentBase, Y.encodeStateAsUpdate(authoritative));
    const staleClone = new Y.Doc({ gc: false });
    Y.applyUpdate(staleClone, Y.encodeStateAsUpdate(authoritative));
    authoritative.getText('field:body').insert(0, 'newer');
    const staleVector = Y.encodeStateVector(concurrentBase);
    staleClone.getText('field:body').insert(11, 'older');
    const olderUpdate = Y.encodeStateAsUpdate(staleClone, staleVector);
    const { candidate } = validate(olderUpdate, authoritative);
    expect(() => validateVectorFreshness(candidate.vectorBefore, candidate.vectorAfter)).not.toThrow();
  });

  it('should accept an already-integrated replay as a valid no-op', () => {
    const authoritative = authoritativeDoc();
    const replay = deltaFrom(authoritative, (client) => client.getText('field:body').insert(11, '!'));
    const first = validate(replay, authoritative);
    expect(() =>
      validateVectorFreshness(first.candidate.vectorBefore, first.candidate.vectorAfter),
    ).not.toThrow();
    Y.applyUpdate(authoritative, replay);
    const second = validate(replay, authoritative);
    expect(second.classified.affectedTypes).toEqual([]);
    expect(() =>
      validateVectorFreshness(second.candidate.vectorBefore, second.candidate.vectorAfter),
    ).not.toThrow();
  });
});
