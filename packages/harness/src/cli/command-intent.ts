export const harnessCliCommandIntentAdapter = Object.freeze({
  runnerId: 'harness',
  source: '@sentropic/harness',
  parseIntent(argv: readonly string[]) {
    return { runnerId: this.runnerId, source: this.source, argv: [...argv] };
  },
});
