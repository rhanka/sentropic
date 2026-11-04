import { expect } from 'vitest';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';

/**
 * Assert a sync or async operation rejects with the typed custody
 * code. Custody messages are fixed human text that never embeds the code
 * (see connector-custody.spec.ts), so message-substring assertions cannot
 * discriminate codes; assert the typed code instead.
 */
export const expectCustodyCode = async (fn: () => unknown, code: string): Promise<void> => {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityCustodyErrorV1);
    expect((error as IdentityCustodyErrorV1).code).toBe(code);
    return;
  }
  throw new Error(`expected IdentityCustodyErrorV1 with code ${code}`);
};
