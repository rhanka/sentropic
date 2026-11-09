/** Bounded failure diagnostics for worker pod recipes (install, prebundle, build).
 * The pod captures the last bytes of a failed recipe's stdout+stderr, scrubs token-like material and returns them
 * with the exit code and the terminating signal; the supervisor classifies the cause into a closed token carried
 * in the job reason and logs the scrubbed tail in `artifact_live_phase`. The tail is bounded at every stage
 * (pod capture, wire validation, log line) and scrubbed twice (pod and API), so no secret reaches a log line. */

/** Bytes of recipe output kept: the tail, in arrival order across stdout+stderr. */
export const RECIPE_TAIL_BYTES = 4096;
const RECIPE_SCRUB_TOKEN = '[redacted]';
/** Wire bound of the base64 tail: the pod never sends more than the tail, this only caps a rogue reply. */
const MAX_WIRE_OUTPUT_BYTES = 8 * 1024;

/** Redacts token-like material a recipe tail must never carry into a log line: URLs with userinfo, npm auth
 * assignments and authorization header values. Idempotent: scrubbing twice changes nothing. */
export function scrubRecipeOutput(value: string): string {
  return value
    .replace(/(\/\/)[^/\s@]+@/g, `$1${RECIPE_SCRUB_TOKEN}@`)
    .replace(/(_authToken|_auth)\s*=\s*[^\s]+/gi, `$1=${RECIPE_SCRUB_TOKEN}`)
    .replace(/(Authorization\s*:\s*)[^\r\n]+/gi, `$1${RECIPE_SCRUB_TOKEN}`);
}

/** Keeps the last `maxBytes` bytes without splitting a multibyte sequence; the head is dropped, never the tail. */
export function truncateRecipeTail(value: string, maxBytes: number = RECIPE_TAIL_BYTES): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}

export interface RecipeResult { exitCode: number | null; signal: string | null; output: string }

/** Closed failure class of a recipe result, for the job reason: disk, cache, memory, signal or plain exit code.
 * ENOSPC and ENOTCACHED win over the signal/exit markers because the tail names the root cause; a SIGKILL or an
 * exit 137 without a marker is a container OOM until proven otherwise. */
export function classifyRecipeFailure(result: RecipeResult): string {
  if (/ENOSPC|no space left on device/i.test(result.output)) return 'enospc';
  if (/ENOTCACHED|only-if-cached|no cached response|not in cache/i.test(result.output)) return 'enotcached';
  if (result.exitCode === 137 || result.signal === 'SIGKILL'
    || /heap out of memory|out of memory|allocation failure/i.test(result.output)) return 'oom';
  if (typeof result.signal === 'string' && result.signal.length > 0) return `signal_${result.signal}`;
  if (Number.isSafeInteger(result.exitCode)) return `exit_${result.exitCode}`;
  return 'exit_unknown';
}

/** Fail-closed read of a pod recipe reply: the shape is exact, the tail is canonical base64 within the wire bound
 * and comes back decoded, scrubbed and truncated. Anything else is refused, never guessed. */
export function readRecipeDiagnostics(data: unknown): RecipeResult | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { exitCode, signal, output } = data as Record<string, unknown>;
  if (!(exitCode === null || (typeof exitCode === 'number' && Number.isSafeInteger(exitCode)))) return undefined;
  if (!(signal === null || (typeof signal === 'string' && /^[A-Z0-9]{1,16}$/.test(signal)))) return undefined;
  if (typeof output !== 'string' || output.length > MAX_WIRE_OUTPUT_BYTES) return undefined;
  let decoded: Buffer;
  try { decoded = Buffer.from(output, 'base64'); } catch { return undefined; }
  if (decoded.toString('base64') !== output) return undefined;
  return { exitCode, signal, output: truncateRecipeTail(scrubRecipeOutput(decoded.toString('utf8'))) };
}
