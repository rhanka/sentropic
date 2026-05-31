<script lang="ts">
  import { get } from 'svelte/store';
  import { _ } from 'svelte-i18n';
  import { page } from '$app/stores';
  import { apiPost, ApiError } from '$lib/utils/api';

  // Pre-fill the code from the query string when the device-code flow links here
  // with ?user_code=PAIR-XXXX.
  let userCode = ($page.url.searchParams.get('user_code') ?? '').toUpperCase();
  let deviceName = '';
  let submitting = false;
  let error = '';
  let success = false;

  async function pairDevice() {
    error = '';
    const code = userCode.trim().toUpperCase();
    if (!code) {
      error = get(_)('auth.devices.pair.errors.codeRequired');
      return;
    }

    submitting = true;
    try {
      await apiPost('/auth/device/approve', {
        user_code: code,
        device_name: deviceName.trim() || undefined,
      });
      success = true;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        error = get(_)('auth.devices.pair.errors.notFound');
      } else {
        error =
          (err instanceof Error && err.message) ||
          get(_)('auth.devices.pair.errors.generic');
      }
    } finally {
      submitting = false;
    }
  }
</script>

<div class="max-w-md mx-auto">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-gray-900">{$_('auth.devices.pair.title')}</h1>
    <p class="mt-2 text-sm text-gray-600">{$_('auth.devices.pair.subtitle')}</p>
  </div>

  {#if error}
    <div class="rounded-md bg-red-50 p-4 mb-6">
      <p class="text-sm text-red-800">{error}</p>
    </div>
  {/if}

  {#if success}
    <div class="rounded-md bg-green-50 p-4 mb-6">
      <p class="text-sm text-green-800">{$_('auth.devices.pair.success')}</p>
    </div>
    <a
      href="/auth/devices"
      class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90"
    >
      {$_('auth.devices.pair.back')}
    </a>
  {:else}
    <form class="bg-white shadow rounded-lg p-6 space-y-4" on:submit|preventDefault={pairDevice}>
      <div>
        <label for="pair-code" class="block text-sm font-medium text-gray-700">
          {$_('auth.devices.pair.codeLabel')}
        </label>
        <input
          id="pair-code"
          type="text"
          bind:value={userCode}
          on:input={() => (userCode = userCode.toUpperCase())}
          placeholder={$_('auth.devices.pair.codePlaceholder')}
          autocomplete="off"
          class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono tracking-widest uppercase focus:ring-primary focus:border-primary"
        />
      </div>

      <div>
        <label for="pair-device-name" class="block text-sm font-medium text-gray-700">
          {$_('auth.devices.pair.deviceNameLabel')}
        </label>
        <input
          id="pair-device-name"
          type="text"
          bind:value={deviceName}
          placeholder={$_('auth.devices.pair.deviceNamePlaceholder')}
          autocomplete="off"
          class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary focus:border-primary"
        />
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? $_('auth.devices.pair.confirming') : $_('auth.devices.pair.confirm')}
        </button>
        <a href="/auth/devices" class="text-sm text-gray-600 hover:text-gray-800">
          {$_('auth.devices.pair.back')}
        </a>
      </div>
    </form>
  {/if}
</div>
