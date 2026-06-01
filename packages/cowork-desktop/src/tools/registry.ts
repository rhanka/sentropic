import type {
    ToolCall,
    ToolDefinition,
    ToolExecutor,
    ToolResult,
} from '@sentropic/cowork-bridge/tools';
import type { ConsentManager } from '../consent/index.js';
import { inputActionDefinition, inputActionExecutor } from './input-action.js';
import { screenCaptureDefinition, screenCaptureExecutor } from './screen-capture.js';
import { type DesktopToolContext } from './types.js';

/** The desktop tool definitions advertised to the model as `localToolDefinitions`. */
export const desktopToolDefinitions: ToolDefinition[] = [
    screenCaptureDefinition,
    inputActionDefinition,
];

const executors: Record<string, ToolExecutor<DesktopToolContext>> = {
    [screenCaptureDefinition.name]: screenCaptureExecutor,
    [inputActionDefinition.name]: inputActionExecutor,
};

/**
 * Run a single {@link ToolCall} through the consent gate, then the matching
 * executor, returning a {@link ToolResult} ready to post via
 * `POST /chat/messages/:id/tool-results`.
 *
 * Resolution:
 *  - unknown tool                → error result.
 *  - consent `deny`              → structured "denied" result (model is told the
 *                                  user refused; the executor never runs).
 *  - consent `needs_consent`     → structured "needs consent" result (no policy,
 *                                  no prompt — the runner must surface a request).
 *  - consent `allow`             → execute; serialize the executor result into
 *                                  `output`, or report the thrown error.
 */
export const runDesktopToolCall = async (
    call: ToolCall,
    deps: { consent: ConsentManager; context: DesktopToolContext },
): Promise<ToolResult> => {
    const { consent, context } = deps;
    const executor = executors[call.name];

    if (!executor) {
        return {
            toolCallId: call.toolCallId,
            name: call.name,
            output: JSON.stringify({ ok: false, error: `Unknown desktop tool "${call.name}".` }),
            error: `Unknown desktop tool "${call.name}".`,
        };
    }

    const verdict = await consent.check(call.name, call.arguments);

    if (verdict.decision === 'deny') {
        const message =
            verdict.source === 'deny_always'
                ? `Tool "${call.name}" is denied by a standing user policy.`
                : `Tool "${call.name}" requires user consent and was not granted (default deny).`;
        return {
            toolCallId: call.toolCallId,
            name: call.name,
            output: JSON.stringify({ ok: false, denied: true, reason: message }),
            error: message,
        };
    }

    if (verdict.decision === 'needs_consent') {
        const message = `Tool "${call.name}" needs explicit user consent before it can run.`;
        return {
            toolCallId: call.toolCallId,
            name: call.name,
            output: JSON.stringify({ ok: false, needsConsent: true, reason: message }),
            error: message,
        };
    }

    try {
        const result = await executor(call.arguments, context);
        return {
            toolCallId: call.toolCallId,
            name: call.name,
            output: JSON.stringify(result),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            toolCallId: call.toolCallId,
            name: call.name,
            output: JSON.stringify({ ok: false, error: message }),
            error: message,
        };
    }
};
