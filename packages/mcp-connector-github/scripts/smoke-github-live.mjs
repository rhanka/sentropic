#!/usr/bin/env node
/**
 * BR-72 DEPTH Lot 1 — runnable Node ESM smoke against the REAL GitHub API.
 *
 * NOT a hermetic unit test: this script makes REAL network calls to
 * https://api.github.com ON PURPOSE, through the same seam a real broker
 * will own (see ../src/live-broker.ts, ../src/live-adapter.ts,
 * ../src/live-executors.ts). Exits 0 on success, non-zero if any real API
 * call fails. NEVER logs a token value.
 */
import { invokeGithubLive } from '../src/live-broker.ts';

function fail(message) {
  console.error(`[smoke-github-live] FAIL: ${message}`);
  process.exitCode = 1;
}

async function main() {
  console.log('[smoke-github-live] get_repository(octocat/Hello-World) — REAL api.github.com...');
  const repoResult = await invokeGithubLive('get_repository', {
    owner: 'octocat',
    repo: 'Hello-World',
  });
  if (!repoResult.ok || !repoResult.output) {
    fail(`get_repository failed: ${JSON.stringify(repoResult.error)}`);
    return;
  }
  const repo = repoResult.output;
  console.log('[smoke-github-live] get_repository OK:', {
    full_name: repo.full_name,
    stargazers_count: repo.stargazers_count,
    description: repo.description,
  });
  if (repo.full_name !== 'octocat/Hello-World') {
    fail(`unexpected full_name: ${repo.full_name}`);
    return;
  }

  console.log('[smoke-github-live] search_repositories(query="sentropic") — REAL api.github.com...');
  const searchResult = await invokeGithubLive('search_repositories', { query: 'sentropic' });
  if (!searchResult.ok || !searchResult.output) {
    fail(`search_repositories failed: ${JSON.stringify(searchResult.error)}`);
    return;
  }
  const search = searchResult.output;
  const firstItem = Array.isArray(search.items) ? search.items[0] : undefined;
  console.log('[smoke-github-live] search_repositories OK:', {
    total_count: search.total_count,
    first_item_full_name: firstItem ? firstItem.full_name : null,
  });

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    console.log('[smoke-github-live] GITHUB_TOKEN set — get_current_user() — REAL api.github.com...');
    const userResult = await invokeGithubLive('get_current_user', {}, { token });
    if (!userResult.ok || !userResult.output) {
      fail(`get_current_user failed: ${JSON.stringify(userResult.error)}`);
      return;
    }
    console.log('[smoke-github-live] get_current_user OK: login =', userResult.output.login);
  } else {
    console.log('[smoke-github-live] GITHUB_TOKEN not set — skipping get_current_user (requires auth).');
  }

  console.log('[smoke-github-live] ALL LIVE CALLS SUCCEEDED.');
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
