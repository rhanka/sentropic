const reasons = new Set([
  'Qualification prerequisite or case failed',
  'Qualification prerequisite failed: operator UAT mode is not armed',
  'Qualification UAT guard refused',
  'Qualification construction evidence missing',
  'Qualification construction evidence mismatch',
  'Qualification safeguards construction evidence missing',
  'Qualification server-tool construction evidence missing',
]);
const codes = new Set(['ENOENT', 'EACCES', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']);
class SafeQualificationError extends Error {}

/** Never attach the raw cause: Vitest prints nested errors, including credentials and bodies. */
export const qualificationFailure = (stage: string, cause: unknown): Error => {
  let reason = 'unrecognized failure (details withheld)';
  if (cause instanceof SafeQualificationError || cause instanceof Error && reasons.has(cause.message)) {
    reason = cause.message;
  } else if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code && codes.has(code)) reason = code;
    else if (cause instanceof SyntaxError) reason = 'invalid JSON or URL syntax';
    else if (cause instanceof TypeError) reason = 'invalid input or network request failure';
  }
  return new SafeQualificationError(`${stage}: ${reason}`);
};
