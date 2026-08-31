import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // BR75-EX5 is a separate host-native node:test replay against the read-only h2a worktree.
    exclude: [...configDefaults.exclude, 'tests/a1-integration/**'],
  },
});
