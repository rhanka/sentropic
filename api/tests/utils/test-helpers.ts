const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';

export interface TestResponse<T = any> {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<TestResponse<T>> {
  try {
    const mergedHeaders = new Headers(options.headers || {});
    if (!mergedHeaders.has('Content-Type')) {
      mergedHeaders.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: mergedHeaders,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      // Handle 204 No Content responses
      data = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : (data?.message || 'Unknown error'),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export function createTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getTestModel(): string {
  return process.env.TEST_MODEL || 'gpt-4.1-nano';
}
