export const QUALIFICATION_SCOPE = 'tests/ai/gw-native-qualification.test.ts';
export const QUALIFICATION_CALL_CAP = 13;
export const qualificationSelected = (scope: string | undefined): boolean => scope?.trim() === QUALIFICATION_SCOPE;

/** Counts at the actual provider boundary, before transport invocation, including failed sends. */
export const createQualificationCap = (origin: string, transport: typeof fetch,
  reserve: (ordinal: number) => void = () => undefined) => {
  const allowed = new URL(origin).origin;
  let calls = 0;
  let closed = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== allowed || url.username || url.password || closed || calls >= QUALIFICATION_CALL_CAP) {
      throw new Error('Qualification transport refused');
    }
    reserve(calls + 1);
    calls++;
    try { return await transport(input, { ...init, redirect: 'error' }); }
    catch { closed = true; throw new Error('Qualification transport failed'); }
  };
  return { fetch, calls: () => calls, close: () => { closed = true; } };
};
