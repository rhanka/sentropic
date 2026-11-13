import type { Readable } from 'node:stream';

export type RuntimeDiagnostic = (step: string, detail: string) => void;

/** Runtime output only; never pass request headers, signed tokens or key objects here. */
export function boundedRuntimeOutput(stream: Readable | null | undefined, step: string, report?: RuntimeDiagnostic) {
  if (!stream) return;
  if (!report) { stream.resume(); return; }
  let remaining = 4096;
  stream.on('data', (chunk: Buffer) => {
    if (remaining <= 0) return;
    const bytes = Buffer.from(chunk).subarray(0, remaining); remaining -= bytes.length;
    report(step, bytes.toString('utf8').replace(/[\x00-\x1f\x7f]/g, ' '));
  });
}

export function qualificationDiagnostics(write: (line: string) => void = console.log) {
  let sequence = 0;
  return (step: string, detail: string) => write(`STEP ${++sequence} ${new Date().toISOString()} ${step}: ${detail}`);
}
