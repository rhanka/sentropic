import { describe, expect, it } from 'vitest';
import {
    matchesOriginPattern,
    matchesToolPattern,
    normalizeEntry,
    normalizeOriginPattern,
    normalizeRuntimeOrigin,
    normalizeToolNamePattern,
    resolveMatchingPolicy,
    type ToolPermissionEntry,
} from '../src/permissions/index.js';

describe('tool-name pattern normalization', () => {
    it('lowercases and accepts valid patterns, rejects `**` and bad chars', () => {
        expect(normalizeToolNamePattern('Tab_Action:Click')).toBe('tab_action:click');
        expect(normalizeToolNamePattern('*')).toBe('*');
        expect(normalizeToolNamePattern('tab/**')).toBeNull();
        expect(normalizeToolNamePattern('bad name')).toBeNull();
        expect(normalizeToolNamePattern('')).toBeNull();
    });
});

describe('origin normalization', () => {
    it('normalizes runtime origins to scheme//host[:port]', () => {
        expect(normalizeRuntimeOrigin('https://Example.com/path?q=1')).toBe('https://example.com');
        expect(normalizeRuntimeOrigin('http://localhost:5173/x')).toBe('http://localhost:5173');
        expect(normalizeRuntimeOrigin('ftp://example.com')).toBeNull();
    });

    it('normalizes origin patterns including wildcards', () => {
        expect(normalizeOriginPattern('*')).toBe('*');
        expect(normalizeOriginPattern('*.Example.com')).toBe('*.example.com');
        expect(normalizeOriginPattern('https://*.example.com')).toBe('https://*.example.com');
        expect(normalizeOriginPattern('https://*')).toBe('https://*');
        expect(normalizeOriginPattern('localhost')).toBe('localhost');
        expect(normalizeOriginPattern('*.invalid')).toBeNull();
    });
});

describe('matchesToolPattern', () => {
    it('matches wildcard, exact, prefix (legacy), and namespaced patterns', () => {
        expect(matchesToolPattern('*', 'tab_read')).toBe(true);
        expect(matchesToolPattern('tab_read', 'tab_read')).toBe(true);
        // legacy: bare name matches its namespaced children
        expect(matchesToolPattern('tab_action', 'tab_action:click')).toBe(true);
        expect(matchesToolPattern('tab_*', 'tab_read')).toBe(true);
        expect(matchesToolPattern('tab_read', 'tab_action')).toBe(false);
    });
});

describe('matchesOriginPattern', () => {
    it('matches wildcard host, scheme-any-host, and exact host', () => {
        expect(matchesOriginPattern('*', 'https://a.com')).toBe(true);
        expect(matchesOriginPattern('*.example.com', 'https://app.example.com')).toBe(true);
        expect(matchesOriginPattern('*.example.com', 'https://example.com')).toBe(true);
        expect(matchesOriginPattern('https://*', 'https://x.com')).toBe(true);
        expect(matchesOriginPattern('https://*', 'http://x.com')).toBe(false);
        expect(matchesOriginPattern('example.com', 'https://example.com')).toBe(true);
        expect(matchesOriginPattern('example.com', 'https://other.com')).toBe(false);
    });
});

describe('resolveMatchingPolicy specificity', () => {
    const entry = (
        toolName: string,
        origin: string,
        policy: 'allow' | 'deny',
        updatedAt = '2026-01-01T00:00:00.000Z',
    ): ToolPermissionEntry => ({ toolName, origin, policy, updatedAt });

    it('prefers the more specific origin/tool rule over a wildcard', () => {
        const entries = [
            entry('*', '*', 'allow'),
            entry('tab_action:click', 'https://app.example.com', 'deny'),
        ];
        expect(
            resolveMatchingPolicy(entries, 'tab_action:click', 'https://app.example.com')?.policy,
        ).toBe('deny');
    });

    it('returns null when nothing matches', () => {
        const entries = [entry('tab_read', 'https://other.com', 'allow')];
        expect(resolveMatchingPolicy(entries, 'tab_action', 'https://app.example.com')).toBeNull();
    });

    it('breaks ties on more recent updatedAt', () => {
        const entries = [
            entry('tab_read', 'example.com', 'deny', '2026-01-01T00:00:00.000Z'),
            entry('tab_read', 'example.com', 'allow', '2026-02-01T00:00:00.000Z'),
        ];
        expect(resolveMatchingPolicy(entries, 'tab_read', 'https://example.com')?.policy).toBe(
            'allow',
        );
    });
});

describe('normalizeEntry', () => {
    it('rejects entries with invalid tool/origin/policy', () => {
        expect(normalizeEntry({ toolName: 'tab_read', origin: 'example.com', policy: 'allow' }))
            .not.toBeNull();
        expect(normalizeEntry({ toolName: 'tab_read', origin: 'example.com', policy: 'maybe' }))
            .toBeNull();
        expect(normalizeEntry({ toolName: '', origin: 'example.com', policy: 'allow' }))
            .toBeNull();
    });
});
