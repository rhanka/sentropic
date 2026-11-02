/** Copy only the verified lifetime; never retain the upstream JWT for transaction retries. */
export const federationAssertionExpiry = (payload: { exp?: unknown }): string => {
  const seconds = payload.exp;
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0 ||
    !Number.isFinite(new Date(seconds * 1000).getTime())) throw new Error('Invalid federation assertion expiry');
  return new Date(seconds * 1000).toISOString();
};
