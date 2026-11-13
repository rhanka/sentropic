// Provider-controlled strings must never become arbitrary log text.
export function titleErrorMetadata(error: unknown) {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === 'object'
    ? record.error as Record<string, unknown> : {};
  const allowed = (value: unknown, values: string[]) =>
    typeof value === 'string' && values.includes(value) ? value : 'unknown';
  return {
    provider: 'openai',
    model: 'gpt-5.4-nano',
    status: typeof record.status === 'number' && Number.isInteger(record.status)
      && record.status >= 100 && record.status <= 599 ? record.status : null,
    code: allowed(record.code ?? nested.code, [
      'unsupported_parameter', 'unsupported_value', 'invalid_request_error',
      'model_not_found', 'rate_limit_exceeded', 'insufficient_quota', 'invalid_api_key',
    ]),
    param: allowed(record.param ?? nested.param, [
      'model', 'max_tokens', 'max_completion_tokens', 'max_output_tokens',
      'temperature', 'messages', 'reasoning_effort', 'tools', 'response_format',
    ]),
  };
}
