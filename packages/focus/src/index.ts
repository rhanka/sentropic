/**
 * @sentropic/focus (Focus-M1 L2) — the FocusSnapshot render-core.
 *
 * Public API: the concrete decision-dossier document model, the three deterministic renderers
 * (terminal / MD / HTML — read-only snapshot), and the host render hooks (markdown injection +
 * HTML sanitization). The `/track` subpath (`@sentropic/focus/track`) binds the model to the REAL
 * `@sentropic/track/read` `DecisionDossierView` + `amendmentTrace` (L2 replaced L1's local
 * `DecisionDossierViewFixture` type + mapper).
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
