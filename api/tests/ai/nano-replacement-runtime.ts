import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { vi } from 'vitest';
import { env } from '../../src/config/env';
import { providerRegistry } from '../../src/services/provider-registry';
import { createNanoBudget, type NanoCandidate, type NanoReservation } from '../utils/nano-qualification-budget';
import { createNanoTransport } from '../utils/nano-qualification-transport';
import { decodeNanoUsage, type createNanoJournal } from '../utils/nano-qualification-evidence';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
type Journal = ReturnType<typeof createNanoJournal>;
type Context = { model: NanoCandidate; caseId: string; controller: AbortController };

/** Only the injected provider runtime changes: product helpers and mesh dispatch stay real. */
export const createNanoRuntime = (journal: Journal, limits?: { limitUsd?: number; maxCalls?: number }) => {
  const budget = createNanoBudget(journal.append, limits?.limitUsd, limits?.maxCalls);
  let active: Context | undefined;
  const attempts = new Map<number, { model: NanoCandidate; caseId: string; started: number; endpoint: string }>();
  const receipts: Array<Record<string, any>> = [];
  const cap = createNanoTransport(budget, () => {
    if (!active) throw new Error('Qualification case is not active');
    return active.model;
  }, globalThis.fetch, (body, ticket, endpoint) => {
    attempts.set(ticket.ordinal, { model: active!.model, caseId: active!.caseId, started: performance.now(), endpoint });
    journal.append({ type: 'request', model: active!.model, caseId: active!.caseId, ordinal: ticket.ordinal, endpoint,
      renderedRequestSha256: sha256(JSON.stringify(body)), estimatedInputChars: JSON.stringify(body).length,
      reasoning: body.reasoning ?? body.reasoning_effort, maxOutputTokens: ticket.maxOutputTokens,
      previousResponseId: body.previous_response_id ?? null, tier: body.service_tier });
  });
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0, timeout: 45_000, fetch: cap.fetch });
  const requestSignal = (signal?: AbortSignal) => {
    if (!active) throw new Error('Qualification case is not active');
    return signal ? AbortSignal.any([signal, active.controller.signal]) : active.controller.signal;
  };
  const capture = (ticket: NanoReservation, raw: any) => {
    const attempt = attempts.get(ticket.ordinal)!;
    const servedModel = typeof raw?.model === 'string' ? raw.model : '';
    const suffix = servedModel.slice(ticket.model.length + 1);
    if (servedModel !== ticket.model && !(servedModel.startsWith(`${ticket.model}-`) && /^\d{4}-\d{2}-\d{2}$/.test(suffix))) {
      budget.close();
      journal.append({ type: 'identity_failure', ...attempt, servedModel, ordinal: ticket.ordinal });
      throw new Error('Qualification served identity mismatch');
    }
    const decoded = decodeNanoUsage(raw);
    const costUsd = budget.settle(ticket, decoded?.usage ?? null);
    const receipt = { type: 'receipt', model: ticket.model, caseId: attempt.caseId, endpoint: attempt.endpoint,
      ordinal: ticket.ordinal, servedModel, responseId: raw.id, latencyMs: performance.now() - attempt.started,
      usage: decoded!.usage, reasoningReported: decoded!.reasoningReported, rawUsage: raw.usage, costUsd,
      status: raw.status ?? raw.choices?.[0]?.finish_reason ?? null };
    receipts.push(receipt);
    journal.append(receipt);
  };
  const fail = (error: unknown): never => {
    budget.close();
    const status = (error as { status?: unknown })?.status;
    journal.append({ type: 'provider_failure', caseId: active?.caseId, model: active?.model,
      status: typeof status === 'number' ? status : null, budget: budget.snapshot() });
    throw new Error(`Qualification provider request failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}`);
  };
  const provider = providerRegistry.requireProvider('openai');
  const generate = vi.spyOn(provider, 'generate').mockImplementation(async (request: any) => {
    try {
      if (request.mode !== 'chat-completions' || request.codexTransport) throw new Error('Non-API qualification transport');
      const raw = await client.chat.completions.create({ ...request.requestOptions, stream: false, service_tier: 'default' },
        { signal: requestSignal(request.signal) });
      capture(cap.takeReservation(), raw);
      return raw;
    } catch (error) { return fail(error); }
  });
  const stream = vi.spyOn(provider, 'streamGenerate').mockImplementation(async (request: any) => {
    try {
      if (request.mode !== 'responses' || request.codexTransport) throw new Error('Non-API qualification transport');
      const response = await client.responses.create({ ...request.requestOptions, stream: true, service_tier: 'default' },
        { signal: requestSignal(request.signal) });
      const ticket = cap.takeReservation();
      return (async function* () {
        let completed = false;
        try {
          for await (const event of response) {
            if (event.type === 'response.completed' || event.type === 'response.incomplete') {
              capture(ticket, event.response);
              completed = true;
            }
            yield event;
          }
          if (!completed) throw new Error('Missing final provider usage');
        } catch (error) { fail(error); }
      })();
    } catch (error) { return fail(error); }
  });
  return {
    budget, receipts,
    activate: (model: NanoCandidate, caseId: string) => {
      if (budget.snapshot().closed) throw new Error('Qualification budget is closed');
      active = { model, caseId, controller: new AbortController() };
      return active.controller.signal;
    },
    abortActive: () => { active?.controller.abort(); if (budget.snapshot().pending) budget.close(); },
    close: () => { active?.controller.abort(); generate.mockRestore(); stream.mockRestore(); budget.close(); },
  };
};
