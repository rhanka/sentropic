export const QUALIFICATION_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1'] as const;
export type QualificationFixture = {
  body: Record<string, unknown>; betas: string[]; successfulSafeguardResults: unknown;
  webSearchBody: Record<string, unknown>; webSearchBetas: string[]; payloadSource: string;
};
export const qualificationCases = (fixture: QualificationFixture) => [
  ...QUALIFICATION_MODELS.flatMap(model => [
    { name: 'sse', model, stream: true, native: true, count: false, betas: fixture.betas,
      body: { ...fixture.body, model, stream: true, max_tokens: 16 } },
    { name: 'json', model, stream: false, native: true, count: false, betas: fixture.betas,
      body: { ...fixture.body, model, stream: false, max_tokens: 16 } },
    { name: 'canonical', model, stream: false, native: false, count: false, betas: [],
      body: { ...Object.fromEntries(Object.entries(fixture.body).filter(([key]) => key !== 'safeguards')),
        model, stream: false, max_tokens: 16 } },
    { name: 'count', model, stream: false, native: true, count: true, betas: fixture.betas,
      body: { ...Object.fromEntries(Object.entries(fixture.body).filter(([key]) => ['messages', 'system', 'tools'].includes(key))), model } },
  ]),
  { name: 'websearch', model: QUALIFICATION_MODELS[0], stream: true, native: true, count: false,
    betas: fixture.webSearchBetas, body: { ...fixture.webSearchBody, model: QUALIFICATION_MODELS[0], stream: true, max_tokens: 16 } },
];
