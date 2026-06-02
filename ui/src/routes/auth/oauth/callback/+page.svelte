<script lang="ts">
  import { onMount } from 'svelte';
  import { createOAuthClient, type OAuthTokenResponse } from '@sentropic/auth-ui';

  import { API_BASE_URL } from '$lib/config';

  const isDev = import.meta.env.DEV;
  const fallbackVerifier = 'test-code-verifier-with-enough-entropy-1234567890';

  let error: string | null = null;
  let state: string | null = null;
  let tokens: OAuthTokenResponse | null = null;

  onMount(async () => {
    if (!isDev) return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    state = params.get('state');
    if (!code) {
      error = params.get('error') ?? 'missing_code';
      return;
    }

    try {
      const issuer = API_BASE_URL.replace(/\/api\/v1\/?$/u, '');
      const client = createOAuthClient({
        clientId: 'example-mock-rp',
        fetch: (input, init = {}) => {
          const headers = new Headers(init.headers);
          if (init.method === 'POST') {
            headers.set('Authorization', `Basic ${btoa('example-mock-rp:example-mock-rp-secret-dev-only')}`);
          }
          return fetch(input, { ...init, headers });
        },
        issuer,
        redirectUri: `${window.location.origin}/auth/oauth/callback`,
        scopes: ['openid', 'profile', 'email'],
      });
      tokens = await client.exchangeCode(
        code,
        sessionStorage.getItem('oauth_code_verifier') ?? fallbackVerifier,
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'oauth_callback_failed';
    }
  });
</script>

{#if isDev}
  <div class="mx-auto max-w-4xl px-4 py-8">
    {#if error}
      <p class="text-sm text-red-700" data-testid="oauth-callback-error">{error}</p>
    {:else if tokens}
      <div class="space-y-4">
        <p class="text-sm text-gray-600" data-testid="oauth-callback-state">{state}</p>
        <pre class="overflow-auto rounded border bg-white p-4 text-xs" data-testid="oauth-callback-tokens">{JSON.stringify(tokens, null, 2)}</pre>
      </div>
    {/if}
  </div>
{/if}
