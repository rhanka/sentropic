#!/usr/bin/env tsx

// ---------------------------------------------------------------------------
// BR-43 — GCP (Google Cloud Model Garden, formerly Vertex AI) live UAT script
// (make-only, credential-safe).
//
// (Provider id renamed vertex→gcp — user decision 2026-06-02, Vertex AI brand
// retired; the endpoint host stays aiplatform.googleapis.com.)
//
// Drives ONE real `streamGenerateContent` call per GCP catalog model at the
// api/mesh layer, reusing the PRODUCTION code path verbatim:
//   - `buildGeminiRequestBody`  (the shared Gemini body builder — BR43-D4)
//   - `mintGcpAccessToken`      (the ADC bearer minter — D-ADC1)
//   - `GcpProviderRuntime`      (the URL/auth/SSE transport)
//   - `parseGcpModelId`         (the `{publisher}/{model}@gcp` parser — §C)
// Nothing is duplicated; this is the same wire path the runtime uses.
//
// SANITIZATION (critical, spec §F / D-ADC1): this script NEVER prints the
// bearer/access token, the SA-key contents, an `Authorization` header, or the
// full project id (it is masked). It prints ONLY: model id, HTTP/PASS status,
// streamed-token-count, latency, and (on failure) the normalized provider
// error message. A leaked secret in UAT output is a FAIL of this lot.
//
// GATING (spec §F): live calls are gated by the explicit `GCP_LIVE_UAT=1`
// sentinel AND the presence of GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION /
// ADC credentials. Absent any of these, the script prints a CLEAR actionable
// message and exits non-zero WITHOUT attempting a call — so CI (which never
// sets the sentinel) can never trigger a live call.
// ---------------------------------------------------------------------------

import { knownModelIdsByProvider } from '@sentropic/llm-mesh';

import { env } from '../config/env';
import { buildGeminiRequestBody } from '../services/llm-runtime/index';
import {
  GcpProviderRuntime,
  mintGcpAccessToken,
  parseGcpModelId,
  type GcpStreamGenerateRequest,
} from '../services/providers/gcp-provider';

// The GCP catalog selection keys come straight from the published package
// catalog. Swapping the live-callable ids is therefore a 1-line catalog change
// (`packages/llm-mesh/src/providers.ts` / `catalog.ts`) — this script needs no
// edit when the ids change.
const GCP_MODEL_IDS = knownModelIdsByProvider.gcp;

// Mask the project id so the full identifier never reaches the log. Keeps a
// short prefix + suffix for human correlation without leaking the whole value.
const maskProjectId = (project: string): string => {
  const trimmed = project.trim();
  if (trimmed.length <= 6) return '***';
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
};

const printUsageAndExit = (reason: string): never => {
  console.error(`gcp-live-uat: ${reason}`);
  console.error(
    'To run a live GCP UAT call, set ALL of:\n' +
      '  - GOOGLE_CLOUD_PROJECT=<your-gcp-project-id>\n' +
      '  - GOOGLE_CLOUD_LOCATION=<region, e.g. us-central1>\n' +
      '  - GOOGLE_APPLICATION_CREDENTIALS=<path to a Vertex AI User SA-key JSON>\n' +
      '  - GCP_LIVE_UAT=1\n' +
      'and invoke `make gcp-live-uat GOOGLE_CLOUD_PROJECT=... GOOGLE_CLOUD_LOCATION=... GCP_SA_KEY=... ENV=<branch-env>`.',
  );
  process.exit(1);
};

type ModelResult = {
  modelId: string;
  publisher: string;
  wireModel: string;
  pass: boolean;
  httpStatus: number | 'error';
  tokenCount: number;
  finishReason: string | null;
  latencyMs: number;
  errorMessage?: string;
};

// Count the streamed Gemini text-part chunks (the `content_delta` source) and
// capture the terminal finishReason. The chunk shape is the Gemini JSON
// envelope `{ candidates: [{ content: { parts: [{ text }] }, finishReason? }] }`
// — identical on GCP (BR43-D4).
const countStreamedTokens = (
  chunk: unknown,
): { textParts: number; finishReason: string | null } => {
  const record = chunk as
    | { candidates?: Array<Record<string, unknown>> }
    | null
    | undefined;
  const candidate = record?.candidates?.[0] as
    | {
        content?: { parts?: Array<{ text?: unknown }> };
        finishReason?: unknown;
      }
    | undefined;
  const parts = candidate?.content?.parts ?? [];
  const textParts = parts.filter(
    (part) => typeof part?.text === 'string' && part.text.length > 0,
  ).length;
  const finishReason =
    typeof candidate?.finishReason === 'string' ? candidate.finishReason : null;
  return { textParts, finishReason };
};

const runModel = async (modelId: string): Promise<ModelResult> => {
  const project = (env.GOOGLE_CLOUD_PROJECT ?? '').trim();
  const location = (env.GOOGLE_CLOUD_LOCATION ?? '').trim();
  const { publisher, model: wireModel } = parseGcpModelId(modelId);
  const startedAt = Date.now();

  try {
    // Mint the ADC bearer PRE-DISPATCH (the production mesh-dispatch posture,
    // §B/M2) and forward it as the runtime credential. The bearer is held only
    // in memory and is NEVER logged.
    const bearer = await mintGcpAccessToken({ project, location });

    // Reuse the production Gemini body builder verbatim with a trivial prompt.
    const body = buildGeminiRequestBody({
      model: wireModel,
      messages: [{ role: 'user', content: 'ping' }],
      maxOutputTokens: 16,
    });

    const runtime = new GcpProviderRuntime();
    const request: GcpStreamGenerateRequest = {
      mode: 'gcp-stream-generate-content',
      requestOptions: { project, location, publisher, model: wireModel, body },
      credential: bearer,
    };

    const stream = await runtime.streamGenerate(request);

    let tokenCount = 0;
    let finishReason: string | null = null;
    for await (const chunk of stream as AsyncIterable<unknown>) {
      const counted = countStreamedTokens(chunk);
      tokenCount += counted.textParts;
      if (counted.finishReason) finishReason = counted.finishReason;
    }

    const latencyMs = Date.now() - startedAt;
    // PASS criteria: the stream completed (HTTP 200 from the runtime — a non-2xx
    // would have thrown) AND at least one streamed text token was observed.
    const pass = tokenCount > 0;
    return {
      modelId,
      publisher,
      wireModel,
      pass,
      httpStatus: 200,
      tokenCount,
      finishReason,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const runtime = new GcpProviderRuntime();
    const normalized = runtime.normalizeError(error);
    const httpStatus =
      typeof (error as { status?: unknown })?.status === 'number'
        ? ((error as { status: number }).status as number)
        : 'error';
    return {
      modelId,
      publisher,
      wireModel,
      pass: false,
      httpStatus,
      tokenCount: 0,
      finishReason: null,
      latencyMs,
      // normalizeError() yields a sanitized provider message (no token, no
      // headers) — safe to print.
      errorMessage: normalized.message,
    };
  }
};

const main = async (): Promise<void> => {
  if ((env.GCP_LIVE_UAT ?? '').trim() !== '1') {
    printUsageAndExit('GCP_LIVE_UAT is not set to "1" — refusing to call live GCP.');
  }

  const project = (env.GOOGLE_CLOUD_PROJECT ?? '').trim();
  const location = (env.GOOGLE_CLOUD_LOCATION ?? '').trim();
  const credentials = (env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim();

  if (!project) printUsageAndExit('GOOGLE_CLOUD_PROJECT is missing.');
  if (!location) printUsageAndExit('GOOGLE_CLOUD_LOCATION is missing.');
  if (!credentials) {
    printUsageAndExit(
      'GOOGLE_APPLICATION_CREDENTIALS is missing (path to the Vertex AI User SA-key JSON).',
    );
  }

  console.log('--- GCP live UAT (sanitized) ---');
  console.log(`project=${maskProjectId(project)} location=${location}`);
  console.log(`models=${GCP_MODEL_IDS.length}`);

  const results: ModelResult[] = [];
  for (const modelId of GCP_MODEL_IDS) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runModel(modelId);
    results.push(result);
    const line =
      `[${result.pass ? 'PASS' : 'FAIL'}] ${result.modelId} ` +
      `(publisher=${result.publisher} wire=${result.wireModel}) ` +
      `http=${result.httpStatus} tokens=${result.tokenCount} ` +
      `finishReason=${result.finishReason ?? 'n/a'} latencyMs=${result.latencyMs}` +
      (result.errorMessage ? ` error="${result.errorMessage}"` : '');
    console.log(line);
  }

  const allPass = results.every((result) => result.pass);
  console.log('-----------------------------------');
  console.log(
    `Result: ${allPass ? 'ALL PASS' : 'FAIL'} (${results.filter((r) => r.pass).length}/${results.length} models)`,
  );
  if (!allPass) {
    process.exit(1);
  }
};

main().catch((error) => {
  // Defensive: any unexpected throw is sanitized to the message only (never the
  // raw error object, which could embed config/credential context).
  const message = error instanceof Error ? error.message : String(error);
  console.error(`gcp-live-uat: unexpected failure: ${message}`);
  process.exit(1);
});
