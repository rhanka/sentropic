import { assertLiteralText } from './literal-text.js';

import type { MouseButton } from '../capability/index.js';

export type CoworkInputAction =
    | { action: 'click'; x: number; y: number; button: MouseButton }
    | { action: 'type'; text: string }
    | { action: 'scroll'; dx: number; dy: number };

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));
const isInteger = (value: unknown): value is number => Number.isSafeInteger(value);

/** Exact device-side mirror of the server's discriminated executable contract. */
export function parseCoworkInputAction(value: unknown): CoworkInputAction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const action = value as Record<string, unknown>;
    if (action.action === 'type') {
        if (!hasOnlyKeys(action, ['action', 'text']) || typeof action.text !== 'string') return null;
        try { assertLiteralText(action.text); return { action: 'type', text: action.text }; } catch { return null; }
    }
    if (action.action === 'click') {
        if (!hasOnlyKeys(action, ['action', 'x', 'y', 'button']) || !isInteger(action.x) || !isInteger(action.y)) return null;
        const button = action.button;
        if ('button' in action && button !== 'left' && button !== 'right' && button !== 'middle') return null;
        return { action: 'click', x: action.x, y: action.y, button: button === 'right' || button === 'middle' ? button : 'left' };
    }
    if (action.action === 'scroll') {
        if (!hasOnlyKeys(action, ['action', 'dx', 'dy']) || !isInteger(action.dx) || !isInteger(action.dy)) return null;
        return action.dx !== 0 || action.dy !== 0 ? { action: 'scroll', dx: action.dx, dy: action.dy } : null;
    }
    return null;
}
