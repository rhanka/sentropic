import type { ToolDefinition, ToolExecutor } from '@sentropic/cowork-bridge/tools';
import type { CaptureRegion } from '../capability/index.js';
import { SCREEN_CAPTURE_TOOL, type DesktopToolContext } from './types.js';

/**
 * `screen_capture` (eyes) — the observation step of the agentic computer-use
 * loop. Mirrors the Chrome plugin's `tab_read mode:screenshot`, but captures the
 * OS screen via the injected {@link DesktopCapabilityProvider}.
 */

/** Local-tool definition advertised to the model in the chat request. */
export const screenCaptureDefinition: ToolDefinition = {
    name: SCREEN_CAPTURE_TOOL,
    description:
        'Capture the desktop screen (the agent\'s eyes). Returns a base64 PNG image of the ' +
        'current screen. Optionally target a display index or a rectangular region.',
    parameters: {
        type: 'object',
        properties: {
            screen: {
                type: 'integer',
                minimum: 0,
                description: 'Display index to capture (0 = primary). Defaults to primary.',
            },
            region: {
                type: 'object',
                description: 'Optional sub-region to crop, in screen pixels.',
                properties: {
                    x: { type: 'integer' },
                    y: { type: 'integer' },
                    width: { type: 'integer', minimum: 1 },
                    height: { type: 'integer', minimum: 1 },
                },
                required: ['x', 'y', 'width', 'height'],
            },
        },
        additionalProperties: false,
    },
};

const parseRegion = (raw: unknown): CaptureRegion | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const x = Number(r.x);
    const y = Number(r.y);
    const width = Number(r.width);
    const height = Number(r.height);
    if (![x, y, width, height].every(Number.isFinite)) return undefined;
    return { x, y, width, height };
};

/**
 * Executor: dispatches to `provider.captureScreen` and returns a serializable
 * result. The runner serializes this to the `output` string posted back via
 * `tool-results`.
 */
export const screenCaptureExecutor: ToolExecutor<DesktopToolContext> = async (
    args,
    context,
) => {
    const screenRaw = args.screen;
    const screen =
        typeof screenRaw === 'number' && Number.isInteger(screenRaw) && screenRaw >= 0
            ? screenRaw
            : undefined;
    const region = parseRegion(args.region);

    const capture = await context.provider.captureScreen({ screen, region });
    return {
        ok: true,
        mimeType: capture.mimeType,
        width: capture.width,
        height: capture.height,
        // Inline base64 image for the model (eyes).
        image: `data:${capture.mimeType};base64,${capture.base64}`,
    };
};
