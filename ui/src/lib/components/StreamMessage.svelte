<script lang="ts">
  import { onDestroy } from 'svelte';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';

  export let streamId: string;
  export let status: string | undefined;
  export let maxHistory = 10;
  export let initiallyExpanded = false;
  export let placeholderTitle: string | undefined = undefined;
  export let placeholderBody: string | undefined = undefined;

  type Step = { sequence: number; title: string; body?: string; updatedAt: number };

  let expanded = initiallyExpanded;
  let history: Step[] = [];

  // Accumulateurs complets (pas de troncature)
  let reasoningText = '';
  let contentText = '';
  let toolArgsById: Record<string, string> = {};

  // Garder le scroll collé en bas pour les zones de delta (meilleure lisibilité en streaming)
  const scrollToEnd = (node: HTMLElement) => {
    const scroll = () => {
      try {
        node.scrollTop = node.scrollHeight;
      } catch {
        // ignore
      }
    };
    scroll();
    const obs = new MutationObserver(scroll);
    obs.observe(node, { childList: true, subtree: true, characterData: true });
    return {
      destroy() {
        obs.disconnect();
      }
    };
  };

  const makeKey = () => `streamMessage:${streamId}:${Math.random().toString(36).slice(2)}`;
  let subKey = makeKey();
  let subscribedTo: string | null = null;

  const pushStep = (step: Step) => {
    const last = history[history.length - 1];
    const same =
      last &&
      last.title === step.title &&
      (last.body ?? '') === (step.body ?? '');
    const next = (same ? [...history.slice(0, -1), step] : [...history, step]).slice(-80);
    history = next;
  };

  const upsertTail = (step: Step, predicate: (s: Step) => boolean) => {
    const last = history[history.length - 1];
    if (last && predicate(last)) {
      history = [...history.slice(0, -1), step];
      return;
    }
    pushStep(step);
  };

  const computeDisplayStep = (steps: Step[]): Step | null => {
    if (!steps.length) return null;
    // On affiche *vraiment* la dernière étape, y compris "Terminé"
    return steps[steps.length - 1] ?? null;
  };

  const isTerminalStatus = (st?: string) => {
    if (!st) return false;
    return st === 'completed' || st === 'failed' || st === 'done';
  };
  const defaultPlaceholderTitle = () => {
    if (placeholderTitle) return placeholderTitle;
    if (streamId?.startsWith('company_')) return 'Enrichissement en cours…';
    return 'En cours…';
  };
  const defaultPlaceholderBody = () => {
    if (placeholderBody) return placeholderBody;
    return 'En attente des premiers messages…';
  };

  const handle = (evt: StreamHubEvent) => {
    if (!streamId) return;
    if ((evt as any).streamId !== streamId) return;
    if (!Number.isFinite((evt as any).sequence)) return;

    const type = (evt as any).type as string;
    const sequence = (evt as any).sequence as number;
    const data = (evt as any).data ?? {};
    const now = Date.now();

    const setStep = (title: string, body?: string) => pushStep({ sequence, title, body, updatedAt: now });

    if (type === 'status') {
      setStep(`Statut: ${data?.state ?? 'unknown'}`);
    } else if (type === 'reasoning_delta') {
      const delta = String(data?.delta ?? '');
      reasoningText += delta;
      const txt = reasoningText.trim();
      if (txt) {
        upsertTail(
          { sequence, title: 'Raisonnement', body: txt, updatedAt: now },
          (s) => s.title === 'Raisonnement'
        );
      }
    } else if (type === 'content_delta') {
      const delta = String(data?.delta ?? '');
      contentText += delta;
      const txt = contentText.trim();
      if (txt) {
        upsertTail(
          { sequence, title: 'Réponse', body: txt, updatedAt: now },
          (s) => s.title === 'Réponse'
        );
      }
    } else if (type === 'tool_call_start') {
      const name = data?.name ?? 'unknown';
      const args = String(data?.args ?? '').trim();
      setStep(`Outil: ${name} (préparation)`, args || undefined);
    } else if (type === 'tool_call_delta') {
      const toolId = String(data?.tool_call_id ?? '').trim() || 'unknown';
      const delta = String(data?.delta ?? '');
      toolArgsById[toolId] = (toolArgsById[toolId] ?? '') + delta;
      const args = toolArgsById[toolId].trim();
      upsertTail(
        { sequence, title: `Outil: ${toolId} (args)`, body: args || undefined, updatedAt: now },
        (s) => s.title.startsWith('Outil:') && s.title.includes('(args)')
      );
    } else if (type === 'tool_call_result') {
      const st = data?.result?.status ?? 'unknown';
      const err = data?.result?.error;
      setStep(err ? `Outil: erreur` : `Outil: ${st}`, err ? String(err) : undefined);
    } else if (type === 'error') {
      setStep('Erreur', String(data?.message ?? 'unknown'));
    } else if (type === 'done') {
      setStep('Terminé');
    }
  };

  const subscribe = (id: string) => {
    if (!id) return;
    // recréer une clé pour éviter les collisions si streamId change
    subKey = makeKey();
    streamHub.setStream(subKey, id, handle);
    subscribedTo = id;
  };

  const unsubscribe = () => {
    if (!subscribedTo) return;
    streamHub.delete(subKey);
    subscribedTo = null;
  };

  $: if (streamId && streamId !== subscribedTo) {
    unsubscribe();
    history = [];
    reasoningText = '';
    contentText = '';
    toolArgsById = {};
    subscribe(streamId);
  }

  onDestroy(() => {
    unsubscribe();
  });

  $: display = computeDisplayStep(history);
  $: canExpand = history.length > 1;
  $: prefix = isTerminalStatus(status) ? 'Dernière étape' : 'Étape en cours';
</script>

{#if display}
  <div class="w-full max-w-full box-border text-xs text-blue-700 mt-1 bg-blue-50 p-2 rounded">
    <div class="flex items-center justify-between gap-2">
      <div class="font-medium break-words min-w-0">{prefix}: {display.title}</div>
      {#if canExpand}
        <button
          class="text-blue-700 hover:text-blue-900 p-1 rounded hover:bg-blue-100/70 shrink-0 self-start"
          on:click={() => expanded = !expanded}
          type="button"
          aria-label={expanded ? 'Replier le détail' : 'Déplier le détail'}
          title={expanded ? 'Replier' : 'Déplier'}
        >
          <svg
            class="w-4 h-4 transition-transform duration-150 {expanded ? 'rotate-180' : ''}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      {/if}
    </div>
    {#if display.body}
      <div
        class="mt-1 max-h-16 overflow-y-scroll whitespace-pre-wrap break-words text-blue-900/90 stream-scroll"
        style="scrollbar-gutter: stable;"
        use:scrollToEnd
      >
        {display.body}
      </div>
    {/if}
  </div>

  {#if expanded && canExpand}
    <div class="w-full max-w-full box-border text-xs text-slate-700 mt-1 bg-slate-50 p-2 rounded">
      <div class="font-medium mb-1">Historique</div>
      <ul class="list-disc pl-4 space-y-2">
        {#each history.slice(-maxHistory) as step}
          <li class="break-words">
            <div class="font-medium">{step.title}</div>
            {#if step.body}
              <div
                class="mt-0.5 max-h-40 overflow-y-scroll whitespace-pre-wrap break-words text-slate-800 stream-scroll"
                style="scrollbar-gutter: stable;"
                use:scrollToEnd
              >
                {step.body}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{:else if !isTerminalStatus(status)}
  <div class="w-full max-w-full box-border text-xs text-blue-700 mt-1 bg-blue-50 p-2 rounded">
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <div class="font-medium break-words">{defaultPlaceholderTitle()}</div>
        <div class="mt-1 text-blue-900/90">{defaultPlaceholderBody()}</div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Scrollbar discret (WebKit + Firefox) */
  .stream-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(15, 23, 42, 0.28) transparent;
  }
  .stream-scroll::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .stream-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .stream-scroll::-webkit-scrollbar-thumb {
    background-color: rgba(15, 23, 42, 0.22);
    border-radius: 999px;
    border: 3px solid transparent;
    background-clip: content-box;
  }
  .stream-scroll:hover::-webkit-scrollbar-thumb {
    background-color: rgba(15, 23, 42, 0.32);
  }
</style>


