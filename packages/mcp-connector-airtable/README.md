# @sentropic/mcp-connector-airtable

BR-72 Wave-1 benchmark proof: a READ-ONLY Airtable connector adapter recoded independently
against the `@sentropic/mcp-platform` `AppConnectorProviderAdapter` contract and unit-tested
against in-repo SYNTHETIC fixtures (no real network call, no secrets, no PII). Capabilities are
grounded in the OOMOL `open-connector` airtable action taxonomy (`list_bases`,
`get_base_collaborators`, `get_base_schema`, `list_records`, `get_record` — the 5 read-leading
actions out of 14 total) but recoded from scratch, not vendored or wrapped. This validates the
BR-72 matrix §7 airtable read-only rows — it is NOT a shipped production connector, and the
production connector's residence is an architect D4 decision, deferred.

The root entry (`.` / `src/index.ts`) stays READ-ONLY and FROZEN.
