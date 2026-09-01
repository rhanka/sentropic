export const buildCliCommandIntentAdapter = Object.freeze({
    runnerId: 'build-cli',
    source: '@sentropic/build-cli',
    parseIntent(argv: readonly string[]) {
        return { runnerId: this.runnerId, source: this.source, argv: [...argv] };
    },
});
