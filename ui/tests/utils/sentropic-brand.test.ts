import { describe, expect, it } from 'vitest';
import en from '../../src/locales/en.json';
import fr from '../../src/locales/fr.json';

describe('Sentropic brand copy', () => {
  it('uses Sentropic in primary English locale surfaces', () => {
    expect(en.home.welcomeTitle).toBe('Welcome to Sentropic');
    expect(en.dashboard.reportTitle).toBe('Sentropic report');
    expect(en.dashboard.backCover.p1).toContain('Sentropic');
    expect(en.dashboard.backCover.p2).toContain('Sentropic');
    expect(en.dashboard.backCover.p3).toContain('Sentropic');
  });

  it('uses Sentropic in primary French locale surfaces', () => {
    expect(fr.home.welcomeTitle).toBe('Bienvenue sur Sentropic');
    expect(fr.dashboard.reportTitle).toBe('Rapport Sentropic');
    expect(fr.dashboard.backCover.p1).toContain('Sentropic');
    expect(fr.dashboard.backCover.p2).toContain('Sentropic');
    expect(fr.dashboard.backCover.p3).toContain('Sentropic');
  });
});
