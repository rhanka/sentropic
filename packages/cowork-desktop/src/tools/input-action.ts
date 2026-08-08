import type { ToolDefinition, ToolExecutor } from '@sentropic/cowork-bridge/tools';
import { INPUT_ACTION_TOOL, type DesktopToolContext } from './types.js';
import { remoteActionDigest } from './action-digest.js';
import { parseCoworkInputAction } from './input-action-schema.js';
import { assertLiteralText } from './literal-text.js';

/**
 * `input_action` (hands) — the actuation step of the agentic computer-use loop.
 * Routes only `click` / `type` / `scroll` to the injected
 * {@link DesktopCapabilityProvider}.
 */

export const inputActionDefinition: ToolDefinition = {
    name: INPUT_ACTION_TOOL,
    description:
        'Perform a desktop input action (the agent\'s hands): click at coordinates, type text, ' +
        'or scroll by a delta. Key chords, Enter, and submission are denied.',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['click', 'type', 'scroll'],
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
        },
        required: ['action'],
        additionalProperties: false,
    },
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
    if (args.action === 'type' && typeof args.text === 'string') assertLiteralText(args.text);
    const action = parseCoworkInputAction(args);
    if (!action) throw new Error('input_action requires an exact click, type, or scroll action shape.');
    const provider = context.provider;
    const nativeGuard = async () => {
        const surfaceGuard = context.surfaceGuard;
        if (!surfaceGuard) throw new Error('input_action requires a measured foreground-surface guard.');
        const surface = context.surfaceToken ?? await surfaceGuard.acquire();
        await surfaceGuard.recheck(surface);
        return surfaceGuard.nativeGuard(surface, context.abortSignal);
    };

    switch (action.action) {
        case 'click': {
            const guard = await nativeGuard();
            if (!guard.assertClickInBounds) throw new Error('input_action requires measured HWND client-area bounds.');
            guard.assertClickInBounds(action.x, action.y);
            await provider.mouseClick(action.x, action.y, action.button, guard);
            return { ok: true, action: action.action, actionDigest: remoteActionDigest(action) };
        }
        case 'type': {
            await provider.type(action.text, await nativeGuard());
            return { ok: true, action: action.action, actionDigest: remoteActionDigest(action) };
        }
        case 'scroll': {
            await provider.scroll(action.dx, action.dy, await nativeGuard());
            return { ok: true, action: action.action, actionDigest: remoteActionDigest(action) };
        }
    }
};
