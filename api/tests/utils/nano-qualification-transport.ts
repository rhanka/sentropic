import type { createNanoBudget, NanoCandidate, NanoReservation } from './nano-qualification-budget';

export const createNanoTransport = (
  budget: ReturnType<typeof createNanoBudget>,
  expectedModel: () => NanoCandidate,
  transport: typeof fetch = globalThis.fetch,
  observe: (body: Record<string, unknown>, ticket: NanoReservation, endpoint: string) => void = () => undefined,
) => {
  let pending: NanoReservation | undefined;
  const guardedFetch: typeof fetch = async (input, init) => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== 'https://api.openai.com' || url.username || url.password || url.search
        || !/^\/v1\/(chat\/completions|responses)$/.test(url.pathname)
        || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') {
        throw new Error('Unqualified endpoint');
      }
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const responses = url.pathname.endsWith('/responses');
      const effort = responses ? (body.reasoning as { effort?: string } | undefined)?.effort : body.reasoning_effort;
      const maxOutput = responses ? body.max_output_tokens : body.max_completion_tokens;
      if (body.model !== expectedModel() || effort !== 'none' || body.service_tier !== 'default' || body.background === true
        || ('tools' in body && (!Array.isArray(body.tools) || body.tools.some((tool) => tool?.type !== 'function')))) {
        throw new Error('Unqualified identity, reasoning, tier or hosted tool');
      }
      pending = budget.reserve(expectedModel(), maxOutput as number);
      observe(body, pending, url.pathname);
      return await transport(input, { ...init, redirect: 'error' });
    } catch {
      budget.close();
      // Deliberately omit provider messages and request headers, which may contain credentials.
      throw new Error('Qualification physical request refused or failed');
    }
  };
  return {
    fetch: guardedFetch,
    takeReservation: (): NanoReservation => {
      if (!pending) throw new Error('Qualification has no physical reservation');
      const ticket = pending;
      pending = undefined;
      return ticket;
    },
  };
};
