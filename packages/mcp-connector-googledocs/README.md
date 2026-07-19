# @sentropic/mcp-connector-googledocs

BR-72 Wave-1 benchmark proof: a READ-ONLY Google Docs connector adapter recoded independently
against the `@sentropic/mcp-platform` `AppConnectorProviderAdapter` contract and unit-tested
against in-repo SYNTHETIC fixtures (no real network call, no secrets, no PII). This validates
the BR-72 matrix §7 googledocs read-only rows — it is NOT a shipped production connector, and the
production connector's residence is an architect D4 decision, deferred.
