// r6 §5.1/§5.2 + §1.1 — T6-D1 contract for the synchronized EN/FR operative copy
// (docs/security/activation/owner-procedure-r6.md). Both languages must agree on the
// four standing A/B defaults, scanner B, same-repository location, both V6 5/8i credit
// withdrawals, exact retired IDs/cutoff and the identical six-step ordering, and the two
// owner answer quotations must survive byte-for-byte. A contradiction refuses setup.
import { ensure } from './seat-admission.ts';

export const OWNER_QUOTE_SCANNER = '« B : image patchée par nous (Recommandé) »';
export const OWNER_QUOTE_LOCATION = '« Non mais on fait les putains de revue cyber dans le meme repo : un job qui regarde les vuln et les patch dans la nuit.. »';
export const RETIRED_MODEL_IDS = ['gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14'] as const;
export const NANO_CUTOFF_ISO = '2027-04-01T00:00:00Z';
export const NANO_CUTOFF_FR = '2027-04-01 à 00 h 00 UTC';
export const STEP_COUNT = 6;

export const STEP_KEYS = ['protections', 'promotion', 'inventory', 'accounts', 'cutover', 'enable'] as const;
const EN_STEP_MARKERS: Record<string, string> = {
  protections: 'Provision same-repository protections',
  promotion: 'Promote reviewed control',
  inventory: 'Inventory names and consumers',
  accounts: 'Qualify existing accounts',
  cutover: 'Cut over without a paid bridge',
  enable: 'Enable only accepted purposes',
};
const FR_STEP_MARKERS: Record<string, string> = {
  protections: 'Préparer et vérifier les protections',
  promotion: 'Promouvoir seulement les contrôles',
  inventory: 'Recenser les noms',
  accounts: 'Qualifier les comptes existants',
  cutover: 'Basculer sans relais payant',
  enable: 'Activer seulement les fonctions acceptées',
};

const EN_MARKERS = {
  scannerB: 'scanner decision is settled **B:',
  sameRepo: 'entirely in sentropic',
  noCustody: 'no separate custody repository/App',
  v6Withdrawn: 'both V6 step 5/8i credit-key setup copies remain withdrawn',
  noPaid: 'never the two protected enrollment/refresh units or a new paid budget',
  noCustodyProvision: 'Do not provision the removed repository or Apps.',
};
const FR_MARKERS = {
  scannerB: 'choix du scanner est **B :',
  sameRepo: 'dans `rhanka/sentropic`',
  noCustody: 'Aucun dépôt de garde séparé, aucune GitHub App séparée',
  v6Withdrawn: "L'étape 5 de V6 §7 et sa copie dans §11/8i ne doivent plus être exécutées",
  noPaid: "Aucun paiement, crédit prépayé, achat, rechargement ou dépassement payant n'est autorisé",
  noCustodyProvision: 'ne créer ni dépôt de garde ni App séparés',
};
const STALE_PHRASES = [
  'Create the custody repository', 'Créer le dépôt de garde',
  'seat-load-ci-credit-key` accepts', 'charger la clé crédit',
  'provision the separate custody repository', 'créer une GitHub App séparée',
];

export type DecisionFixture = {
  abDefaults: string[]; scanner: 'B'; location: 'same-repo';
};
export const DEFAULT_FIXTURE: DecisionFixture = {
  abDefaults: ['A', 'A', 'A', 'A'], scanner: 'B', location: 'same-repo',
};

type Section = { lang: 'en' | 'fr'; text: string; abDefaults: string[]; steps: string[] };

function splitSections(doc: string): { head: string; en: string; fr: string } {
  const i51 = doc.indexOf('### 5.1');
  const i52 = doc.indexOf('### 5.2');
  ensure(i51 >= 0, 'section-missing:5.1');
  ensure(i52 > i51, 'section-missing:5.2');
  return { head: doc.slice(0, i51), en: doc.slice(i51, i52), fr: doc.slice(i52) };
}

function abDefaultsOf(section: string): string[] {
  const defaults: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
    const last = cells[cells.length - 1] ?? '';
    const m = /^\*\*([AB])\*\*/.exec(last);
    if (m) defaults.push(m[1]);
  }
  return defaults;
}

function stepsOf(section: string, markers: Record<string, string>): string[] {
  const keys: string[] = [];
  for (const line of section.split('\n')) {
    const m = /^(\d+)\.\s+/.exec(line);
    if (!m) continue;
    if (Number(m[1]) > STEP_COUNT) continue;
    const key = (Object.keys(markers) as string[]).find(k => line.includes(markers[k]));
    ensure(key !== undefined, 'step-unknown:' + m[1]);
    keys.push(key);
  }
  return keys;
}

function parseSection(lang: 'en' | 'fr', text: string): Section {
  const markers = lang === 'en' ? EN_MARKERS : FR_MARKERS;
  const stepMarkers = lang === 'en' ? EN_STEP_MARKERS : FR_STEP_MARKERS;
  const defaults = abDefaultsOf(text);
  ensure(defaults.length === 4, `ab-row-count:${lang}:${defaults.length}`);
  const steps = stepsOf(text, stepMarkers);
  ensure(steps.length === STEP_COUNT, `step-count:${lang}:${steps.length}`);
  ensure(steps.join(',') === STEP_KEYS.join(','), `step-order:${lang}`);
  return { lang, text, abDefaults: defaults, steps };
}

function assertSectionMarkers(s: Section): void {
  const markers = s.lang === 'en' ? EN_MARKERS : FR_MARKERS;
  for (const [key, phrase] of Object.entries(markers)) {
    ensure(s.text.includes(phrase), `${key}-missing:${s.lang}`);
  }
  for (const id of RETIRED_MODEL_IDS) ensure(s.text.includes(id), `retired-id-missing:${s.lang}:${id}`);
  ensure(s.text.includes(s.lang === 'en' ? NANO_CUTOFF_ISO : NANO_CUTOFF_FR), `cutoff-missing:${s.lang}`);
}

export type ParsedOwnerProcedure = {
  quotes: { scanner: string; location: string };
  en: Section; fr: Section;
};

export function parseOwnerProcedure(doc: string): ParsedOwnerProcedure {
  ensure(doc.includes(OWNER_QUOTE_SCANNER), 'quote-scanner');
  ensure(doc.includes(OWNER_QUOTE_LOCATION), 'quote-location');
  for (const stale of STALE_PHRASES) ensure(!doc.includes(stale), 'stale-instruction:' + stale);
  const { head, en, fr } = splitSections(doc);
  ensure(head.includes(OWNER_QUOTE_SCANNER) && head.includes(OWNER_QUOTE_LOCATION), 'quote-not-in-verbatim-block');
  const enS = parseSection('en', en);
  const frS = parseSection('fr', fr);
  assertSectionMarkers(enS);
  assertSectionMarkers(frS);
  return { quotes: { scanner: OWNER_QUOTE_SCANNER, location: OWNER_QUOTE_LOCATION }, en: enS, fr: frS };
}

// T6-D1: the same decision fixture is applied to both synchronized forms; any divergence
// (missing French, changed default/ordering/model gate, stale custody/App or paid-key
// instruction) fails. Neither language can override the other's gates.
export function compareDecisionFixture(doc: string, fixture: DecisionFixture = DEFAULT_FIXTURE): { en: Section; fr: Section } {
  const parsed = parseOwnerProcedure(doc);
  for (const s of [parsed.en, parsed.fr]) {
    ensure(s.abDefaults.length === fixture.abDefaults.length, `fixture-ab-count:${s.lang}`);
    s.abDefaults.forEach((d, i) => ensure(d === fixture.abDefaults[i], `fixture-ab-mismatch:${s.lang}:row-${i + 1}`));
    ensure(s.text.includes(s.lang === 'en' ? EN_MARKERS.scannerB : FR_MARKERS.scannerB) && fixture.scanner === 'B', `fixture-scanner:${s.lang}`);
    ensure(s.text.includes(s.lang === 'en' ? EN_MARKERS.sameRepo : FR_MARKERS.sameRepo) && fixture.location === 'same-repo', `fixture-location:${s.lang}`);
  }
  return { en: parsed.en, fr: parsed.fr };
}
