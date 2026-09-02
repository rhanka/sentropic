# Analytics legacy router fixture (`f0a7e47eb`)

`api/src/routes/api/analytics.ts` is the exact executable source from commit
`f0a7e47eb98274f4cc53c1a80732b83cc37d1353`, Git blob
`10f7d7762a550343a51be08a37d812bc5b1c91ae`.

The historical imports are unchanged. Test-only bridge modules expose the
current canonical database, queue, settings, hydration, RBAC and locale
authorities consumed by that source. Production never imports or mounts this
fixture, so it cannot become a fallback or a second runtime author.
