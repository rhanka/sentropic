import type { ToolDefinition, ToolExecutor } from '@sentropic/cowork-bridge/tools';
import type { MouseButton } from '../capability/index.js';
import { INPUT_ACTION_TOOL, type DesktopToolContext } from './types.js';

/**
 * `input_action` (hands) — the actuation step of the agentic computer-use loop.
 * Routes `click` / `type` / `scroll` / `key` to the injected
 * {@link DesktopCapabilityProvider}.
 */

export const inputActionDefinition: ToolDefinition = {
    name: INPUT_ACTION_TOOL,
    description:
        'Perform a desktop input action (the agent\'s hands): click at coordinates, type text, ' +
        'scroll by a delta, or press a key combination.',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['click', 'type', 'scroll', 'key'],
                description: 'Which input action to perform.',
            },
            x: { type: 'integer', description: 'click: absolute screen X.' },
            y: { type: 'integer', description: 'click: absolute screen Y.' },
            button: {
                type: 'string',
                enum: ['left', 'right', 'middle'],
                description: 'click: mouse button (default left).',
            },
            text: { type: 'string', description: 'type: literal text to enter.' },
            dx: { type: 'integer', description: 'scroll: horizontal delta (+ = right).' },
            dy: { type: 'integer', description: 'scroll: vertical delta (+ = down).' },
            combo: {
                type: 'string',
                description: 'key: "+"-separated combo, e.g. "Ctrl+C", "Enter", "Alt+Tab".',
            },
        },
        required: ['action'],
        additionalProperties: false,
    },
};

const asMouseButton = (raw: unknown): MouseButton => {
    if (raw === 'right' || raw === 'middle') return raw;
    return 'left';
};

const asFiniteNumber = (raw: unknown): number | null => {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
};

/**
 * Executor: validates the discriminated `action` and dispatches to the provider.
 * Returns a structured `{ ok, action }` result; throws on malformed args so the
 * runner reports a tool error to the model.
 */
export const inputActionExecutor: ToolExecutor<DesktopToolContext> = async (
    args,
    context,
) => {
    const action = String(args.action ?? '');
    const provider = context.provider;

    switch (action) {
        case 'click': {
            const x = asFiniteNumber(args.x);
            const y = asFiniteNumber(args.y);
            if (x === null || y === null) {
                throw new Error('input_action click requires numeric x and y.');
            }
            await provider.mouseClick(x, y, asMouseButton(args.button));
            return { ok: true, action: 'click', x, y };
        }
        case 'type': {
            const text = args.text;
            if (typeof text !== 'string') {
                throw new Error('input_action type requires a string "text".');
            }
            await provider.type(text);
            return { ok: true, action: 'type', length: text.length };
        }
        case 'scroll': {
            const dx = asFiniteNumber(args.dx) ?? 0;
            const dy = asFiniteNumber(args.dy) ?? 0;
            if (dx === 0 && dy === 0) {
                throw new Error('input_action scroll requires a non-zero dx or dy.');
            }
            await provider.scroll(dx, dy);
            return { ok: true, action: 'scroll', dx, dy };
        }
        case 'key': {
            const combo = args.combo;
            if (typeof combo !== 'string' || !combo.trim()) {
                throw new Error('input_action key requires a non-empty "combo".');
            }
            await provider.key(combo.trim());
            return { ok: true, action: 'key', combo: combo.trim() };
        }
        default:
            throw new Error(
                `input_action: unknown action "${action}" (expected click|type|scroll|key).`,
            );
    }
};
