// Host PG driver injection (lot E7): the PG provider is required, its
// identity is checked, failed opens release resources and select no
// fallback, and positive installed driver calls run through the injected
// pool. Mirrors the sqlite-driver-injection contract for the PG substrate.

import { describe, it } from 'vitest';

describe('memory PG driver injection', () => {
  it.todo('refuses construction without an explicit host provider');
  it.todo('refuses unqualified provider identities and weak engines');
  it.todo('runs positive installed driver calls through the injected pool');
  it.todo('releases pool resources when the open fails');
  it.todo('never falls back to an implicit driver or the generic kernel');
});
