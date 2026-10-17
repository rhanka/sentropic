import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '@sentropic/comments';
import type { CommentsExportSelection } from './transport-contracts.js';
import { CommentsTransportError } from './transport-contracts.js';
import type { ExportManifest } from '../storage/manifest.js';
import type { PortableDigestState } from '../storage/postgres/digest.js';
export interface CommentsExportPosition {
  chain: number;
  sequence: number;
  records: string;
  ordinal: string;
  predecessorHash: string | null;
}
export interface CommentsExportState {
  readonly version: 'comments-export-v1';
  readonly selection: CommentsExportSelection;
  readonly selectionDigest: string;
  readonly root: string | null;
  readonly manifest: ExportManifest;
  readonly boundaryDigest: string;
  readonly frozenAt: number;
  readonly secret: string;
  scan: CommentsExportPosition;
  digest: PortableDigestState;
  payloadDigest: string | null;
}
export const initialCommentsExportPosition = (): CommentsExportPosition => ({
  chain: 0,
  sequence: 0,
  records: '0',
  ordinal: '0',
  predecessorHash: null,
});
export const encodeCommentsExportCursor = (
  state: CommentsExportState,
  kind: 'prepare' | 'fragments' | 'records',
  position: CommentsExportPosition,
): string => {
  const payload = Buffer.from(
    canonicalJson(['comments-cursor', 'v1', kind, state.selectionDigest, state.boundaryDigest, position]),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', state.secret).update(payload).digest('base64url')}`;
};
export const decodeCommentsExportCursor = (
  state: CommentsExportState,
  kind: 'prepare' | 'fragments' | 'records',
  token: unknown,
): CommentsExportPosition => {
  const fail = (): never => {
    throw new CommentsTransportError('invalid-request', 'Invalid comments export continuation');
  };
  if (typeof token !== 'string' || token.length > 8192) return fail();
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return fail();
  const expected = createHmac('sha256', state.secret).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return fail();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 6 ||
    parsed[0] !== 'comments-cursor' ||
    parsed[1] !== 'v1' ||
    parsed[2] !== kind ||
    parsed[3] !== state.selectionDigest ||
    parsed[4] !== state.boundaryDigest
  )
    return fail();
  const position = parsed[5] as CommentsExportPosition;
  if (
    !position ||
    !Number.isSafeInteger(position.chain) ||
    position.chain < 0 ||
    position.chain > state.selection.selections.length ||
    !Number.isSafeInteger(position.sequence) ||
    position.sequence < 0 ||
    !/^(0|[1-9][0-9]*)$/.test(position.records) ||
    !/^(0|[1-9][0-9]*)$/.test(position.ordinal) ||
    (position.predecessorHash !== null && !/^[a-f0-9]{64}$/.test(position.predecessorHash))
  )
    return fail();
  return position;
};
