export const MAX_COWORK_LITERAL_TEXT_CODE_POINTS = 1_024;
export type CoworkInputAction =
  | { action: 'click'; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { action: 'type'; text: string }
  | { action: 'scroll'; dx: number; dy: number };

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

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));
const isInteger = (value: unknown): value is number => Number.isSafeInteger(value);

/**
 * Exact executable input contract. The returned object is canonical, including
 * the valid omitted-click-button default; an explicitly invalid button is never
 * normalized into a different action.
 */
export function parseCoworkInputAction(value: unknown): CoworkInputAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const action = value as Record<string, unknown>;
  if (action.action === 'type') {
    return hasOnlyKeys(action, ['action', 'text']) && isCoworkLiteralText(action.text)
      ? { action: 'type', text: action.text }
      : null;
  }
  if (action.action === 'click') {
    if (!hasOnlyKeys(action, ['action', 'x', 'y', 'button']) || !isInteger(action.x) || !isInteger(action.y)) return null;
    if ('button' in action && action.button !== 'left' && action.button !== 'right' && action.button !== 'middle') return null;
    return { action: 'click', x: action.x, y: action.y, button: action.button ?? 'left' };
  }
  if (action.action === 'scroll') {
    if (!hasOnlyKeys(action, ['action', 'dx', 'dy']) || !isInteger(action.dx) || !isInteger(action.dy)) return null;
    return action.dx !== 0 || action.dy !== 0 ? { action: 'scroll', dx: action.dx, dy: action.dy } : null;
  }
  return null;
}

/** Strict server-side subset of the only executable MVP input action. */
export function isCoworkInputAction(value: unknown): boolean {
  return parseCoworkInputAction(value) !== null;
}
