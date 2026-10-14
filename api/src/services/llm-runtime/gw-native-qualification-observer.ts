import { isDeepStrictEqual } from 'node:util';
import { NativeSseFramer } from '@sentropic/llm-gateway';
import { QUALIFICATION_MODELS } from './gw-native-qualification-plan';

export const qualificationFieldTypes = (body: Record<string, unknown>) => Object.entries(body)
  .filter(([name]) => /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name))
  .map(([name, value]) => ({ name, type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value }));
export const safeQualificationModel = (model: unknown): string => QUALIFICATION_MODELS.find(value => value === model) ?? 'other';
export type QualificationResponseEvidence = {
  servedModel: string; responseBytes: number; safeguardResultsPresent: boolean; safeguardResultsEqual: boolean;
  messageStop: boolean; responseFields: ReturnType<typeof qualificationFieldTypes>;
};
/** An unbuffered tee observes only qualification responses; persisted evidence is a closed projection. */
export const observeQualificationResponse = (response: Response, stream: boolean, expectedResults: unknown,
  persist: (evidence: QualificationResponseEvidence) => void): Response => {
  const framer = new NativeSseFramer(); const json: Uint8Array[] = [];
  let size = 0, servedModel = 'other', present = false, equal = true, stopped = false;
  let fields: ReturnType<typeof qualificationFieldTypes> = [];
  const results = (body: Record<string, unknown>) => {
    if (!Object.hasOwn(body, 'safeguard_results')) return;
    present = true; equal &&= isDeepStrictEqual(body.safeguard_results, expectedResults);
  };
  const observe = (body: Record<string, unknown>) => {
    if (body.type === 'message_start') servedModel = safeQualificationModel((body.message as Record<string, unknown>)?.model);
    if (body.type === 'message_delta') results((body.delta as Record<string, unknown>) ?? {});
    if (body.type === 'message_stop') stopped = true;
    if (body.type === 'error') throw new Error('Qualification upstream stream failed');
  };
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > 1_048_576) throw new Error('Qualification response bound reached');
      if (stream) for (const frame of framer.frames(chunk)) {
        if (frame.data) observe(JSON.parse(frame.data));
      }
      else json.push(chunk);
      controller.enqueue(chunk);
    },
    flush() {
      if (stream) framer.finish();
      else {
        const body = JSON.parse(Buffer.concat(json).toString('utf8')) as Record<string, unknown>;
        servedModel = safeQualificationModel(body.model); fields = qualificationFieldTypes(body); results(body);
      }
      persist({ servedModel, responseBytes: size, safeguardResultsPresent: present, safeguardResultsEqual: present && equal,
        messageStop: stopped, responseFields: fields });
    },
  });
  return new Response(response.body?.pipeThrough(transform), { status: response.status, headers: response.headers });
};
