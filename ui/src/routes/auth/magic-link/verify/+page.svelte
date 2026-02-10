<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
	import { apiPost } from '$lib/utils/api';
	import { setUser } from '$lib/stores/session';
	import { CheckCircle2 } from '@lucide/svelte';

  let loading = true;
  let error = '';
  let success = false;

  onMount(async () => {
    const token = $page.url.searchParams.get('token');

    if (!token) {
      error = get(_)('auth.magicLink.errors.missingToken');
      loading = false;
      return;
    }

    try {
      // Verify magic link token
      const data = await apiPost('/auth/magic-link/verify', { token });

      // Store session info (optional, cookies are set by server)
      if (data.sessionToken) {
        sessionStorage.setItem('sessionToken', data.sessionToken);
        sessionStorage.setItem('refreshToken', data.refreshToken);
      }

      if (data.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          displayName: data.user.displayName ?? null,
          role: data.user.role ?? 'guest',
        });
      }

      success = true;

      // Redirect to dashboard after 1 second
      setTimeout(() => {
        goto('/dashboard');
      }, 1000);
    } catch (err: any) {
      error = err.message || get(_)('auth.magicLink.errors.verifyFailed');
      loading = false;
    }
  });
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="max-w-md w-full space-y-8">
    <div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
        {$_('auth.magicLink.title')}
      </h2>
    </div>

    <div class="mt-8">
      {#if loading && !error}
        <div class="text-center">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p class="mt-4 text-sm text-gray-600">{$_('auth.verifyInProgress')}</p>
        </div>
      {:else if success}
        <div class="rounded-md bg-green-50 p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <CheckCircle2 class="h-5 w-5 text-green-400" />
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-green-800">
                {$_('auth.magicLink.successTitle')}
              </h3>
              <div class="mt-2 text-sm text-green-700">
                <p>{$_('auth.redirectingDashboard')}</p>
              </div>
            </div>
          </div>
        </div>
      {:else if error}
        <div class="rounded-md bg-red-50 p-4">
          <div class="flex">
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-800">
                {$_('auth.magicLink.errorTitle')}
              </h3>
              <div class="mt-2 text-sm text-red-700">
                <p>{error}</p>
              </div>
            </div>
          </div>
          <div class="mt-4">
            <a
              href="/auth/login"
              class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200"
            >
              {$_('auth.magicLink.backToLogin')}
            </a>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
