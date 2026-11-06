import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';

/** Only known custody codes and SQLSTATEs may leave an infrastructure error. */
export const cmErrorCode = (error: unknown): string => {
  if (error instanceof IdentityCustodyErrorV1) return error.code;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code)) return code;
  return 'identity_host_failure';
};
