<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { _, locale } from 'svelte-i18n';
  import { apiGet, apiPut, apiDelete } from '$lib/utils/api';

  interface Credential {
    id: string;
    credentialId: string;
    deviceName: string;
    uv: boolean;
    createdAt: string;
    lastUsedAt: string | null;
  }

  let credentials: Credential[] = [];
  let loading = true;
  let error = '';
  let editingId: string | null = null;
  let editingName = '';

  onMount(async () => {
    // Protected by +layout.svelte
    await loadCredentials();
  });

  async function loadCredentials() {
    loading = true;
    error = '';

    try {
      const data = await apiGet('/auth/credentials');
      credentials = data.credentials;
    } catch (err: any) {
      error = err.message || get(_)('auth.devices.errors.load');
    } finally {
      loading = false;
    }
  }

  function startEdit(credential: Credential) {
    editingId = credential.id;
    editingName = credential.deviceName;
  }

  function cancelEdit() {
    editingId = null;
    editingName = '';
  }

  async function saveDeviceName(credentialId: string) {
    try {
      await apiPut(`/auth/credentials/${credentialId}`, { deviceName: editingName });
      await loadCredentials();
      editingId = null;
      editingName = '';
    } catch (err: any) {
      error = err.message || get(_)('auth.devices.errors.update');
    }
  }

  async function revokeCredential(credentialId: string, deviceName: string) {
    const confirmMsg = get(_)('auth.devices.confirmRevoke', { values: { deviceName } });
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      await apiDelete(`/auth/credentials/${credentialId}`);
      await loadCredentials();
    } catch (err: any) {
      error = err.message || get(_)('auth.devices.errors.revoke');
    }
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    const loc = get(locale);
    const tag = loc === 'en' ? 'en-US' : 'fr-FR';
    return new Intl.DateTimeFormat(tag).format(date);
  }
</script>

<div class="max-w-4xl mx-auto">
  <div class="mb-8">
    <h1 class="text-3xl font-bold text-gray-900">{$_('auth.devices.title')}</h1>
    <p class="mt-2 text-sm text-gray-600">
      {$_('auth.devices.subtitle')}
    </p>
  </div>

  {#if error}
    <div class="rounded-md bg-red-50 p-4 mb-6">
      <p class="text-sm text-red-800">{error}</p>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      <p class="mt-4 text-sm text-gray-600">{$_('common.loading')}</p>
    </div>
  {:else if credentials.length === 0}
    <div class="text-center py-12 bg-white rounded-lg shadow">
      <p class="text-gray-600">{$_('auth.devices.empty')}</p>
      <a
        href="/auth/register"
        class="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
      >
        {$_('auth.devices.register')}
      </a>
    </div>
  {:else}
    <div class="bg-white shadow rounded-lg overflow-hidden">
      <ul class="divide-y divide-gray-200">
        {#each credentials as credential (credential.id)}
          <li class="p-6 hover:bg-gray-50 transition">
            <div class="flex items-center justify-between">
              <div class="flex-1">
                {#if editingId === credential.id}
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={editingName}
                      class="px-3 py-1 border border-gray-300 rounded-md text-sm"
                      on:keydown={(e) => {
                        if (e.key === 'Enter') saveDeviceName(credential.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button
                      on:click={() => saveDeviceName(credential.id)}
                      class="px-3 py-1 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
                    >
                      {$_('common.save')}
                    </button>
                    <button
                      on:click={cancelEdit}
                      class="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300"
                    >
                      {$_('common.cancel')}
                    </button>
                  </div>
                {:else}
                  <h3 class="text-lg font-medium text-gray-900">{credential.deviceName}</h3>
                {/if}
                <div class="mt-1 flex items-center gap-4 text-sm text-gray-500">
                  <span>{$_('auth.devices.addedOn', { values: { date: formatDate(credential.createdAt) } })}</span>
                  {#if credential.lastUsedAt}
                    <span>{$_('auth.devices.lastUsed', { values: { date: formatDate(credential.lastUsedAt) } })}</span>
                  {/if}
                  {#if credential.uv}
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      {$_('auth.devices.uvEnabled')}
                    </span>
                  {/if}
                </div>
              </div>

              <div class="flex items-center gap-2">
                {#if editingId !== credential.id}
                  <button
                    on:click={() => startEdit(credential)}
                    class="px-3 py-1 text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    {$_('auth.devices.rename')}
                  </button>
                  <button
                    on:click={() => revokeCredential(credential.id, credential.deviceName)}
                    class="px-3 py-1 text-sm text-red-600 hover:text-red-800"
                  >
                    {$_('auth.devices.revoke')}
                  </button>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </div>

    <div class="mt-6 text-center">
      <a
        href="/auth/register"
        class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200"
      >
        {$_('auth.devices.addNew')}
      </a>
    </div>
  {/if}
</div>
