import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  computeWet2TextHash,
  evaluateWet2ContractReceipt,
  extractWet2Section,
  PINNED_R11_WET2_TEXT_HASH,
  REMOTE_SPEC_REVISION,
  REQUIRED_WET21_CLAUSES,
  RM0_REPO_BASELINE_RECEIPT,
  WET2_CONTRACT_VERSION,
  type Wet2CountersignatureReceipt,
} from '../../src/remote/contract-receipt.js';

const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../spec/SPEC_EVOL_REMOTE_FASTLANE.md',
);
const LIVE_SPEC_MARKDOWN = readFileSync(SPEC_PATH, 'utf8');

function makeSyntheticValidReceipt(overrides: Partial<Wet2CountersignatureReceipt> = {}): Wet2CountersignatureReceipt {
  return {
    contractVersion: WET2_CONTRACT_VERSION,
    remoteSpecRevision: REMOTE_SPEC_REVISION,
    wet2TextHash: PINNED_R11_WET2_TEXT_HASH,
    pagesSpecRevision: 'r11-synthetic-fixture',
    pagesSpecHash: 'a'.repeat(64),
    pagesCountersigned: true,
    pagesCountersignedBy: 'pages-conductor-fixture',
    acceptedClauses: [...REQUIRED_WET21_CLAUSES],
    trackRecordId: '01FIXTURETRACKRECORD000000',
    ...overrides,
  };
}

describe('RM-0 (g) contract baseline: WET-2.1 canonical hash and pages receipt evaluator', () => {
  it('computes the canonical LF-normalized SHA-256 of §6 from ## 6. up to the byte before ## 7.', () => {
    const slice = extractWet2Section(LIVE_SPEC_MARKDOWN);
    expect(slice.startsWith('## 6. ')).toBe(true);
    expect(slice).not.toContain('\r');
    expect(slice).not.toContain('## 7.');

    const liveHash = computeWet2TextHash(LIVE_SPEC_MARKDOWN);
    expect(liveHash).toBe(PINNED_R11_WET2_TEXT_HASH);

    const crlfSpec = LIVE_SPEC_MARKDOWN.replaceAll('\n', '\r\n');
    expect(computeWet2TextHash(crlfSpec)).toBe(PINNED_R11_WET2_TEXT_HASH);
  });

  it('refuses an unsigned or missing pages receipt', () => {
    expect(evaluateWet2ContractReceipt(null, LIVE_SPEC_MARKDOWN)).toMatchObject({
      ok: false,
      code: 'missing_receipt',
    });
    expect(evaluateWet2ContractReceipt(
      makeSyntheticValidReceipt({ pagesCountersigned: false, pagesCountersignedBy: null, pagesSpecHash: null }),
      LIVE_SPEC_MARKDOWN,
    )).toMatchObject({
      ok: false,
      code: 'missing_pages_countersignature',
    });
  });

  it('refuses a stale pages receipt targeting pre-r11 WET-2, missing WET-2.1 clause acceptance, or missing Track id', () => {
    expect(evaluateWet2ContractReceipt(
      makeSyntheticValidReceipt({ contractVersion: 'WET-2', remoteSpecRevision: 'r9' }),
      LIVE_SPEC_MARKDOWN,
    )).toMatchObject({
      ok: false,
      code: 'stale_contract_version',
    });

    expect(evaluateWet2ContractReceipt(
      makeSyntheticValidReceipt({ acceptedClauses: ['clause-18-state-sync-quota'] }),
      LIVE_SPEC_MARKDOWN,
    )).toMatchObject({
      ok: false,
      code: 'missing_wet21_clause_acceptance',
    });

    expect(evaluateWet2ContractReceipt(
      makeSyntheticValidReceipt({ trackRecordId: null }),
      LIVE_SPEC_MARKDOWN,
    )).toMatchObject({
      ok: false,
      code: 'missing_track_record',
    });
  });

  it('refuses a previously matching receipt when §6 text is amended by even one byte', () => {
    const amendedSpec = LIVE_SPEC_MARKDOWN.replace(
      'r11 proposes `WET-2.1`',
      'r11 proposes `WET-2.1` (amended)',
    );
    expect(computeWet2TextHash(amendedSpec)).not.toBe(PINNED_R11_WET2_TEXT_HASH);
    expect(evaluateWet2ContractReceipt(makeSyntheticValidReceipt(), amendedSpec)).toMatchObject({
      ok: false,
      code: 'wet2_hash_mismatch',
    });
  });

  it('accepts a complete synthetic fixture receipt only when version, hash, clauses, and Track id all match', () => {
    expect(evaluateWet2ContractReceipt(makeSyntheticValidReceipt(), LIVE_SPEC_MARKDOWN)).toEqual({
      ok: true,
      contractVersion: 'WET-2.1',
      wet2TextHash: PINNED_R11_WET2_TEXT_HASH,
      pagesSpecHash: 'a'.repeat(64),
    });
  });

  it('RM-0 (g) live countersignature gate: fails by construction until the pages WET-2.1 countersignature lands', () => {
    const decision = evaluateWet2ContractReceipt(RM0_REPO_BASELINE_RECEIPT, LIVE_SPEC_MARKDOWN);
    expect(
      decision.ok,
      decision.ok
        ? undefined
        : `RM-0 (g) GATE BLOCKED (expected by construction per spec §6 ~:381): ${decision.code} — ${decision.reason} `
          + `(wet2TextHash=${PINNED_R11_WET2_TEXT_HASH}). Blocks RM-E start and RM-C golden-vector freeze/publication until the citing pages revision countersigns WET-2.1.`,
    ).toBe(true);
  });
});
