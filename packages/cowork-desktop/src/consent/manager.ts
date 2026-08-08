import {
    resolveMatchingPolicy,
    type ToolPermissionDecision,
    type ToolPermissionEntry,
} from '@sentropic/cowork-bridge/permissions';
import {
    DESKTOP_ORIGIN,
    type ConsentPrompt,
    type RemoteConsentReceipt,
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
    private readonly remoteReceipts = new Map<string, RemoteConsentReceipt>();

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

    private static isRemoteTool(toolName: string): toolName is RemoteConsentReceipt['toolName'] {
        return toolName === 'screen_capture' || toolName === 'input_action';
    }

    /**
     * Resolve one foreground decision for one remote lease/action.  Remote
     * allows are intentionally never durable: older persisted allows are
     * deleted before they can be honored, while a standing deny remains valid.
     */
    async requestRemoteAllowOnce(input: {
        toolName: RemoteConsentReceipt['toolName'];
        leaseId: string;
        actionDigest: string;
        details?: Record<string, unknown>;
    }): Promise<RemoteConsentReceipt | null> {
        const persisted = await this.resolvePersisted(input.toolName);
        if (persisted?.policy === 'deny') return null;
        if (persisted?.policy === 'allow') {
            await this.store.removeEntry(input.toolName, DESKTOP_ORIGIN);
        }
        if (!this.prompt) return null;

        const decision = await this.prompt({
            toolName: input.toolName,
            origin: DESKTOP_ORIGIN,
            details: input.details,
        });
        if (decision === 'deny_always') {
            await this.persistDecision(input.toolName, 'deny');
            return null;
        }
        if (decision !== 'allow_once' && decision !== 'allow_always') return null;

        const receipt: RemoteConsentReceipt = {
            id: crypto.randomUUID(),
            toolName: input.toolName,
            leaseId: input.leaseId,
            actionDigest: input.actionDigest,
        };
        this.remoteReceipts.set(receipt.id, receipt);
        return receipt;
    }

    /** Consume exactly one receipt immediately before remote execution. */
    consumeRemoteAllowOnce(
        receipt: RemoteConsentReceipt,
        input: Omit<RemoteConsentReceipt, 'id'>,
    ): boolean {
        const saved = this.remoteReceipts.get(receipt.id);
        if (!saved
            || saved.toolName !== input.toolName
            || saved.leaseId !== input.leaseId
            || saved.actionDigest !== input.actionDigest) return false;
        this.remoteReceipts.delete(receipt.id);
        return true;
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
        const persisted = await this.resolvePersisted(toolName);
        if (persisted) {
            if (ConsentManager.isRemoteTool(toolName) && persisted.policy === 'allow') {
                await this.store.removeEntry(toolName, DESKTOP_ORIGIN);
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
                if (ConsentManager.isRemoteTool(toolName)) return { decision: 'allow', source: 'allow_once' };
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
