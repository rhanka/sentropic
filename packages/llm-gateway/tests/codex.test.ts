import { describe, expect, it } from 'vitest';

import {
  CODEX_RESPONSES_URL,
  codexDoneEventFromResponseCompleted,
  codexInstructionsText,
  collectCodexInstructions,
  prepareCodexResponsesRequest,
  stripCodexInputIds,
} from '../src/index.js';

describe('Codex OAuth Responses contract', () => {
  it('targets the ChatGPT-plan Codex backend, not the public OpenAI API', () => {
    expect(CODEX_RESPONSES_URL).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(CODEX_RESPONSES_URL).not.toContain('api.openai.com');
  });

  it('flattens system and developer text blocks into one instructions string', () => {
    expect(
      collectCodexInstructions([
        { role: 'system', content: [{ type: 'text', text: 'System block' }] },
        { role: 'developer', content: 'Developer instruction' },
        { role: 'user', content: 'User prompt ignored for instructions' },
      ]),
    ).toBe('System block\n\nDeveloper instruction');

    expect(codexInstructionsText([{ type: 'image_url', image_url: { url: 'x' } }])).toBe(
      JSON.stringify([{ type: 'image_url', image_url: { url: 'x' } }]),
    );
  });

  it('passes xhigh reasoning through unchanged to the Codex backend', () => {
    const prepared = prepareCodexResponsesRequest({
      model: 'gpt-5.5',
      stream: true,
      input: [{ id: 'item_1', type: 'message', role: 'user', content: 'Hi' }],
      instructions: 'System',
      reasoning: { effort: 'xhigh' },
    });

    expect(prepared.body.reasoning).toEqual({ effort: 'xhigh' });
  });

  it('prepares Responses bodies for Codex OAuth transport', () => {
    const prepared = prepareCodexResponsesRequest({
      model: 'gpt-5.5',
      stream: true,
      input: [{ id: 'item_1', type: 'message', role: 'user', content: 'Hi' }],
      instructions: 'System',
      reasoning: { effort: 'xhigh' },
      max_output_tokens: 123,
    });

    expect(prepared.url).toBe(CODEX_RESPONSES_URL);
    expect(prepared.body).toMatchObject({
      model: 'gpt-5.5',
      stream: true,
      store: false,
      instructions: 'System',
      reasoning: { effort: 'xhigh' },
    });
    expect(prepared.body.max_output_tokens).toBeUndefined();
  });

  it('strips echoed input item ids before sending to the Codex backend', () => {
    expect(
      JSON.parse(
        stripCodexInputIds(
          JSON.stringify({
            input: [
              { id: 'msg_1', type: 'message', role: 'user', content: 'Hi' },
              { type: 'message', role: 'assistant', content: 'Hello' },
            ],
          }),
        ),
      ),
    ).toEqual({
      input: [
        { type: 'message', role: 'user', content: 'Hi' },
        { type: 'message', role: 'assistant', content: 'Hello' },
      ],
    });
  });

  it('preserves response.completed usage for settlement', () => {
    expect(
      codexDoneEventFromResponseCompleted({
        type: 'response.completed',
        response: { usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } },
      }),
    ).toEqual({
      type: 'done',
      data: { usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } },
    });
  });
});
