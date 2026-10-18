# Convergence receipt

**Historical evidence.** Verdicts, pending conditions and hashes below describe their recorded revision. The [frozen storage alignment](storage-alignment.md) governs current work: M1 is owner-closed with carried reserves and unprovided handoff evidence; C0/module extensions and selected PG qualification remain separate. No historical proposal authorizes rewriting M1.

**Recorded source convergence: PASS with reservations. Promotion delta: CONFIRMED with reservations (CONF4); P-1–P-5 recorded. Git recording remains pending.** This receipt transcribes author treatment and CONF3/CONF4's actual verdicts; it does not impersonate a reviewer, sign a new acceptance or certify implementation.

## Source convergence and exact bytes

| Stage / document | SHA-256 |
|---|---|
| SO-reviewed SPEC | `3438d425176d8c91604797a03a18a86b2517a90f6785e7648839e74ff8bdb8ca` |
| C6-reviewed SPEC | `c6c3c749b5aacc5e5593ef581c0385f21b44cc315e301372f9235c913100617d` |
| CONF2-reviewed SPEC / CONF3 predecessor | `2e3083fc38ee5d9b3ca225823a794760245b6bc725321a4c802f77938c06463d` |
| CONF3 predecessor log | `f1ebaa90e322eaa961b100e55cc668ee84df2e693bd3b3eadc8455e300d8e969` |
| CONF3 predecessor plan | `2a2c2e65768d82f449b88b4249b26fb0790b7fd2abd88c3a2c27107bfd3271c8` |
| CONF3 predecessor template | `068f92443eecdda0c7e83de162247f2424436b05f8d2eb4f75b9af1609ec1a6a` |
| CONF3 predecessor handoff | `21a9e60814a795484818a29ca57b9433f5ce12c3d370c68bdc7e7265361c131c` |
| CONF3 confirmed SPEC / promotion predecessor | `c6d7a548d25746243b3904a20adea2d1b96360b3042445ba020a8204479ed967` |
| CONF3 confirmed log / promotion incoming log | `7f713c5a861f79c75d067398d81dc0db1c26c38ceba1ce338b271897bfbe12fa` |
| CONF3 confirmed plan | `8e4502463e5ce396d729c684bc5e5ba6ab28720a255147e7559c8cc276b66b47` |
| CONF3 confirmed template | `700d426940c9fbeb739921fcb9cef1b734d4b228030e47aaccebaa18a73ac437` |
| CONF3 confirmed handoff | `14c7f7e43f68ead5e4db01aebcddfa3a0524df6569d7a4e0282597cf9278cca0` |
| CONF3 original review | `6a341ab8ad5f80736c18db63fe16f197fe7697ab8a7504b0e11b20c7dac35aff` |

The C6 author recorded 18 ACCEPTED and 1 PARTIAL; TREAT2 subsequently resolved the metadata limitation under the declaration-plus-limits rule. The CONF2 author treatment recorded 10 ACCEPTED, no PARTIAL/REFUSED, restored all eight m-A subitems and resolved I-1–I-3 using TREAT2. Read [C6 dispositions](review-c6.md) and [CONF2/CONF3 extracts](review-confirmations.md); source digests are separate from extract digests.

On 2026-10-11, CONF3's identified reviewer confirmed the complete 2e3083fc-to-c6d7a548 delta and the aligned plan bytes above: GO with reservations, 0 blocking, 0 major, 7 minor. This satisfies SPEC §1's source review-passed rule. Its recommendations n-3/n-4/n-5 are treated in the [promotion delta](treatment-promotion.md); n-1/n-2 remain model Lot-0 obligations, n-6/n-7 retain later role/phase gates. No disputed refusal is declared closed by this recorder.

AUTHOR-C6 and AUTHOR-2E declare Codex v0.162.1 / gpt-6-astra / max with separate hashed logs. CONF3 declares claude-opus-5-5, max requested but unverifiable, and prior C6/CONF2 authorship; independence and reading limits remain explicit in [metadata](author-metadata.md) and the review extract. Neither conductor nor i-cond supplies author agreement or arbitrates.

## Resulting promotion bytes confirmed by CONF4

| Prepared document | SHA-256 |
|---|---|
| [SPEC](../../../spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md) | `abf5b628063a93c92335ab660aeb68b23e40bc3c0c32233ce68b87be99a9ad9f` |
| [Plan](../plan/PLAN_COMMENTS_ANNOTATIONS.md) | `a4bff48c0206a525eed8b54a7520cadfe7fe885fdf4dbb18ba0c39c51ed9969a` |
| [Model template](../plan/BRANCH_P1_TEMPLATE.md) | `c7a21ddd5d63ed60a89537dcd9694722977be6d84871068b6c61a814d6e558e4` |
| [Handoff](../plan/PLAN_HANDOFF.md) | `bf0c0db5e067822cbc227d01067848e0e36c4460540d30188aefaf2f6f8ab683` |

The [index](index.md) pins the readable extracts and their source aliases. [Owner decisions](owner-decisions.md) reproduce AUTH-M, all three TREAT2 answers and only the two authorized private-register statements. E2/TR2 attribution/backup errata remain effective: “no conservation” is i-cond's phrase; Immo backups/lifecycle are outside this SPEC; conversion counts and Sentropic's own recovery rehearsal remain.

## Promotion-delta review and recording gate

- Status: **CONFIRMED with reservations** by the existing CONF4 report; this files-only reserves pass records that report and applies P-1–P-5. No reviewer or subagent was launched during this recording pass.

The reviewer's English recording block is transcribed verbatim:

```text
CONF4 — bounded promotion-delta confirmation, 2026-10-11.
Reviewer: Claude Opus 5.5, declared claude-opus-5-5; max effort requested, unverifiable by the reviewer; author of C6/CONF2/CONF3, not independent of n-1–n-7. Read-only, no subagents, no make/build/test/Git write.
Reviewed bytes: SPEC abf5b628063a93c92335ab660aeb68b23e40bc3c0c32233ce68b87be99a9ad9f; PLAN a4bff48c0206a525eed8b54a7520cadfe7fe885fdf4dbb18ba0c39c51ed9969a; TEMPLATE c7a21ddd5d63ed60a89537dcd9694722977be6d84871068b6c61a814d6e558e4; HANDOFF bf0c0db5e067822cbc227d01067848e0e36c4460540d30188aefaf2f6f8ab683; BRANCH.md 029bb50dd2ed3f9b38d044984b2e39fe78f7a28519b837bb00c4630687492b1b; LOG 38e0e63ade1d9e1ea5971e5381d62a16b9241e714082e8a4ce2ca207ba788b43; nine evidence extracts at the digests listed in index.md (pre-recording state).
Verdict: CONFIRMED with reservations; 0 BLOCKING, 0 MAJOR, 5 MINOR (P-1–P-5), none requiring SPEC/plan byte changes.
Review digest: SHA-256 of .h2a/reviews/promotion_opus.md, computed by the recorder.
```

Recorded review digest, recomputed from the original report: **`0a4fa303fe6658258735dae1fb2cdcf2e57e23534dceccb411c1a6f225aad491`**. CONF4 read the complete SPEC delta, plan diffs, nine evidence extracts and promotion-log append. It did not run harness/scope-check/build/test/CI/network/registry checks, recheck main ancestry, qualify delivery triggers, inspect private sources beyond the authorized register statements, read unchanged SPEC/plan sections in full, verify the owner exchange beyond TREAT2, or independently attest model/effort.

The three evidence files changed by this recording pass had these identities when CONF4 read them; the other six retain the digests in the [index](index.md):

| Evidence file | CONF4 pre-recording SHA-256 |
|---|---|
| author-metadata.md | `63682d4d6c34b1565ede3d6c61832fd151fbcd12654437abd6085b37918119f4` |
| convergence.md | `6230938688f7e75f8b9c303471bb935466edb7dcdc0853914715a419e384665d` |
| index.md | `ea63b26cfb277477c47e68442b9f4871e25cad553305a477093544fc04845467` |

- P-1 — Closed recording delta permitted without new confirmation: (a) this Promotion-delta review section's status, verbatim block, verdict/counts, review digest, inspected hashes, identity/limits, plus consistent receipt status/heading and P-3 precedence; (b) index digest/alias refresh for CONF4 and author metadata; (c) author-metadata.md additions required by P-2, including this reserves header; (d) index P-3 precedence and P-4 durable exceptions/series summary; (e) BRANCH.md P-5 wording, recording checkboxes, fragment/hash procedure and adjusted counts; (f) an optional short English CONF4 extract in review-confirmations.md before C05, unused here. The local log trace is separately authorized under BRCA-EX2. No other edit is covered.
- P-2 — [Author metadata](author-metadata.md) now records AUTHOR-PROMO's own session and completed-journal digest, plus AUTHOR-RESERVES' fixed header and its digest. These are declarations with limits, not routing attestations.
- P-3 — At the final documentary anchor, this receipt supersedes the pending promotion-delta-confirmation mentions frozen in the SPEC and all three plans, and the historical pending mentions in the promotion-treatment/CONF3 extracts. Those files retain their reviewed bytes. This precedence concerns confirmation only; Git recording and later execution gates remain outstanding.
- P-4 — The [index](index.md) preserves BRCA-EX1/EX2 and C01–C11 independently of the replaceable documentary BRANCH.md, whose link refers to its anchor-commit state.
- P-5 — BRANCH.md distinguishes preparation from subsequent commits, prescribes separate named-file staging and Make commit calls without AI attribution, and defines noninteractive C06/C08 fragments plus committed-byte checks after C07/C09.
- Final recording gate — Before C11, the committer must recompute SHA-256 of the SPEC and all three plans and match the four confirmed hashes above; check refreshed evidence against the index and confirm that the six other extracts are unchanged from CONF4. Any change outside the closed list requires bounded confirmation of that additional delta under SPEC §1; this receipt does not extend the reviewer's inspected bytes to arbitrary later edits.
- Actual promotion commit SHA: **not yet created**. The anchor is the LAST commit of the complete series in [BRANCH.md](../../../BRANCH.md), after review and final hash/link checks. Record its actual SHA in the subsequent model BRANCH.md, never as a guessed or self-referential value in this receipt.
- Pinned main-ancestry baseline from CONF3: `dc95f7e4f88048e9671002827537cde4cb8149b7`; ancestry is not rechecked here. The committer must verify that baseline, not substitute the differing local main reported by CONF3.
- Model Lot 0 verifies the complete chain from that commit alone and keeps the anchor/documentary ancestry unchanged through P4-S. No documentary merge to main precedes M1; later evidence/code merge and actual delivery retain their separate owner gates.

Source convergence and CONF4's bounded promotion-delta confirmation are recorded, subject to the closed recording delta and final hash gate above. AUTH-M needs no new owner vote; durable Git recording must still be complete before implementation relies on this promotion. No runtime, package, CI, host-acknowledgement or operational acceptance is claimed.
