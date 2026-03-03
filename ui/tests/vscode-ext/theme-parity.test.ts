import { beforeEach, describe, expect, it, vi } from 'vitest';

import { themePreference } from '../../src/lib/stores/themePreference';

describe('theme parity preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove(
      'topai-theme-light',
      'topai-theme-dark',
    );
  });

  it('applies dark mode class when preference is dark', () => {
    themePreference.set('dark');
    expect(document.documentElement.classList.contains('topai-theme-dark')).toBe(
      true,
    );
    expect(document.documentElement.classList.contains('topai-theme-light')).toBe(
      false,
    );
  });

  it('applies light mode class when preference is light', () => {
    themePreference.set('light');
    expect(document.documentElement.classList.contains('topai-theme-light')).toBe(
      true,
    );
    expect(document.documentElement.classList.contains('topai-theme-dark')).toBe(
      false,
    );
  });

  it('resolves system preference from matchMedia during init', () => {
    const addEventListener = vi.fn();
    const media = {
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener,
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(media as MediaQueryList);

    localStorage.setItem('topai_theme_preference', 'system');
    themePreference.init();

    expect(document.documentElement.classList.contains('topai-theme-dark')).toBe(
      true,
    );
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
