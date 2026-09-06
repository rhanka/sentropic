# Business legacy router fixture (`36a93f2b0`)

`api/src/routes/api/solutions.ts` is an exact, executable source snapshot from commit
`36a93f2b0894629b1daabdf3621b28e675ed43d4`. Its Git blob is
`2a2357a24778eadc7724572321e67620b5c8aca3`; the characterization test recomputes
that blob identity before using the router.

The snapshot keeps its historical imports unchanged. Test-only bridge modules under
the matching `api/src/services` and `api/src/middleware` paths expose the current
canonical service and authorization adapters that the legacy router consumed. They
contain no legacy route behavior.

The fixture is imported only by API tests. Production code never imports or mounts it,
so it cannot become a fallback or a second runtime author. The test seeds the same
authoritative PostgreSQL tables for historical and candidate calls, compares
authenticated safe reads byte-for-byte, then characterizes one DELETE per equivalent
seed row and measures each durable effect independently.
