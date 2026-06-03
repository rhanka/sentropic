import { describe, it, expect } from 'vitest';

import { buildPairingUrl, deriveAppOrigin } from '../src/config/app-origin.js';

const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => over;

describe('deriveAppOrigin', () => {
    it('strips /api/v1 from the default API base', () => {
        expect(deriveAppOrigin(env(), 'https://sentropic.sent-tech.ca/api/v1')).toBe(
            'https://sentropic.sent-tech.ca',
        );
    });

    it('tolerates trailing slashes and a bare /api prefix', () => {
        expect(deriveAppOrigin(env(), 'https://h.example/api/v1/')).toBe('https://h.example');
        expect(deriveAppOrigin(env(), 'https://h.example/api/')).toBe('https://h.example');
    });

    it('keeps a reverse-proxy subpath before the API prefix', () => {
        expect(deriveAppOrigin(env(), 'https://h.example/sub/api/v1')).toBe('https://h.example/sub');
    });

    it('takes an explicit SENTROPIC_APP_ORIGIN verbatim (highest precedence)', () => {
        expect(
            deriveAppOrigin(env({ SENTROPIC_APP_ORIGIN: 'https://app.example' }), 'https://api.example/api/v1'),
        ).toBe('https://app.example');
    });

    it('allows http only on localhost/127.0.0.1', () => {
        expect(deriveAppOrigin(env(), 'http://localhost:5405/api/v1')).toBe('http://localhost:5405');
        expect(() => deriveAppOrigin(env(), 'http://evil.example/api/v1')).toThrow(/https/);
    });

    it('rejects embedded credentials and drops query/hash', () => {
        expect(() => deriveAppOrigin(env({ SENTROPIC_APP_ORIGIN: 'https://user:pw@evil.example' }))).toThrow(
            /credentials/,
        );
        expect(deriveAppOrigin(env(), 'https://h.example/api/v1?x=1#y')).toBe('https://h.example');
    });
});

describe('buildPairingUrl', () => {
    it('builds an absolute pair URL with the code pre-filled', () => {
        expect(buildPairingUrl('PAIR-7G2K', env())).toBe(
            'https://sentropic.sent-tech.ca/auth/devices/pair?user_code=PAIR-7G2K',
        );
    });
});
