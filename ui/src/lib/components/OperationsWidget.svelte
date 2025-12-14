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

  $: hasJobs = $queueStore.jobs.length > 0;
  $: allJobsCompleted = hasJobs && $queueStore.jobs.every(job => job.status === 'completed');
  $: hasFailedJobs = hasJobs && $queueStore.jobs.some(job => job.status === 'failed');

  const onJobUpdate = (evt: any) => {
    if (evt?.type !== 'job_update') return;
    const data = evt.data ?? {};
    const job = data?.job;
    if (!job) return;
    const exists = $queueStore.jobs.some(j => j.id === job.id);
    if (exists) updateJob(job.id, job);
    else addJob(job);
  };

  // Abonnement léger permanent aux job_update pour garder l'icône de bulle à jour
  $: if ($isAuthenticated) {
    streamHub.setJobUpdates('operationsWidgetJobs', onJobUpdate);
  } else {
    streamHub.delete('operationsWidgetJobs');
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
    streamHub.delete('operationsWidgetJobs');
  });
</script>

<div class="queue-monitor fixed bottom-4 right-4 z-50">
  <!-- Bulle unique (commune Chat/Queue) -->
  <button
    class="bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-colors"
    on:click={toggle}
    title="Opérations IA (Chat & Jobs)"
  >
    {#if $queueStore.isLoading}
      <svg class="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
      </svg>
    {:else if hasFailedJobs}
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    {:else if allJobsCompleted && hasJobs}
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M5 13l4 4L19 7"></path>
      </svg>
    {:else}
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
    {/if}
  </button>

  {#if isVisible}
    <div class="absolute bottom-16 right-0 w-96 bg-white rounded-lg shadow-xl border border-gray-200 max-h-96 overflow-hidden">
      <!-- Header commun (switch + boutons) -->
      <div class="p-3 border-b border-gray-200">
        <div class="flex items-center justify-between gap-2">
          <!-- Switch: inclut le titre minimalement -->
          <div class="flex items-center rounded-md bg-slate-100 p-0.5">
            <button
              class="px-2 py-1 text-xs rounded {activeTab === 'chat' ? 'bg-white shadow text-slate-900' : 'text-slate-600'}"
              on:click={() => (activeTab = 'chat')}
              type="button"
            >
              Chat
            </button>
            <button
              class="px-2 py-1 text-xs rounded {activeTab === 'queue' ? 'bg-white shadow text-slate-900' : 'text-slate-600'}"
              on:click={() => (activeTab = 'queue')}
              type="button"
            >
              Jobs IA {#if hasJobs}({$queueStore.jobs.length}){/if}
            </button>
          </div>

          <div class="flex items-center gap-2">
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
      {#if activeTab === 'queue'}
        <QueueMonitor />
      {:else}
        <ChatPanel />
      {/if}
    </div>
  {/if}
</div>


