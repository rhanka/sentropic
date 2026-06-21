/**
 * @sentropic/focus (Focus-M1 L1) — the FocusSnapshot render-core.
 *
 * Public API: the concrete decision-dossier document model, the three deterministic renderers
 * (terminal / MD / HTML — read-only snapshot), the host render hooks (markdown injection +
 * HTML sanitization), and the local `DecisionDossierView`-shaped fixture type + mapper that L2
 * rebinds to the real `@sentropic/track/read`.
 */

export type {
  Affordance,
  AmendmentStep,
  AmendmentTraceNode,
  ComprehensionEvidence,
  DecisionDossierDocument,
  DiagramNode,
  DiagramSyntax,
  FocusNode,
  FocusProvenance,
  FocusRef,
  OptionAnnotationState,
  OptionNode,
  OptionSetNode,
  OutcomeModality,
  OutcomeNode,
  ProseNode,
  QuestionNode,
  QuestionValidationState,
  TargetRef,
} from "./model.js";

export type {
  HtmlRenderHooks,
  MdRenderHooks,
  RenderMarkdown,
  SanitizeHtml,
} from "./render/hooks.js";

export { renderTerminal } from "./render/terminal.js";
export type { TerminalRenderOptions } from "./render/terminal.js";
export { renderMd } from "./render/md.js";
export { renderHtml } from "./render/html.js";

export { toDecisionDossierDocument } from "./fixture.js";
export type {
  DecisionDossierViewFixture,
  FixtureAffordance,
  FixtureDossierBlock,
  FixtureOutcome,
} from "./fixture.js";
