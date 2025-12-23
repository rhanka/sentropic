<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { queueStore, loadJobs, updateJob, addJob } from '$lib/stores/queue';
  import { apiPost } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import { isAuthenticated, session } from '$lib/stores/session';
  import { streamHub } from '$lib/stores/streamHub';
  import { MessageCircle, Loader2, Clock, X, Plus, Trash2, Minus } from '@lucide/svelte';

  import QueueMonitor from '$lib/components/QueueMonitor.svelte';
  import ChatPanel from '$lib/components/ChatPanel.svelte';

  type Tab = 'chat' | 'queue';
  let activeTab: Tab = 'chat';
  let isVisible = false;
  let hasOpenedOnce = false;

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
    // Important: si on revient sur la même session (après être passé sur Jobs),
    // ne pas recharger les messages/streams, juste réafficher le panel.
    if (value === chatSessionId) {
      return;
    }
    chatSessionId = value;
    await chatPanelRef?.selectSession?.(value);
  };

  const onHeaderSelectionChange = (event: Event) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    const value = target?.value ?? '__new__';
    void handleHeaderSelectionChange(value);
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
    if (isVisible) hasOpenedOnce = true;
  };

  const close = () => {
    isVisible = false;
  };

  const handlePurgeMyJobs = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer TOUS vos jobs IA ? Cette action est irréversible.')) {
      return;
    }
    try {
      const result = await apiPost('/queue/purge-mine', { status: 'all' });
      addToast({ type: 'success', message: result.message });
      await loadJobs();
    } catch (error) {
      console.error('Failed to purge my jobs:', error);
      addToast({ type: 'error', message: 'Erreur lors de la suppression de vos jobs' });
    }
  };

  const handlePurgeAllJobsGlobal = async () => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer TOUS les jobs (global) ? Cette action est irréversible.')) {
      return;
    }
    try {
      const result = await apiPost('/queue/purge', { status: 'all' });
      addToast({ type: 'success', message: result.message });
      await loadJobs();
    } catch (error) {
      console.error('Failed to purge ALL jobs (global):', error);
      addToast({ type: 'error', message: 'Erreur lors de la suppression de tous les jobs (global)' });
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
    <MessageCircle class="w-6 h-6" aria-hidden="true" />

    <!-- Badge: loading (petit spinner) -->
    {#if $queueStore.isLoading}
      <span class="absolute top-1 right-1 text-white rounded-full p-1 shadow">
        <Loader2 class="w-3 h-3 animate-spin" />
      </span>
    {:else if hasActiveJobs}
      <!-- Badge: jobs en cours => montre -->
      <span class="absolute top-1 right-1 text-white rounded-full p-1 shadow" title={`${activeJobsCount} job(s) en cours`}>
        <Clock class="w-3 h-3" aria-hidden="true" />
      </span>
    {:else if hasFailedJobs}
      <!-- Badge: au moins un job en échec -->
      <span class="absolute -top-1 -right-1 bg-white text-red-600 rounded-full p-1 shadow" title={`${failedJobsCount} job(s) en échec`}>
        <X class="w-3 h-3" aria-hidden="true" />
      </span>
    {/if}
  </button>

  {#if hasOpenedOnce}
    <!-- Fenêtre montée une seule fois, puis hide/show pour éviter remount + appels API -->
    <div
      class="absolute bottom-0 right-0 w-96 h-[70vh] max-h-[70vh] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden flex flex-col"
      class:hidden={!isVisible}
    >
      <!-- Header commun (sélecteur unique: sessions + jobs) -->
      <div class="p-3 border-b border-gray-200">
        <div class="flex items-center justify-between gap-2">
          <!-- Session / Jobs -->
          <select
            class="w-52 min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            bind:value={headerSelection}
            disabled={chatLoadingSessions}
            on:change={onHeaderSelectionChange}
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
                <Plus class="w-4 h-4" />
              </button>

              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                on:click={() => chatPanelRef?.deleteCurrentSession?.()}
                title="Supprimer la conversation"
                type="button"
                disabled={!chatSessionId}
              >
                <Trash2 class="w-4 h-4" />
              </button>
            {/if}
            {#if activeTab === 'queue'}
              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                on:click={handlePurgeMyJobs}
                title="Supprimer tous mes jobs"
              >
                <Trash2 class="w-4 h-4" />
              </button>
              {#if $session.user?.role === 'admin_app'}
                <button
                  class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                  on:click={handlePurgeAllJobsGlobal}
                  title="Supprimer tous les jobs (global)"
                >
                  <Minus class="w-4 h-4" />
                </button>
              {/if}
            {/if}
            <button class="text-gray-400 hover:text-gray-600" on:click={close} aria-label="Fermer">
              <X class="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <!-- Contenu (QueueMonitor inchangé hors header) -->
      <div class="flex-1 min-h-0">
        {#if activeTab === 'queue'}
          <div class="h-full">
            <QueueMonitor />
          </div>
        {/if}
        <div class="h-full" class:hidden={activeTab !== 'chat'}>
          <ChatPanel
            bind:this={chatPanelRef}
            bind:sessions={chatSessions}
            bind:sessionId={chatSessionId}
            bind:loadingSessions={chatLoadingSessions}
          />
        </div>
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


