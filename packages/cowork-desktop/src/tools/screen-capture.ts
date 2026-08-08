import type { ToolDefinition, ToolExecutor } from '@sentropic/cowork-bridge/tools';
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
        'primary screen. Display selection and region cropping are unavailable in this MVP.',
    parameters: {
        type: 'object',
        properties: {
            screen: {
                type: 'integer',
                enum: [0],
                description: 'Primary display only (0). Defaults to primary.',
            },
        },
        additionalProperties: false,
    },
};

export const isDefaultScreenCaptureAction = (args: Record<string, unknown>): boolean =>
    Object.keys(args).every((key) => key === 'screen') && (args.screen === undefined || args.screen === 0);

/**
 * Executor: dispatches to `provider.captureScreen` and returns a serializable
 * result. The runner serializes this to the `output` string posted back via
 * `tool-results`.
 */
export const screenCaptureExecutor: ToolExecutor<DesktopToolContext> = async (
    args,
    context,
) => {
    if (!isDefaultScreenCaptureAction(args)) {
        throw new Error('screen_capture supports only the default full primary display; region and non-default screen are denied.');
    }

    const capture = await context.provider.captureScreen({ screen: 0 });
    if (!Number.isInteger(capture.width) || !Number.isInteger(capture.height) || capture.width < 1 || capture.height < 1) {
        throw new Error('screen_capture provider returned invalid image dimensions.');
    }
    return {
        ok: true,
        screen: 0,
        mimeType: capture.mimeType,
        width: capture.width,
        height: capture.height,
        // Inline base64 image for the model (eyes).
        image: `data:${capture.mimeType};base64,${capture.base64}`,
    };
};
