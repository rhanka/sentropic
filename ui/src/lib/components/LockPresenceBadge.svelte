<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Key, Lock } from '@lucide/svelte';
  import type { LockSnapshot } from '$lib/utils/object-lock';

  export let lock: LockSnapshot | null = null;
  export let lockLoading: boolean = false;
  export let lockError: string | null = null;
  export let lockOwnerLabel: string = 'Utilisateur';
  export let lockRequestedByMe: boolean = false;
  export let isAdmin: boolean = false;
  export let isLockedByMe: boolean = false;
  export let isLockedByOther: boolean = false;
  export let avatars: Array<{ userId: string; label: string }> = [];
  export let connectedCount: number = 0;
  export let canRequestUnlock: boolean = true;
  export let showHeaderLock: boolean = true;

  const dispatch = createEventDispatcher<{
    requestUnlock: void;
    forceUnlock: void;
    releaseLock: void;
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

  $: orderedAvatars = (() => {
    const list = [...avatars];
    const ownerId = lock?.lockedBy?.userId;
    if (!ownerId) return list;
    const idx = list.findIndex((u) => u.userId === ownerId);
    if (idx === -1) return list;
    const [owner] = list.splice(idx, 1);
    list.push(owner);
    return list;
  })();

  $: safeCount = connectedCount || orderedAvatars.length || (lock ? 1 : 0);
  $: connectedLabel = safeCount === 1 ? '1 utilisateur connecté' : `${safeCount} utilisateurs connectés`;
  $: tooltipText = (() => {
    if (!lock) return `${connectedLabel}.`;
    if (isLockedByMe) return `${connectedLabel}, vous verrouillez le document.`;
    if (!canRequestUnlock) return `${connectedLabel}, ${lockOwnerLabel} verrouille le document.`;
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
    if (!canRequestUnlock) return;
    if (!isLockedByOther || lockRequestedByMe) return;
    dispatch('requestUnlock');
  };

  const handleForce = () => {
    dispatch('forceUnlock');
  };

  const handleRelease = () => {
    if (!isLockedByMe) return;
    dispatch('releaseLock');
  };

  $: shouldShowHeaderLock = showHeaderLock && !isLockedByMe;
  $: unlockRequesterLabel = (() => {
    const requesterId = lock?.unlockRequestedByUserId;
    if (!requesterId) return null;
    const match = avatars.find((u) => u.userId === requesterId);
    return match?.label || 'cet utilisateur';
  })();
  $: showReleaseAction = isLockedByMe && Boolean(lock?.unlockRequestedByUserId);
</script>

{#if lockLoading || lockError || lock || orderedAvatars.length > 0 || safeCount > 0}
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
    <div class="flex items-center">
        {#if orderedAvatars.length}
          <div class="flex items-center">
            {#each orderedAvatars as avatar, index}
              <div
                class="h-7 w-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-semibold border border-white"
                style={`margin-left: ${index === 0 ? 0 : -6}px; z-index: ${index + 1};`}
                title={avatar.label}
              >
                {getInitials(avatar.label)}
              </div>
            {/each}
          </div>
        {/if}
        {#if shouldShowHeaderLock}
          <button
            class="ml-2 inline-flex items-center justify-center rounded p-2 text-slate-400 hover:bg-slate-100"
            on:click|stopPropagation={handleRequest}
            type="button"
            aria-label="Verrou du document"
            title={tooltipText}
            aria-disabled={!canRequestUnlock}
          >
            <Lock class="h-5 w-5" />
          </button>
        {/if}
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
        <div class="flex items-center gap-2 justify-end">
          {#if showReleaseAction}
            <button
              class="inline-flex items-center justify-center text-slate-600 hover:text-slate-800"
              on:click|stopPropagation={handleRelease}
              type="button"
              aria-label={`Déverrouiller pour ${unlockRequesterLabel ?? ''}`.trim()}
              title={`Déverrouiller pour ${unlockRequesterLabel ?? ''}`.trim()}
            >
              <Lock class="h-4 w-4" />
            </button>
          {/if}
          {#if isLockedByOther && canRequestUnlock}
            <button
              class="inline-flex items-center justify-center text-amber-600 hover:text-amber-700 disabled:opacity-60"
              on:click|stopPropagation={handleRequest}
              disabled={lockRequestedByMe}
              type="button"
              aria-label="Demander le déverrouillage"
              title={lockRequestedByMe ? 'Demande envoyée' : 'Demander le déverrouillage'}
            >
              <Key class="h-4 w-4" />
            </button>
          {/if}
          {#if isLockedByOther && isAdmin}
            <button
              class="inline-flex items-center justify-center text-rose-600 hover:text-rose-700"
              on:click|stopPropagation={handleForce}
              type="button"
              aria-label="Forcer le déverrouillage"
              title="Forcer le déverrouillage"
            >
              <Lock class="h-4 w-4" />
            </button>
          {/if}
        </div>
      </div>
  </div>
{/if}
