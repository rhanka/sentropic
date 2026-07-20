#!/usr/bin/env node
/**
 * BR-72 DEPTH Lot 2 — runnable Node ESM smoke proving the GENERIC
 * `McpProviderBroker` drives a REAL connector end-to-end.
 *
 * NOT hermetic: makes a REAL network call to https://api.github.com ON
 * PURPOSE, mounting the github LIVE adapter proven in BR-72 DEPTH Lot 1
 * (`../../mcp-connector-github/src/live-adapter.ts`) into a connector-AGNOSTIC
 * `ConnectorRegistry` / `McpProviderBroker` from THIS package. This is the
 * ONLY file in `@sentropic/mcp-broker` that imports anything github-specific
 * — it exists to prove the generic broker actually drives a real connector,
 * not to make the broker connector-aware. Exits 0 on success, non-zero on
 * any failure. NEVER logs a token value.
 */
import { githubLiveAdapter } from '../../mcp-connector-github/src/live-adapter.ts';
import { McpProviderBroker } from '../src/broker.ts';
import { ConnectorRegistry } from '../src/registry.ts';

function fail(message) {
  console.error(`[smoke-broker-github] FAIL: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const registry = new ConnectorRegistry();
  registry.register(githubLiveAdapter);
  const broker = new McpProviderBroker({ registry });

  console.log('[smoke-broker-github] listConnectors():', broker.listConnectors());

  const capabilities = await broker.listCapabilities('github');
  console.log(
    '[smoke-broker-github] listCapabilities("github"):',
    capabilities.map((c) => c.name),
  );

  console.log(
    '[smoke-broker-github] invoke("github", "get_repository", {owner:"octocat", repo:"Hello-World"}) THROUGH THE GENERIC BROKER — REAL api.github.com...',
  );
  const result = await broker.invoke('github', 'get_repository', {
    owner: 'octocat',
    repo: 'Hello-World',
  });

  if (!result.ok || !result.output) {
    fail(`get_repository failed: ${JSON.stringify(result.error)}`);
    return;
  }

  const repo = result.output;
  console.log('[smoke-broker-github] get_repository OK (THROUGH THE GENERIC BROKER):', {
    full_name: repo.full_name,
    stargazers_count: repo.stargazers_count,
    description: repo.description,
  });

  if (repo.full_name !== 'octocat/Hello-World') {
    fail(`unexpected full_name: ${repo.full_name}`);
    return;
  }
  if (typeof repo.stargazers_count !== 'number') {
    fail(`unexpected stargazers_count: ${JSON.stringify(repo.stargazers_count)}`);
    return;
  }

  console.log('[smoke-broker-github] ALL LIVE CALLS SUCCEEDED THROUGH THE GENERIC BROKER.');
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
