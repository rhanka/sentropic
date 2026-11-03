import { describe, expect, it } from 'vitest';
import { enabled, fixtureDir, runNode, TSC_CASES, tsc } from './helpers.js';

const CONSUMER = `
import type { AuthHonoPorts } from '@sentropic/auth-hono';
import { createIdentityAuthHonoTransactionBindingV1, runIdentityAuthCompletionV1,
  type IdentityAuthHonoTransactionBindingV1 } from '@sentropic/cluster-mesh/identity/auth-hono';
type IsAny<T> = 0 extends 1 & T ? true : false;
type Exact<A, B> = IsAny<A> extends true ? never : [A, B] extends [B, A] ? true : never;
const exact: Exact<IdentityAuthHonoTransactionBindingV1['ports'], AuthHonoPorts> = true;
const typedFactory: IsAny<typeof createIdentityAuthHonoTransactionBindingV1> extends true ? never : true = true;
const typedRunner: IsAny<typeof runIdentityAuthCompletionV1> extends true ? never : true = true;
export const checks = [exact, typedFactory, typedRunner];
`;

describe.skipIf(!enabled)('packed identity authentication entrypoint', () => {
  it.each(TSC_CASES)('preserves the real auth-hono binding types with the selected peer (%o)', (options) => {
    const run = tsc(fixtureDir('selected'), 'identity-auth', CONSUMER, options);
    expect(run.stdout + run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('exports both factories without loading the optional peer on import', () => {
    const run = runNode(fixtureDir('bare'), `
      import { createIdentityAuthHonoTransactionBindingV1, runIdentityAuthCompletionV1 }
        from '@sentropic/cluster-mesh/identity/auth-hono';
      console.log(typeof createIdentityAuthHonoTransactionBindingV1, typeof runIdentityAuthCompletionV1);
    `);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('function function');
  });
});
