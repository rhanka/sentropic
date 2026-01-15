<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Lock } from '@lucide/svelte';
  import type { LockSnapshot } from '$lib/utils/object-lock';

  export let lock: LockSnapshot | null = null;
  export let lockLoading: boolean = false;
  export let lockError: string | null = null;
  export let lockOwnerLabel: string = 'Utilisateur';
  export let lockRequestedByMe: boolean = false;
  export let isAdmin: boolean = false;
  export let isLockedByMe: boolean = false;
  export let isLockedByOther: boolean = false;

  const dispatch = createEventDispatcher<{
    requestUnlock: void;
    forceUnlock: void;
  }>();

  let tooltipOpen = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const getInitials = (value: string | null | undefined) => {
    if (!value) return '?';
    const cleaned = value.replace(/[@._-]+/g, ' ').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
    return initials || '?';
  };

  $: connectedCount = lock ? 1 : 0;
  $: connectedLabel = connectedCount === 1 ? '1 utilisateur connecté' : `${connectedCount} utilisateurs connectés`;
  $: tooltipText = (() => {
    if (!lock) return '';
    if (isLockedByMe) return `${connectedLabel}, vous verrouillez le document.`;
    return `${connectedLabel}, ${lockOwnerLabel} verrouille le document. Cliquer pour demander le déverrouillage.`;
  })();

  const openTooltip = () => {
    if (closeTimer) clearTimeout(closeTimer);
    tooltipOpen = true;
  };

  const closeTooltip = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      tooltipOpen = false;
    }, 100);
  };

  const handleRequest = () => {
    if (!isLockedByOther || lockRequestedByMe) return;
    dispatch('requestUnlock');
  };

  const handleForce = () => {
    dispatch('forceUnlock');
  };
</script>

{#if lockLoading || lockError || lock}
  <div
    class="relative flex items-center gap-2"
    role="group"
    aria-label="Verrou du document"
    on:mouseenter={openTooltip}
    on:mouseleave={closeTooltip}
    on:focusin={openTooltip}
    on:focusout={closeTooltip}
  >
    {#if lockLoading}
      <span class="text-xs text-slate-500">Verrouillage…</span>
    {/if}
    {#if lockError}
      <span class="text-xs text-rose-600">{lockError}</span>
    {/if}
    {#if lock}
      <div class="flex items-center">
        <div class="flex items-center">
          <div
            class="h-7 w-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-semibold border border-white"
            style="margin-left: 0"
          >
            {getInitials(lock.lockedBy?.displayName || lock.lockedBy?.email)}
          </div>
        </div>
        <button
          class="ml-2 inline-flex items-center justify-center rounded p-2 text-slate-400 hover:bg-slate-100"
          on:click|stopPropagation={handleRequest}
          type="button"
          aria-label="Verrou du document"
          title={tooltipText}
        >
          <Lock class="h-5 w-5" />
        </button>
      </div>

      <div
        class="absolute right-0 top-full z-20 mt-2 w-72 rounded border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-lg transition"
        class:opacity-0={!tooltipOpen}
        class:opacity-100={tooltipOpen}
        class:pointer-events-none={!tooltipOpen}
        class:pointer-events-auto={tooltipOpen}
        role="tooltip"
        tabindex="-1"
        on:mouseenter={openTooltip}
        on:mouseleave={closeTooltip}
      >
        <div class="mb-2">{tooltipText}</div>
        {#if isLockedByOther}
          <div class="flex items-center gap-2">
            <button
              class="rounded border border-amber-200 px-2 py-1 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
              on:click|stopPropagation={handleRequest}
              disabled={lockRequestedByMe}
              type="button"
            >
              {lockRequestedByMe ? 'Demande envoyée' : 'Demander le déverrouillage'}
            </button>
            {#if isAdmin}
              <button
                class="rounded border border-rose-200 px-2 py-1 text-rose-700 hover:bg-rose-50"
                on:click|stopPropagation={handleForce}
                type="button"
              >
                Forcer
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
