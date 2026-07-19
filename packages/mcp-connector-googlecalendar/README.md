# @sentropic/mcp-connector-googlecalendar

BR-72 benchmark proof: a READ-ONLY Google Calendar connector adapter recoded independently
against the `@sentropic/mcp-platform` `AppConnectorProviderAdapter` contract and unit-tested
against in-repo SYNTHETIC fixtures (no real network call, no secrets, no PII). This validates
8 representative read-only capabilities drawn from the OOMOL googlecalendar taxonomy (~37
actions) — it is NOT a shipped production connector, and the production connector's residence
is an architect D4 decision, deferred.

The root entry (`.` / `src/index.ts`) is READ-ONLY and FROZEN — no write/mutation capability,
no `./experimental` subpath.
