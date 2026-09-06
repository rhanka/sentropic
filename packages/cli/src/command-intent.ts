export const sentropicCliCommandIntentAdapter = Object.freeze({
    runnerId: 'sentropic-cli',
    source: '@sentropic/cli',
    parseIntent(argv: readonly string[]) {
        return { runnerId: this.runnerId, source: this.source, argv: [...argv] };
    },
});
