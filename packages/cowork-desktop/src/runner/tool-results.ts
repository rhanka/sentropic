import type { FetchLike } from '@sentropic/cowork-bridge/auth';
import type { ToolResult } from '@sentropic/cowork-bridge/tools';

/**
 * POST executed tool results back to the chat
 * (`POST /chat/messages/:messageId/tool-results`), resuming the paused
 * generation (see SPEC §7 round-trip / BR41a-F2).
 */
export interface ToolResultsPosterDeps {
    fetch: FetchLike;
    apiBaseUrl: string;
    getAccessToken: () => Promise<string | null>;
}

export interface PostToolResultsResponse {
    resumed: boolean;
}

export const createToolResultsPoster = (deps: ToolResultsPosterDeps) => {
    const apiBaseUrl = deps.apiBaseUrl.replace(/\/$/, '');
    return async (messageId: string, results: ToolResult[]): Promise<PostToolResultsResponse> => {
        const token = await deps.getAccessToken();
        if (!token) throw new Error('tool-results: no valid access token available');
        const response = await deps.fetch(
            `${apiBaseUrl}/chat/messages/${encodeURIComponent(messageId)}/tool-results`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    results: results.map((r) => ({
                        tool_call_id: r.toolCallId,
                        name: r.name,
                        output: r.output,
                        ...(r.error ? { error: r.error } : {}),
                    })),
                }),
            },
        );
        if (!response.ok) {
            throw new Error(`tool-results failed with HTTP ${response.status}`);
        }
        const data = (await response.json()) as { resumed?: boolean };
        return { resumed: Boolean(data.resumed) };
    };
};
