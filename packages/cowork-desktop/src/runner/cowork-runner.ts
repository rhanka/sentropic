import { parsePendingLocalToolCallsFromStatusPayload } from '@sentropic/chat-ui/utils/localToolStreamSync';
import type { ToolCall, ToolResult } from '@sentropic/cowork-bridge/tools';
import type { ConsentManager } from '../consent/index.js';
import { runDesktopToolCall, type DesktopToolContext } from '../tools/index.js';
import { desktopToolDefinitions } from '../tools/registry.js';
import type { PostToolResultsResponse } from './tool-results.js';

/**
 * Core Cowork runner: the glue between the chat SSE stream and the desktop
 * tools. It is transport-agnostic — the host feeds it status payloads (from the
 * injected SSE source) and supplies a tool-results poster; the runner does the
 * consent check, executes via the capability provider, and posts results.
 *
 * The full lifecycle (enroll → register → consume SSE → on tool_call: consent →
 * execute → post) is wired by the host `bin` entry; this class owns the
 * tool_call→tool-results half so it can be unit-tested with a mock provider and
 * a fake poster, no display and no native libs.
 */

const DESKTOP_TOOL_NAMES = new Set(desktopToolDefinitions.map((d) => d.name));

export interface CoworkRunnerDeps {
    consent: ConsentManager;
    context: DesktopToolContext;
    postToolResults: (messageId: string, results: ToolResult[]) => Promise<PostToolResultsResponse>;
}

export class CoworkRunner {
    private readonly consent: ConsentManager;
    private readonly context: DesktopToolContext;
    private readonly postToolResults: CoworkRunnerDeps['postToolResults'];

    constructor(deps: CoworkRunnerDeps) {
        this.consent = deps.consent;
        this.context = deps.context;
        this.postToolResults = deps.postToolResults;
    }

    /** The desktop `localToolDefinitions` to advertise in the chat request. */
    get toolDefinitions() {
        return desktopToolDefinitions;
    }

    /**
     * Handle one SSE `status` payload. When it carries
     * `awaiting_local_tool_results` with desktop `pending_local_tool_calls`,
     * execute each (consent-gated) and post the results, resuming generation.
     * Returns the posted results, or `null` when the payload was not an
     * awaiting-tools status for this device.
     */
    async handleStatusPayload(
        messageId: string,
        streamId: string,
        sequence: number,
        data: unknown,
    ): Promise<ToolResult[] | null> {
        const pending = parsePendingLocalToolCallsFromStatusPayload(
            streamId,
            sequence,
            data,
            (name) => DESKTOP_TOOL_NAMES.has(name),
        );
        if (pending.length === 0) return null;

        const results: ToolResult[] = [];
        for (const entry of pending) {
            const call: ToolCall = {
                toolCallId: entry.toolCallId,
                name: entry.name,
                arguments: this.parseArgs(entry.argsText),
            };
            results.push(
                await runDesktopToolCall(call, { consent: this.consent, context: this.context }),
            );
        }

        await this.postToolResults(messageId, results);
        return results;
    }

    private parseArgs(argsText: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(argsText || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : {};
        } catch {
            return {};
        }
    }
}
