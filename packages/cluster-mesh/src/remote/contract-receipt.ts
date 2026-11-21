import { createHash } from 'node:crypto';

export const WET2_CONTRACT_VERSION = 'WET-2.1' as const;
export const REMOTE_SPEC_REVISION = 'r11' as const;
export const PINNED_R11_WET2_TEXT_HASH =
  'b3c8a8fa7f3eff0c7066d0618c6d4fae1ce7f018e4ce58439e0598f23975035c';

export const REQUIRED_WET21_CLAUSES = Object.freeze([
  'clause-18-state-sync-quota',
  'clause-19-propagation-quota',
  'section-7.2-authority-sync',
  'section-6.9-pages-alignment',
] as const);

export interface Wet2CountersignatureReceipt {
  readonly contractVersion: string;
  readonly remoteSpecRevision: string;
  readonly wet2TextHash: string;
  readonly pagesSpecRevision: string | null;
  readonly pagesSpecHash: string | null;
  readonly pagesCountersigned: boolean;
  readonly pagesCountersignedBy: string | null;
  readonly acceptedClauses: readonly string[];
  readonly trackRecordId: string | null;
}

export type Wet2ReceiptRefusalCode =
  | 'missing_receipt' | 'missing_pages_countersignature' | 'stale_contract_version'
  | 'wet2_hash_mismatch' | 'missing_wet21_clause_acceptance' | 'missing_track_record';

export type Wet2ReceiptDecision =
  | { readonly ok: true; readonly contractVersion: typeof WET2_CONTRACT_VERSION; readonly wet2TextHash: string; readonly pagesSpecHash: string }
  | { readonly ok: false; readonly code: Wet2ReceiptRefusalCode; readonly reason: string; readonly liveWet2TextHash: string };

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Canonical §6 slice per SPEC_EVOL_REMOTE_FASTLANE.md §10.2: LF-normalized UTF-8 from `## 6.` up to the byte before `## 7.`. */
export function extractWet2Section(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const startMatch = /^## 6\./m.exec(normalized);
  if (!startMatch || startMatch.index === undefined) throw new Error('WET-2 section heading "## 6." not found');
  const rest = normalized.slice(startMatch.index);
  const endMatch = /^## 7\./m.exec(rest);
  if (!endMatch || endMatch.index === undefined) throw new Error('Following section heading "## 7." not found after "## 6."');
  return rest.slice(0, endMatch.index);
}

export function computeWet2TextHash(markdown: string): string {
  return createHash('sha256').update(Buffer.from(extractWet2Section(markdown), 'utf8')).digest('hex');
}

export function evaluateWet2ContractReceipt(
  receipt: Wet2CountersignatureReceipt | null,
  liveSpecMarkdown: string,
): Wet2ReceiptDecision {
  const liveWet2TextHash = computeWet2TextHash(liveSpecMarkdown);
  if (!receipt) {
    return { ok: false, code: 'missing_receipt', reason: 'No WET-2.1 countersignature receipt is recorded', liveWet2TextHash };
  }
  if (
    !receipt.pagesCountersigned || !receipt.pagesCountersignedBy?.trim()
    || !receipt.pagesSpecRevision?.trim() || !receipt.pagesSpecHash || !SHA256_HEX.test(receipt.pagesSpecHash)
  ) {
    return {
      ok: false,
      code: 'missing_pages_countersignature',
      reason: 'Pages conductor has not countersigned WET-2.1 with a citing pages revision hash',
      liveWet2TextHash,
    };
  }
  if (receipt.contractVersion !== WET2_CONTRACT_VERSION || receipt.remoteSpecRevision !== REMOTE_SPEC_REVISION) {
    return {
      ok: false,
      code: 'stale_contract_version',
      reason: `Receipt targets ${receipt.contractVersion}/${receipt.remoteSpecRevision}; expected ${WET2_CONTRACT_VERSION}/${REMOTE_SPEC_REVISION}`,
      liveWet2TextHash,
    };
  }
  if (receipt.wet2TextHash !== liveWet2TextHash) {
    return {
      ok: false,
      code: 'wet2_hash_mismatch',
      reason: `Receipt wet2TextHash ${receipt.wet2TextHash} does not match live §6 hash ${liveWet2TextHash}`,
      liveWet2TextHash,
    };
  }
  const missingClauses = REQUIRED_WET21_CLAUSES.filter((c) => !receipt.acceptedClauses.includes(c));
  if (missingClauses.length > 0) {
    return {
      ok: false,
      code: 'missing_wet21_clause_acceptance',
      reason: `Missing WET-2.1 countersigned clause acceptance: ${missingClauses.join(', ')}`,
      liveWet2TextHash,
    };
  }
  if (!receipt.trackRecordId?.trim()) {
    return { ok: false, code: 'missing_track_record', reason: 'Countersignature receipt is missing its Track record identifier', liveWet2TextHash };
  }
  return { ok: true, contractVersion: WET2_CONTRACT_VERSION, wet2TextHash: liveWet2TextHash, pagesSpecHash: receipt.pagesSpecHash };
}

/** Live repository baseline: r11 §6 merged, pages WET-2.1 countersignature pending (never fake). */
export const RM0_REPO_BASELINE_RECEIPT: Wet2CountersignatureReceipt = Object.freeze({
  contractVersion: WET2_CONTRACT_VERSION,
  remoteSpecRevision: REMOTE_SPEC_REVISION,
  wet2TextHash: PINNED_R11_WET2_TEXT_HASH,
  pagesSpecRevision: null,
  pagesSpecHash: null,
  pagesCountersigned: false,
  pagesCountersignedBy: null,
  acceptedClauses: Object.freeze([]),
  trackRecordId: null,
});
