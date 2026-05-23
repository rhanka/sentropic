<script lang="ts">
  import PackageStreamMessage from '@sentropic/chat-ui/components/StreamMessage.svelte';
  import { streamHub } from '$lib/stores/streamHub';
  import { _ } from 'svelte-i18n';
  import type { GeneratedFileCard } from '$lib/utils/docx';

  type LabelOptions = { values?: Record<string, unknown> };

  export let streamId: string;
  export let status: string | undefined;
  export let maxHistory = 10;
  export let initiallyExpanded = false;
  export let placeholderTitle: string | undefined = undefined;
  export let placeholderBody: string | undefined = undefined;
  export let variant: 'chat' | 'job' = 'job';
  export let finalContent: string | null | undefined = undefined;
  export let initialEvents:
    | Array<{ eventType: string; data: unknown; sequence: number; createdAt?: string }>
    | undefined = undefined;
  export let historyPending = false;
  export let subscriptionMode: 'live' | 'passive' = 'live';
  export let smoothContentStreaming = false;
  export let smoothChunkThreshold = 80;
  export let acknowledgementText: string | undefined = undefined;
  export let showRuntimeInlinePreview = true;
  export let deferCollapsedDetails = false;
  export let requestDeferredDetails: (() => Promise<void>) | undefined = undefined;
  export let runtimeSummary:
    | {
        hasReasoning: boolean;
        hasTools: boolean;
        toolCount: number;
        contextBudgetPct: number | null;
        durationMs: number | null;
        reasoningEffortLabel: string | null;
        generatedFileCards?: GeneratedFileCard[];
        docxCards?: Array<{ jobId: string; fileName: string }>;
      }
    | undefined = undefined;
  export let onTerminal: ((t: 'done' | 'error') => void) | undefined = undefined;
  export let onStreamEvent: ((t: string) => void) | undefined = undefined;
  export let onGeneratedFile: ((card: GeneratedFileCard) => void) | undefined = undefined;
  export let onTodoRuntime:
    | ((
        update: {
          toolCallId: string;
          toolName: 'plan';
          result: Record<string, unknown>;
        },
      ) => void)
    | undefined = undefined;

  $: labelResolver = (key: string, options?: LabelOptions): string => {
    const translate = $_ as unknown as (
      messageId: string,
      messageOptions?: LabelOptions,
    ) => string;
    return translate(key, options);
  };
</script>

<PackageStreamMessage
  streamClient={streamHub}
  labels={labelResolver}
  {streamId}
  {status}
  {maxHistory}
  {initiallyExpanded}
  {placeholderTitle}
  {placeholderBody}
  {variant}
  {finalContent}
  {initialEvents}
  {historyPending}
  {subscriptionMode}
  {smoothContentStreaming}
  {smoothChunkThreshold}
  {acknowledgementText}
  {showRuntimeInlinePreview}
  {deferCollapsedDetails}
  {requestDeferredDetails}
  {runtimeSummary}
  {onTerminal}
  {onStreamEvent}
  {onGeneratedFile}
  {onTodoRuntime}
/>
