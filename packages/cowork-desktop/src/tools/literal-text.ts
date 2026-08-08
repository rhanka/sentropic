export const MAX_LITERAL_TEXT_CODE_POINTS = 1_024;

const forbiddenCodePoint = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function hasUnpairedSurrogate(text: string): boolean {
    for (let index = 0; index < text.length; index += 1) {
        const codeUnit = text.charCodeAt(index);
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            const next = text.charCodeAt(index + 1);
            if (next < 0xdc00 || next > 0xdfff) return true;
            index += 1;
        } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            return true;
        }
    }
    return false;
}

/** Accept only bounded printable literal text; never keys, controls, or IME hints. */
export function assertLiteralText(value: unknown): asserts value is string {
    if (typeof value !== 'string') throw new Error('input_action type requires a string "text".');
    const length = Array.from(value).length;
    if (length === 0 || length > MAX_LITERAL_TEXT_CODE_POINTS) {
        throw new Error(`input_action type requires 1-${MAX_LITERAL_TEXT_CODE_POINTS} printable characters.`);
    }
    if (hasUnpairedSurrogate(value) || forbiddenCodePoint.test(value)) {
        throw new Error('input_action denies control, format, line, paragraph, and surrogate characters.');
    }
}
