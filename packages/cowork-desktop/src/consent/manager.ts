import {
    resolveMatchingPolicy,
    type ToolPermissionDecision,
    type ToolPermissionEntry,
} from '@sentropic/cowork-bridge/permissions';
import {
    DESKTOP_ORIGIN,
    type ConsentPrompt,
    type ConsentStore,
    type ConsentVerdict,
} from './types.js';

/**
 * Per-tool consent manager for desktop eyes/hands.
 *
 * Resolution order for a tool call:
 *  1. A persisted `deny` policy matches  → `deny` (source `deny_always`).
 *  2. A persisted `allow` policy matches → `allow` (source `allow_always`),
 *     except `input_action`, which is deliberately never durable.
 *  3. No persisted policy:
 *     - with a {@link ConsentPrompt}: ask the host once, then apply:
 *         - `allow_once`   → allow this call, persist nothing.
 *         - `allow_always` → allow + persist an `allow` policy.
 *         - `deny_once`    → deny this call, persist nothing.
 *         - `deny_always`  → deny + persist a `deny` policy.
 *     - without a prompt: `needs_consent` (default deny — the runner must not run).
 *
 * The default is always DENY: nothing runs unless an explicit allow exists.
 */
export class ConsentManager {
    private readonly store: ConsentStore;
    private readonly prompt?: ConsentPrompt;

    constructor(deps: { store: ConsentStore; prompt?: ConsentPrompt }) {
        this.store = deps.store;
        this.prompt = deps.prompt;
    }

    /** Resolve the persisted policy for a tool, if any. */
    private async resolvePersisted(
        toolName: string,
    ): Promise<ToolPermissionEntry | null> {
        const entries = await this.store.readEntries();
        // Origin-matching needs a URL for the bridge matcher; the synthetic
        // desktop origin is expressed as a localhost URL so it parses.
        return resolveMatchingPolicy(entries, toolName, `http://${DESKTOP_ORIGIN}`);
    }

    private async persistDecision(
        toolName: string,
        policy: 'allow' | 'deny',
    ): Promise<void> {
        await this.store.upsertEntry({
            toolName,
            origin: DESKTOP_ORIGIN,
            policy,
            updatedAt: new Date().toISOString(),
        });
    }

    /**
     * Decide whether `toolName` may run. Consults persisted policy first; on a
     * miss, asks the {@link ConsentPrompt} (if any) and persists `*_always`
     * decisions. Returns `needs_consent` when there is no policy and no prompt.
     */
    async check(
        toolName: string,
        details?: Record<string, unknown>,
    ): Promise<ConsentVerdict> {
        // Remote hands are always Allow once.  A durable input grant would let
        // a later model turn act without a foreground human decision.
        const persisted = await this.resolvePersisted(toolName);
        if (persisted) {
            if (toolName === 'input_action' && persisted.policy === 'allow') {
                // A prior local version could have written this policy.  Do
                // not honor it: remote hands always require a fresh prompt.
            } else {
                return persisted.policy === 'allow'
                ? { decision: 'allow', source: 'allow_always' }
                : { decision: 'deny', source: 'deny_always' };
            }
        }

        if (!this.prompt) {
            return { decision: 'deny', source: 'default' };
        }

        const decision: ToolPermissionDecision = await this.prompt({
            toolName,
            origin: DESKTOP_ORIGIN,
            details,
        });

        switch (decision) {
            case 'allow_once':
                return { decision: 'allow', source: 'allow_once' };
            case 'allow_always':
                if (toolName === 'input_action') {
                    return { decision: 'deny', source: 'default' };
                }
                await this.persistDecision(toolName, 'allow');
                return { decision: 'allow', source: 'allow_always' };
            case 'deny_always':
                await this.persistDecision(toolName, 'deny');
                return { decision: 'deny', source: 'deny_always' };
            case 'deny_once':
            default:
                return { decision: 'deny', source: 'default' };
        }
    }

    /** Forget all persisted consent (used on disconnect/revoke). */
    async revokeAll(): Promise<void> {
        await this.store.clear();
    }
}
