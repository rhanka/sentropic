import { describe, expect, it, vi, afterEach } from 'vitest';
import {
    REFRESH_SKEW_MS,
    decodeJwtExpMs,
    isExpiringSoon,
    normalizeUser,
} from '../src/auth/token.js';

const base64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

const makeJwt = (payload: Record<string, unknown>): string =>
    `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.signature`;

describe('decodeJwtExpMs', () => {
    it('returns exp in milliseconds for a valid token', () => {
        const expSeconds = 1_900_000_000;
        expect(decodeJwtExpMs(makeJwt({ exp: expSeconds }))).toBe(expSeconds * 1000);
    });

    it('returns null for non-three-part tokens', () => {
        expect(decodeJwtExpMs('not.a.jwt.token')).toBeNull();
        expect(decodeJwtExpMs('only-one-part')).toBeNull();
    });

    it('returns null when exp is missing or non-finite', () => {
        expect(decodeJwtExpMs(makeJwt({ sub: 'u1' }))).toBeNull();
        expect(decodeJwtExpMs(makeJwt({ exp: 'soon' }))).toBeNull();
    });

    it('returns null for an undecodable payload', () => {
        expect(decodeJwtExpMs('aaa.@@@notbase64@@@.bbb')).toBeNull();
    });
});

describe('isExpiringSoon (refresh skew)', () => {
    afterEach(() => vi.useRealTimers());

    it('treats missing expiry as expiring', () => {
        expect(isExpiringSoon(null)).toBe(true);
        expect(isExpiringSoon(undefined)).toBe(true);
        expect(isExpiringSoon('')).toBe(true);
    });

    it('treats unparseable expiry as expiring', () => {
        expect(isExpiringSoon('not-a-date')).toBe(true);
    });

    it('is true exactly at the skew boundary, false just beyond it', () => {
        vi.useFakeTimers();
        const now = Date.now();
        expect(isExpiringSoon(now + REFRESH_SKEW_MS)).toBe(true);
        expect(isExpiringSoon(now + REFRESH_SKEW_MS + 1)).toBe(false);
    });

    it('accepts ISO strings and epoch ms equivalently', () => {
        vi.useFakeTimers();
        const future = Date.now() + 10 * 60 * 1000;
        expect(isExpiringSoon(new Date(future).toISOString())).toBe(false);
        expect(isExpiringSoon(future)).toBe(false);
    });
});

describe('normalizeUser', () => {
    it('normalizes a valid user and defaults optional fields to null', () => {
        expect(normalizeUser({ id: 'u1', role: 'editor' })).toEqual({
            id: 'u1',
            role: 'editor',
            email: null,
            displayName: null,
        });
    });

    it('rejects empty id and unknown roles', () => {
        expect(normalizeUser({ id: '', role: 'editor' })).toBeNull();
        expect(normalizeUser({ id: 'u1', role: 'superuser' })).toBeNull();
        expect(normalizeUser(null)).toBeNull();
    });

    it('preserves email and displayName when provided', () => {
        expect(
            normalizeUser({ id: 'u1', role: 'admin_app', email: 'a@b.c', displayName: 'A' }),
        ).toMatchObject({ email: 'a@b.c', displayName: 'A' });
    });
});
