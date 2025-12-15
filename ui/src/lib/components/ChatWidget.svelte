<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { queueStore, loadJobs, updateJob, addJob } from '$lib/stores/queue';
  import { apiPost } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import { isAuthenticated } from '$lib/stores/session';
  import { streamHub } from '$lib/stores/streamHub';

  import QueueMonitor from '$lib/components/QueueMonitor.svelte';
  import ChatPanel from '$lib/components/ChatPanel.svelte';

  type Tab = 'chat' | 'queue';
  let activeTab: Tab = 'chat';
  let isVisible = false;

  // Header Chat (sessions) piloté par ChatPanel via bindings
  type ChatSession = {
    id: string;
    title?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
  };
  let chatPanelRef: any = null;
  let chatSessions: ChatSession[] = [];
  let chatSessionId: string | null = null;
  let chatLoadingSessions = false;
  let headerSelection: string = '__new__'; // '__new__' | '__jobs__' | sessionId

  const formatSessionLabel = (s: ChatSession) => {
    if (s.title) return s.title;
    if (s.primaryContextType && s.primaryContextId) return `${s.primaryContextType}:${s.primaryContextId}`;
    return `Session ${s.id.slice(0, 6)}`;
  };

  $: jobsTotal = $queueStore.jobs.length;
  $: activeJobsCount = $queueStore.jobs.filter((job) => job.status === 'pending' || job.status === 'processing').length;
  $: hasActiveJobs = activeJobsCount > 0;
  $: failedJobsCount = $queueStore.jobs.filter((job) => job.status === 'failed').length;
  $: hasFailedJobs = failedJobsCount > 0;

  $: {
    if (activeTab === 'queue') headerSelection = '__jobs__';
    else if (chatSessionId) headerSelection = chatSessionId;
    else headerSelection = '__new__';
  }

  const handleHeaderSelectionChange = async (value: string) => {
    if (value === '__jobs__') {
      activeTab = 'queue';
      return;
    }
    activeTab = 'chat';
    if (value === '__new__') {
      chatPanelRef?.newSession?.();
      chatSessionId = null;
      return;
    }
    chatSessionId = value;
    await chatPanelRef?.selectSession?.(value);
  };

  const onJobUpdate = (evt: any) => {
    if (evt?.type !== 'job_update') return;
    const data = evt.data ?? {};
    const job = data?.job;
    if (!job) return;
    const exists = $queueStore.jobs.some((j) => j.id === job.id);
    if (exists) updateJob(job.id, job);
    else addJob(job);
  };

  // Abonnement léger permanent aux job_update pour garder l'icône de bulle à jour
  $: if ($isAuthenticated) {
    streamHub.setJobUpdates('chatWidgetJobs', onJobUpdate);
  } else {
    streamHub.delete('chatWidgetJobs');
  }

  onMount(async () => {
    if ($isAuthenticated) await loadJobs();
  });

  const toggle = async () => {
    isVisible = !isVisible;
    if (isVisible && $isAuthenticated) {
      await loadJobs();
    }
  };

  const close = () => {
    isVisible = false;
  };

  const handleDeleteAllJobs = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer TOUS les jobs ? Cette action est irréversible.')) {
      return;
    }
    try {
      const result = await apiPost('/queue/purge', { status: 'all' });
      addToast({ type: 'success', message: result.message });
      await loadJobs();
    } catch (error) {
      console.error('Failed to delete all jobs:', error);
      addToast({ type: 'error', message: 'Erreur lors de la suppression de tous les jobs' });
    }
  };

  onDestroy(() => {
    streamHub.delete('chatWidgetJobs');
  });
</script>

<div class="queue-monitor fixed bottom-4 right-4 z-50">
  <!-- Bulle unique (commune Chat/Queue) -->
  <button
    class="relative bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-colors"
    class:opacity-0={isVisible}
    class:pointer-events-none={isVisible}
    on:click={toggle}
    title="Chat / Jobs IA"
  >
    <!-- Icône principale: chat (toujours visible) -->
    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <!-- Bulle + queue (style “chat”) -->
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        d="M2.25 12.76c0 1.6.63 3.13 1.76 4.26v3.22c0 .62.75.93 1.19.49l2.4-2.4c.37.08.74.12 1.11.12h6.2c3.31 0 6-2.69 6-6s-2.69-6-6-6h-6.2c-3.31 0-6 2.69-6 6z"
      />
      <!-- Ellipsis -->
      <circle cx="9" cy="12.75" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12.75" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12.75" r="0.9" fill="currentColor" stroke="none" />
    </svg>

    <!-- Badge: loading (petit spinner) -->
    {#if $queueStore.isLoading}
      <span class="absolute top-1 right-1 text-white rounded-full p-1 shadow">
        <svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
        </svg>
      </span>
    {:else if hasActiveJobs}
      <!-- Badge: jobs en cours => montre -->
      <span class="absolute top-1 right-1 text-white rounded-full p-1 shadow" title={`${activeJobsCount} job(s) en cours`}>
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </span>
    {:else if hasFailedJobs}
      <!-- Badge: au moins un job en échec -->
      <span class="absolute -top-1 -right-1 bg-white text-red-600 rounded-full p-1 shadow" title={`${failedJobsCount} job(s) en échec`}>
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </span>
    {/if}
  </button>

  {#if isVisible}
    <!-- Fenêtre plus haute, ancrée en bas et recouvrant la bulle (bulle cachée pendant ouverture) -->
    <div class="absolute bottom-0 right-0 w-96 h-[70vh] max-h-[70vh] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden flex flex-col">
      <!-- Header commun (sélecteur unique: sessions + jobs) -->
      <div class="p-3 border-b border-gray-200">
        <div class="flex items-center justify-between gap-2">
          <!-- Session / Jobs -->
          <select
            class="w-52 min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            bind:value={headerSelection}
            disabled={chatLoadingSessions}
            on:change={(e) => void handleHeaderSelectionChange((e.currentTarget as HTMLSelectElement).value)}
            title="Session / Jobs"
          >
            <option value="__new__">Nouvelle session</option>
            {#if chatSessions.length > 0}
              <optgroup label="Sessions">
                {#each chatSessions as s (s.id)}
                  <option value={s.id}>{formatSessionLabel(s)}</option>
                {/each}
              </optgroup>
            {/if}
            <option value="__jobs__">Jobs IA {jobsTotal ? `(${jobsTotal})` : ''}</option>
          </select>

          <div class="flex items-center gap-2">
            {#if activeTab === 'chat'}
              <button
                class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                on:click={() => chatPanelRef?.newSession?.()}
                title="Nouvelle session"
                type="button"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
              </button>

              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                on:click={() => chatPanelRef?.deleteCurrentSession?.()}
                title="Supprimer la conversation"
                type="button"
                disabled={!chatSessionId}
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
              </button>
            {/if}
            {#if activeTab === 'queue'}
              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                on:click={handleDeleteAllJobs}
                title="Supprimer tous les jobs"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
              </button>
            {/if}
            <button class="text-gray-400 hover:text-gray-600" on:click={close} aria-label="Fermer">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Contenu (QueueMonitor inchangé hors header) -->
      <div class="flex-1 min-h-0">
        {#if activeTab === 'queue'}
          <QueueMonitor />
        {:else}
          <ChatPanel
            bind:this={chatPanelRef}
            bind:sessions={chatSessions}
            bind:sessionId={chatSessionId}
            bind:loadingSessions={chatLoadingSessions}
          />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Mettre "Jobs IA" en gras dans le sélecteur (support dépend du navigateur, mais OK sur Chromium) */
  select option[value="__jobs__"] {
    font-weight: 700;
  }
</style>


