import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * a4-cm-gaps-r2 §10.7 series 1 (P4) census: after the consent finder swap,
 * no production reader in `api/src` names the `cm_oauth_consents` table
 * with bound SQL. The single recorded exception is the artifacts-host
 * credential JOIN (design §6.1: it runs on the artifact host's leased
 * client, not on a CM UOW handle — migrating it requires first proving
 * that leased client is (or becomes) a CM host transaction, which is
 * artifact-host work, not an identity-contract gap).
 */

const candidates = [join(process.cwd(), 'api/src'), join(process.cwd(), '..', 'api/src')];
const apiSrc = candidates.find((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory()) ?? candidates[0]!;
const EXCEPTION = join(apiSrc, 'services/artifacts/credentials.ts');

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSources(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('consent reader census (a4-cm-gaps-r2 §10.7 series 1)', () => {
  it('no api/src reader names cm_oauth_consents except the recorded artifacts JOIN', () => {
    expect(statSync(apiSrc, { throwIfNoEntry: false })?.isDirectory()).toBe(true);
    const hits: string[] = [];
    for (const file of listSources(apiSrc)) {
      if (readFileSync(file, 'utf8').includes('cm_oauth_consents')) hits.push(file);
    }
    expect(
      hits.sort(),
      'only services/artifacts/credentials.ts may name cm_oauth_consents (§6.1 exception)',
    ).toEqual([EXCEPTION]);
  });

  it('the consent authority adapter reads through the CM finder, never bound SQL', () => {
    const adapter = readFileSync(join(apiSrc, 'services/auth/consent-store-adapter.ts'), 'utf8');
    expect(adapter).not.toContain('cm_oauth_consents');
    expect(adapter).toContain('oauthTenantStoreV1');
    expect(adapter).toContain('findConsent');
  });

  it('the service-client lookup uses the by-client finder, never a tenant scan', () => {
    const lookup = readFileSync(join(apiSrc, 'services/identity/cm-service-clients.ts'), 'utf8');
    expect(lookup).toContain('findServiceClientBinding');
    expect(lookup).not.toContain('listTenants');
  });
});
