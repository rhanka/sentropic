import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // BR75-EX5 is a separate host-native node:test replay against the read-only h2a worktree.
    exclude: [...configDefaults.exclude, 'tests/a1-integration/**'],
    // BR7-E7A: E7 type-denial proof (r2 P1-A). The listed specs are
    // typechecked on every run: each `@ts-expect-error` must suppress
    // exactly one intended error, and an unused directive fails the run.
    // Scoped to E7-owned files only; no other suite is typechecked.
    typecheck: {
      enabled: true,
      include: ['tests/engram-memory/host-type-denial.spec.ts'],
    },
  },
});
