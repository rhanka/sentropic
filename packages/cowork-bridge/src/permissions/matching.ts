import type { ToolPermissionEntry, ToolPermissionPolicy } from './types.js';

/**
 * Portable tool-permission normalization + matching, extracted verbatim from the
 * Chrome extension's `tool-permissions.ts`. Pure functions only — no storage,
 * no backend sync, no `chrome.*`.
 */

const TOOL_PATTERN_REGEX = /^[a-z0-9:_*-]{1,96}$/i;
const HOSTNAME_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_REGEX =
    /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Build the canonical `${toolName}::${origin}` map key for a policy entry. */
export const policyKey = (toolName: string, origin: string): string =>
    `${toolName}::${origin}`;

export const normalizeToolNamePattern = (raw: string): string | null => {
    const value = raw.trim().toLowerCase();
    if (!value) return null;
    if (!TOOL_PATTERN_REGEX.test(value)) return null;
    if (value.includes('**')) return null;
    return value;
};

export const isValidHostname = (host: string): boolean => {
    const value = host.trim().toLowerCase();
    if (!value) return false;
    if (value === 'localhost') return true;
    if (IPV4_REGEX.test(value)) return true;
    const labels = value.split('.');
    if (labels.length < 2) return false;
    return labels.every((label) => HOSTNAME_LABEL_REGEX.test(label));
};

export const normalizeRuntimeOrigin = (raw: string): string | null => {
    const value = raw.trim();
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        const hostname = parsed.hostname.toLowerCase();
        const port = parsed.port ? `:${parsed.port}` : '';
        return `${parsed.protocol}//${hostname}${port}`;
    } catch {
        return null;
    }
};

export const normalizeOriginPattern = (raw: string): string | null => {
    const value = raw.trim().toLowerCase();
    if (!value) return null;
    if (value === '*') return '*';

    // all hosts with explicit scheme
    const schemeAnyHostMatch = value.match(/^(https?:)\/\/\*$/);
    if (schemeAnyHostMatch) {
        return `${schemeAnyHostMatch[1]}//*`;
    }

    // host wildcard (all schemes)
    if (value.startsWith('*.')) {
        const suffix = value.slice(2);
        if (!isValidHostname(suffix)) return null;
        return `*.${suffix}`;
    }

    // host wildcard with explicit scheme (http/https only)
    const wildcardSchemeMatch = value.match(/^(https?:)\/\/\*\.(.+)$/);
    if (wildcardSchemeMatch) {
        const scheme = wildcardSchemeMatch[1];
        const suffix = wildcardSchemeMatch[2];
        if (!isValidHostname(suffix)) return null;
        return `${scheme}//*.${suffix}`;
    }

    // exact host pattern (all schemes)
    if (isValidHostname(value)) {
        return value;
    }

    // exact URL origin (with scheme)
    return normalizeRuntimeOrigin(value);
};

const wildcardPatternToRegExp = (pattern: string): RegExp => {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`);
};

export const matchesToolPattern = (pattern: string, toolName: string): boolean => {
    if (pattern === '*') return true;
    if (pattern === toolName) return true;
    // Backward-compat: legacy `tab_action` matches `tab_action:*`.
    if (!pattern.includes('*') && !pattern.includes(':')) {
        return toolName.startsWith(`${pattern}:`);
    }
    if (!pattern.includes('*')) return false;
    return wildcardPatternToRegExp(pattern).test(toolName);
};

export const matchesOriginPattern = (
    pattern: string,
    runtimeOrigin: string,
): boolean => {
    if (pattern === '*') return true;
    const parsed = new URL(runtimeOrigin);
    const hostname = parsed.hostname.toLowerCase();

    const schemeAnyHostMatch = pattern.match(/^(https?:)\/\/\*$/);
    if (schemeAnyHostMatch) {
        return parsed.protocol === schemeAnyHostMatch[1];
    }

    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }

    const wildcardSchemeMatch = pattern.match(/^(https?:)\/\/\*\.(.+)$/);
    if (wildcardSchemeMatch) {
        const requiredScheme = wildcardSchemeMatch[1];
        const suffix = wildcardSchemeMatch[2];
        if (parsed.protocol !== requiredScheme) return false;
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }

    if (pattern.includes('://')) {
        return pattern === runtimeOrigin;
    }

    // exact hostname rule (all schemes)
    return hostname === pattern;
};

export const getToolPatternScore = (pattern: string): number => {
    if (pattern === '*') return 0;
    const literalChars = pattern.replace(/\*/g, '').length;
    if (!pattern.includes('*')) {
        return (pattern.includes(':') ? 3000 : 2500) + literalChars;
    }
    return 1500 + literalChars;
};

export const getOriginPatternScore = (pattern: string): number => {
    if (pattern === '*') return 0;
    if (pattern.includes('://') && !pattern.includes('*')) return 4000 + pattern.length;
    if (pattern.includes('://*.')) return 3000 + pattern.length;
    if (pattern.startsWith('*.')) return 2000 + pattern.length;
    if (pattern.endsWith('://*')) return 1000 + pattern.length;
    return 3500 + pattern.length; // exact hostname
};

/**
 * Resolve the most specific matching policy for `toolName` on `runtimeOrigin`
 * from a set of stored entries. Entries are ranked by origin specificity, then
 * tool specificity, then recency. Returns `null` when nothing matches.
 */
export const resolveMatchingPolicy = (
    entries: Iterable<ToolPermissionEntry>,
    toolName: string,
    runtimeOrigin: string,
): ToolPermissionEntry | null => {
    const matches = Array.from(entries).filter(
        (entry) =>
            matchesToolPattern(entry.toolName, toolName) &&
            matchesOriginPattern(entry.origin, runtimeOrigin),
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
        const scoreA =
            getOriginPatternScore(a.origin) * 10_000 + getToolPatternScore(a.toolName);
        const scoreB =
            getOriginPatternScore(b.origin) * 10_000 + getToolPatternScore(b.toolName);
        if (scoreA !== scoreB) return scoreB - scoreA;
        const updatedA = Date.parse(a.updatedAt);
        const updatedB = Date.parse(b.updatedAt);
        if (Number.isFinite(updatedA) && Number.isFinite(updatedB)) {
            return updatedB - updatedA;
        }
        return 0;
    });
    return matches[0] ?? null;
};

export const normalizePolicy = (value: string): ToolPermissionPolicy | null => {
    if (value === 'allow' || value === 'deny') return value;
    return null;
};

/** Normalize a raw stored/remote entry, or `null` when any field is invalid. */
export const normalizeEntry = (raw: {
    toolName?: string;
    origin?: string;
    policy?: string;
    updatedAt?: string;
}): ToolPermissionEntry | null => {
    const toolName = normalizeToolNamePattern(String(raw.toolName ?? ''));
    const origin = normalizeOriginPattern(String(raw.origin ?? ''));
    const policy = normalizePolicy(String(raw.policy ?? ''));
    const updatedAtRaw = String(raw.updatedAt ?? '').trim();
    const updatedAt =
        updatedAtRaw && Number.isFinite(Date.parse(updatedAtRaw))
            ? new Date(updatedAtRaw).toISOString()
            : new Date().toISOString();
    if (!toolName || !origin || !policy) return null;
    return {
        toolName,
        origin,
        policy,
        updatedAt,
    };
};
