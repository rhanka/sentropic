export const MAX_COWORK_LITERAL_TEXT_CODE_POINTS = 1_024;

const forbiddenCodePoint = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

export function isCoworkLiteralText(value: unknown): value is string {
  return typeof value === 'string'
    && Array.from(value).length > 0
    && Array.from(value).length <= MAX_COWORK_LITERAL_TEXT_CODE_POINTS
    && !hasUnpairedSurrogate(value)
    && !forbiddenCodePoint.test(value);
}

/** Strict server-side subset of the only executable MVP input action. */
export function isCoworkInputAction(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (action.action === 'type') return isCoworkLiteralText(action.text);
  if (action.action === 'click') return Number.isFinite(action.x) && Number.isFinite(action.y);
  return action.action === 'scroll'
    && Number.isFinite(action.dx ?? 0)
    && Number.isFinite(action.dy ?? 0)
    && (Number(action.dx ?? 0) !== 0 || Number(action.dy ?? 0) !== 0);
}
