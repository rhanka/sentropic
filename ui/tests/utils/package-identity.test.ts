import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(__dirname, '..', '..', '..');

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), 'utf8')) as T;

describe('Sentropic package identity', () => {
  it('uses Sentropic package names for app workspaces and lockfiles', () => {
    const apiPackage = readJson<{ name?: string }>('api/package.json');
    const uiPackage = readJson<{ name?: string }>('ui/package.json');
    const apiLock = readJson<{ name?: string; packages?: Record<string, { name?: string }> }>(
      'api/package-lock.json',
    );
    const uiLock = readJson<{ name?: string; packages?: Record<string, { name?: string }> }>(
      'ui/package-lock.json',
    );
    const rootLock = readJson<{ packages?: Record<string, { name?: string }> }>(
      'package-lock.json',
    );

    expect(apiPackage.name).toBe('sentropic-api');
    expect(uiPackage.name).toBe('sentropic-ui');
    expect(apiLock.name).toBe('sentropic-api');
    expect(apiLock.packages?.['']?.name).toBe('sentropic-api');
    expect(uiLock.name).toBe('sentropic-ui');
    expect(uiLock.packages?.['']?.name).toBe('sentropic-ui');
    expect(rootLock.packages?.api?.name).toBe('sentropic-api');
    expect(rootLock.packages?.ui?.name).toBe('sentropic-ui');
  });
});
