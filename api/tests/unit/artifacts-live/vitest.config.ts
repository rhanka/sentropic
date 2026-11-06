export default {
  root: '/lane', cacheDir: '/tmp/live-pod-vitest',
  resolve: { alias: [
    { find: /^vitest$/, replacement: '/workspace/node_modules/vitest/dist/index.js' },
    { find: /^@sentropic\/artifacts\/(.+)$/, replacement: '/lane/packages/artifacts/src/$1.ts' },
  ] },
  test: { include: ['api/tests/unit/artifacts-live/**/*.test.ts', 'apps/artifact-content/tests/live*.test.ts'],
    pool: 'forks', fileParallelism: false, maxWorkers: 1 },
};
