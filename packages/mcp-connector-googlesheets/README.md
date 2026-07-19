# @sentropic/mcp-connector-googlesheets

BR-72 benchmark proof: a READ-ONLY Google Sheets connector adapter recoded independently
against the `@sentropic/mcp-platform` `AppConnectorProviderAdapter` contract and unit-tested
against in-repo SYNTHETIC fixtures (no real network call, no secrets, no PII). Capabilities are
taxonomy-grounded in the OOMOL `googlesheets` provider's read-only action set but recoded
independently — no OOMOL code is vendored or wrapped. This is NOT a shipped production
connector, and the production connector's residence is an architect D4 decision, deferred.
