/**
 * Chrome i18n for the renderers (Focus-M1 F2, SPEC_EVOL_FOCUS_DS_PRESENTATION §2 D5).
 *
 * "Chrome" = the labels the RENDERER itself emits (Q:, préco, Options, Outcome, Amendment trace,
 * Affordances, subject/ref/cursor, modality/state/disabled words). These are localized here, FR-first
 * (repo policy). The AUTHORED CONTENT (prose/question/option text) is NOT translated — it renders
 * verbatim; its language is `DecisionDossierDocument.language`, used only for the `<html lang>` attr.
 */
import type { FocusLocale, OutcomeModality } from "../model.js";
import type { QuestionValidationState } from "../model.js";

/** The renderer-emitted label set for one locale. */
export interface FocusChrome {
  readonly subject: string;
  readonly ref: string;
  readonly cursor: string;
  readonly question: string;
  readonly preco: string;
  readonly answer: string;
  readonly options: string;
  /** Join a titled option set, e.g. `Options — Packaging`. */
  readonly optionsWith: (title: string) => string;
  readonly outcome: string;
  readonly amendmentTrace: string;
  readonly none: string;
  readonly affordances: string;
  readonly disabled: string;
  readonly context: string;
  readonly stakes: string;
  readonly recommended: string;
  readonly rationale: string;
  readonly consequence: string;
  readonly impact: string;
  readonly motivation: string;
  readonly modality: Readonly<Record<OutcomeModality, string>>;
  readonly state: Readonly<Record<QuestionValidationState, string>>;
}

const FR: FocusChrome = {
  subject: "sujet",
  ref: "réf",
  cursor: "curseur",
  question: "Q",
  preco: "préco",
  answer: "réponse",
  options: "Options",
  optionsWith: (t) => `Options — ${t}`,
  outcome: "Résultat",
  amendmentTrace: "Traçabilité des amendements",
  none: "(aucun)",
  affordances: "Actions (aperçu en lecture seule)",
  disabled: "désactivé",
  context: "Contexte",
  stakes: "Enjeux",
  recommended: "recommandé",
  rationale: "Justification",
  consequence: "Conséquence si retenue",
  impact: "Impact",
  motivation: "Motivation",
  modality: {
    decision: "décision",
    orientation: "orientation",
    amendment: "amendement",
    comment: "commentaire",
  },
  state: { open: "ouvert", answered: "répondu", validated: "validé" },
};

const EN: FocusChrome = {
  subject: "subject",
  ref: "ref",
  cursor: "cursor",
  question: "Q",
  preco: "rec",
  answer: "answer",
  options: "Options",
  optionsWith: (t) => `Options — ${t}`,
  outcome: "Outcome",
  amendmentTrace: "Amendment trace",
  none: "(none)",
  affordances: "Affordances (read-only snapshot)",
  disabled: "disabled",
  context: "Context",
  stakes: "Stakes",
  recommended: "recommended",
  rationale: "Rationale",
  consequence: "Consequence if chosen",
  impact: "Impact",
  motivation: "Motivation",
  modality: {
    decision: "decision",
    orientation: "orientation",
    amendment: "amendment",
    comment: "comment",
  },
  state: { open: "open", answered: "answered", validated: "validated" },
};

const CATALOGS: Readonly<Record<FocusLocale, FocusChrome>> = { fr: FR, en: EN };

/** The default chrome locale — FR-first (repo policy). */
export const DEFAULT_FOCUS_LOCALE: FocusLocale = "fr";

/** Resolve the chrome label set for a locale (falls back to the FR-first default). */
export const getChrome = (locale: FocusLocale | undefined): FocusChrome =>
  CATALOGS[locale ?? DEFAULT_FOCUS_LOCALE] ?? CATALOGS[DEFAULT_FOCUS_LOCALE];

/**
 * The BCP-47 `<html lang>` value: the AUTHORED content language when known, else derived from the
 * chrome locale, else the FR-first default.
 */
export const resolveHtmlLang = (
  language: string | undefined,
  locale: FocusLocale | undefined,
): string => language ?? locale ?? DEFAULT_FOCUS_LOCALE;
