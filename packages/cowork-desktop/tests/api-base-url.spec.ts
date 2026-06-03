import { describe, it, expect } from 'vitest';

import { DEFAULT_API_BASE_URL, resolveApiBaseUrl } from '../src/config/api-base-url.js';

describe('resolveApiBaseUrl', () => {
    it('defaults to the deployed Sentropic API base', () => {
        expect(DEFAULT_API_BASE_URL).toBe('https://sentropic.sent-tech.ca/api/v1');
        expect(resolveApiBaseUrl({})).toBe(DEFAULT_API_BASE_URL);
    });

    it('lets an explicit env override win (highest precedence)', () => {
        expect(resolveApiBaseUrl({ SENTROPIC_API_BASE_URL: 'https://staging.example/api/v1' })).toBe(
            'https://staging.example/api/v1',
        );
    });

    it('ignores a blank / whitespace-only override and trims a real one', () => {
        expect(resolveApiBaseUrl({ SENTROPIC_API_BASE_URL: '   ' })).toBe(DEFAULT_API_BASE_URL);
        expect(resolveApiBaseUrl({ SENTROPIC_API_BASE_URL: '  https://x.example/api/v1  ' })).toBe(
            'https://x.example/api/v1',
        );
    });
});
