// T6-D1 (r6 §7.3): §5.1 and localized §5.2 are compared against the same decision
// fixture — four standing A/B/default rows, settled scanner B/same-repo consequences,
// both V6 5/8i withdrawals, exact retired IDs/cutoff and six steps — and the two owner
// answer quotations must survive byte-for-byte in the verbatim block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_FIXTURE, NANO_CUTOFF_ISO, OWNER_QUOTE_LOCATION, OWNER_QUOTE_SCANNER,
  RETIRED_MODEL_IDS, STEP_KEYS, compareDecisionFixture, parseOwnerProcedure,
} from '../src/owner-procedure.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const docPath = resolve(repoRoot, 'docs/security/activation/owner-procedure-r6.md');
const doc = readFileSync(docPath, 'utf8');

test('T6-D1: both owner answer quotations survive byte-for-byte in the verbatim §1.1 block', () => {
  assert.ok(doc.includes(OWNER_QUOTE_SCANNER), 'scanner quote missing');
  assert.ok(doc.includes(OWNER_QUOTE_LOCATION), 'location quote missing');
  const parsed = parseOwnerProcedure(doc);
  assert.equal(parsed.quotes.scanner, OWNER_QUOTE_SCANNER);
  assert.equal(parsed.quotes.location, OWNER_QUOTE_LOCATION);
});

test('T6-D1: §5.1 and §5.2 agree on the same decision fixture (4 A/B rows, scanner B, same-repo, six steps)', () => {
  const { en, fr } = compareDecisionFixture(doc, DEFAULT_FIXTURE);
  assert.deepEqual(en.abDefaults, ['A', 'A', 'A', 'A']);
  assert.deepEqual(fr.abDefaults, ['A', 'A', 'A', 'A']);
  assert.deepEqual(en.steps, [...STEP_KEYS]);
  assert.deepEqual(fr.steps, [...STEP_KEYS]);
});

test('T6-D1: both languages settle scanner B, same-repo nightly, both V6 5/8i withdrawals, retired IDs and 2027-04-01 cutoff', () => {
  const parsed = parseOwnerProcedure(doc);
  for (const s of [parsed.en, parsed.fr]) {
    for (const id of RETIRED_MODEL_IDS) assert.ok(s.text.includes(id), `${id} missing in ${s.lang}`);
    assert.ok(s.text.includes(s.lang === 'en' ? NANO_CUTOFF_ISO : '2027-04-01 à 00 h 00 UTC'), `cutoff missing in ${s.lang}`);
  }
  assert.ok(doc.includes('both V6 step 5/8i credit-key setup copies remain withdrawn'), 'EN V6 5/8i withdrawal missing');
  assert.ok(doc.includes("L'étape 5 de V6 §7 et sa copie dans §11/8i ne doivent plus être exécutées"), 'FR V6 5/8i withdrawal missing');
  assert.ok(doc.includes('scanner decision is settled **B:'), 'EN scanner B missing');
  assert.ok(doc.includes('choix du scanner est **B :'), 'FR scanner B missing');
  assert.ok(doc.includes('entirely in sentropic') && doc.includes('dans `rhanka/sentropic`'), 'same-repo missing');
});

test('T6-D1: missing French section refuses setup', () => {
  const i52 = doc.indexOf('### 5.2');
  assert.throws(() => parseOwnerProcedure(doc.slice(0, i52)), /section-missing:5\.2/);
});

test('T6-D1: a changed A/B default in either language fails the fixture comparison', () => {
  const mutated = doc.replace('**A**, with every scan gate retained.', '**B**, with every scan gate retained.');
  assert.throws(() => compareDecisionFixture(mutated), /fixture-ab-mismatch:en:row-1/);
  const mutatedFr = doc.replace('**A**, après tous les contrôles du scan.', '**B**, après tous les contrôles du scan.');
  assert.throws(() => compareDecisionFixture(mutatedFr), /fixture-ab-mismatch:fr:row-1/);
});

test('T6-D1: changed six-step ordering or a missing step refuses', () => {
  const lines = doc.split('\n');
  const i1 = lines.findIndex(l => /^1\. \*\*Provision same-repository/.test(l));
  const i2 = lines.findIndex(l => /^2\. \*\*Promote reviewed control/.test(l));
  const swapped = [...lines];
  [swapped[i1], swapped[i2]] = [swapped[i2].replace(/^2\./, '1.'), swapped[i1].replace(/^1\./, '2.')];
  assert.throws(() => parseOwnerProcedure(swapped.join('\n')), /step-order:en|step-unknown/);
  assert.throws(() => parseOwnerProcedure(doc.replace(/^6\. \*\*Enable only accepted purposes[\s\S]*?(?=^### |\s*$)/m, '')), /step-count:en/);
});

test('T6-D1: an altered owner quotation byte fails', () => {
  const mutated = doc.replace(OWNER_QUOTE_SCANNER, OWNER_QUOTE_SCANNER.replace('Recommandé', 'Recommande'));
  assert.throws(() => parseOwnerProcedure(mutated), /quote-scanner/);
});

test('T6-D1: stale custody-repository/App or paid credit-key instruction refuses setup', () => {
  assert.throws(() => parseOwnerProcedure(doc + '\nCreate the custody repository now.\n'), /stale-instruction/);
  assert.throws(() => parseOwnerProcedure(doc + '\nCréer le dépôt de garde séparé.\n'), /stale-instruction/);
  assert.throws(() => parseOwnerProcedure(doc + '\nseat-load-ci-credit-key` accepts the file.\n'), /stale-instruction/);
  // The operative copy itself must carry the refusal statements, not the stale orders.
  assert.ok(doc.includes('Do not provision the removed repository or Apps.'));
  assert.ok(doc.includes('ne créer ni dépôt de garde ni App séparés'));
  assert.ok(doc.includes("Aucun paiement, crédit prépayé, achat, rechargement ou dépassement payant n'est autorisé"));
});
