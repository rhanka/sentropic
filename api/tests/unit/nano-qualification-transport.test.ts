import { describe, expect, it, vi } from 'vitest';
import { createNanoBudget } from '../utils/nano-qualification-budget';

const body = { model: 'gpt-6-luna', service_tier: 'default', reasoning_effort: 'none', max_completion_tokens: 32,
  messages: [{ role: 'user', content: 'A synthetic title.' }] };

describe('nano qualification physical transport', () => {
  it('should journal admission before sending and prohibit redirects', async () => {
    const { createNanoTransport } = await import('../utils/nano-qualification-transport');
    const events: unknown[] = [];
    const budget = createNanoBudget((event) => events.push(event));
    const transport = vi.fn(async (_input, init) => {
      expect(events).toHaveLength(1);
      expect(init.redirect).toBe('error');
      return new Response('{}');
    });
    const cap = createNanoTransport(budget, () => 'gpt-6-luna', transport);
    await cap.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify(body) });
    expect(cap.takeReservation().ordinal).toBe(1);
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    ['https://other.invalid/v1/chat/completions', body],
    ['https://api.openai.com/v1/chat/completions', { ...body, model: 'gpt-5.6-luna' }],
    ['https://api.openai.com/v1/chat/completions', { ...body, reasoning_effort: 'medium' }],
    ['https://api.openai.com/v1/chat/completions', { ...body, max_completion_tokens: undefined }],
    ['https://api.openai.com/v1/chat/completions', { ...body, tools: [{ type: 'web_search_preview' }] }],
  ])('should refuse an unqualified endpoint, identity, reasoning, cap or paid tool', async (url, request) => {
    const { createNanoTransport } = await import('../utils/nano-qualification-transport');
    const transport = vi.fn();
    const budget = createNanoBudget(() => undefined);
    const cap = createNanoTransport(budget, () => 'gpt-6-luna', transport);
    await expect(cap.fetch(String(url), { method: 'POST', body: JSON.stringify(request) })).rejects.toThrow(/qualification/i);
    expect(transport).not.toHaveBeenCalled();
    expect(budget.snapshot().calls).toBe(0);
  });
});
