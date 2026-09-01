export const focusCliCommandIntentAdapter = Object.freeze({
  runnerId: 'focus',
  source: '@sentropic/focus/cli',
  parseIntent(argv: readonly string[]) {
    return { runnerId: this.runnerId, source: this.source, argv: [...argv] };
  },
});
