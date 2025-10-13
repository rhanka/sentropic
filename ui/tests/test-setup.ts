import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Désactive le réseau par défaut dans les tests UI.
// Les tests doivent mocker fetch explicitement (helpers ci-dessous).
const networkDisabled = vi.fn(() =>
  Promise.reject(new Error('Network disabled in UI tests (mock fetch before use)'))
);
// @ts-expect-error: assign to global for tests
global.fetch = networkDisabled as unknown as typeof fetch;

// Helpers pour faciliter le mock dans les tests
export function mockFetchJsonOnce(data: unknown, status = 200) {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  );
}

export function resetFetchMock() {
  const fn = global.fetch as unknown as ReturnType<typeof vi.fn>;
  fn.mockReset();
  fn.mockImplementation(networkDisabled);
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
