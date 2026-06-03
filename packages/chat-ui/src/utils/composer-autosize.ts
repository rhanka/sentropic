/**
 * composer-autosize.ts — Pure auto-grow helper for ChatComposer.
 *
 * Extracted from AppChatPanel's `updateComposerHeight` / `resolveComposerHeightState`
 * pattern so that the logic is node-testable independently of any Svelte component.
 *
 * P6 radar: promote the app's wired composer behavior (auto-grow textarea sizing)
 * into @sentropic/chat-ui as an opt-in, additive enhancement.
 */

/** Input for a single auto-size measurement. */
export type AutosizeInput = {
  /** Minimum (single-line) height in px. Defaults to 40. */
  baseHeight: number;
  /** Height of the outer scroll container in px. 0 = unconstrained. */
  containerHeight: number;
  /** scrollHeight of the content surface in px. */
  contentHeight: number;
  /** Whether the surface was already multiline before this measurement. */
  wasMultiline: boolean;
};

/** Result of a single auto-size measurement. */
export type AutosizeResult = {
  /** New max-height value to apply to the surface element. */
  maxHeight: number;
  /** Whether the surface is now in multiline state. */
  isMultiline: boolean;
  /** True when a second measurement pass is recommended (e.g. multiline state changed). */
  shouldRemeasure: boolean;
};

/**
 * Compute the new max-height for the composer surface.
 *
 * Rules (mirrors AppChatPanel's `resolveComposerHeightState`):
 * - `maxHeight` = max(baseHeight, 30% of containerHeight) when containerHeight > 0.
 * - When containerHeight is 0 or unknown, maxHeight is uncapped (large sentinel).
 * - `isMultiline` = contentHeight > baseHeight + 2px hysteresis.
 * - `shouldRemeasure` = multiline state changed (layout may shift).
 */
export function computeAutosizeResult({
  baseHeight,
  containerHeight,
  contentHeight,
  wasMultiline,
}: AutosizeInput): AutosizeResult {
  const safeBase =
    Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : 40;
  const safeContainer =
    Number.isFinite(containerHeight) && containerHeight > 0 ? containerHeight : 0;
  const safeContent =
    Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : safeBase;

  const maxHeight =
    safeContainer > 0
      ? Math.max(safeBase, Math.floor(safeContainer * 0.3))
      : // No container constraint — allow content to drive height up to a generous cap.
        Math.max(safeBase, safeContent);

  const isMultiline = safeContent > safeBase + 2;

  return {
    maxHeight,
    isMultiline,
    shouldRemeasure: isMultiline !== wasMultiline,
  };
}
