import { createHash } from 'node:crypto';

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/** Stable local digest that binds a foreground receipt to the exact action. */
export function remotePayloadDigest(payload: Record<string, unknown> | undefined): string {
    return createHash('sha256').update(canonicalJson(payload ?? {})).digest('base64url');
}

export const remoteActionDigest = remotePayloadDigest;
