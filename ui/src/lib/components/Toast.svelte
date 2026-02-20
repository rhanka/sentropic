<script lang="ts">
  import { toasts, removeToast } from '$lib/stores/toast';
  import { chatWidgetLayout } from '$lib/stores/chatWidgetLayout';
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { CheckCircle2, XCircle, AlertTriangle, Info, Download, X } from '@lucide/svelte';
  import { _ } from 'svelte-i18n';

  const CHAT_BUTTON_RIGHT_CSS = '1rem';
  const CHAT_BUTTON_SIZE_CSS = '3rem';
  const CHAT_PANEL_WIDTH_CSS = 'min(28rem, calc(100vw - 2rem))';
  const TOAST_CHAT_GAP_CSS = '0.5rem';
  const TOAST_BOTTOM_CSS = '1rem';

  $: isDockedOpen = $chatWidgetLayout.mode === 'docked' && $chatWidgetLayout.isOpen;
  $: isFloatingOpen = $chatWidgetLayout.mode === 'floating' && $chatWidgetLayout.isOpen;
  $: rightOffset = (() => {
    if (isDockedOpen) {
      if ($chatWidgetLayout.dockWidthCss === '100vw') return '1rem';
      return `calc(${$chatWidgetLayout.dockWidthCss} + ${TOAST_CHAT_GAP_CSS})`;
    }
    if (isFloatingOpen) {
      return `calc(${CHAT_PANEL_WIDTH_CSS} + ${CHAT_BUTTON_RIGHT_CSS} + ${TOAST_CHAT_GAP_CSS})`;
    }
    return `calc(${CHAT_BUTTON_RIGHT_CSS} + ${CHAT_BUTTON_SIZE_CSS} + ${TOAST_CHAT_GAP_CSS})`;
  })();

  const getToastClasses = (type: string) => {
    const baseClasses = 'rounded-lg p-4 shadow-lg border max-w-sm w-full';
    switch (type) {
      case 'success':
        return `${baseClasses} bg-green-50 border-green-200 text-green-800`;
      case 'error':
        return `${baseClasses} bg-red-50 border-red-200 text-red-800`;
      case 'warning':
        return `${baseClasses} bg-yellow-50 border-yellow-200 text-yellow-800`;
      case 'info':
        return `${baseClasses} bg-blue-50 border-blue-200 text-blue-800`;
      default:
        return `${baseClasses} bg-gray-50 border-gray-200 text-gray-800`;
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return CheckCircle2;
      case 'error':
        return XCircle;
      case 'warning':
        return AlertTriangle;
      case 'info':
        return Info;
      default:
        return Info;
    }
  };

</script>

<div
  class="toast-container fixed z-[70] space-y-2 max-w-[calc(100vw-2rem)] transition-[right,bottom] duration-200"
  style:bottom={TOAST_BOTTOM_CSS}
  style:right={rightOffset}
>
  {#each $toasts as toast (toast.id)}
    {@const Icon = getIcon(toast.type)}
    <div
      class={getToastClasses(toast.type)}
      animate:flip={{ duration: 200 }}
      transition:fly={{ x: 300, duration: 200 }}
      role="alert"
    >
      <div class="flex items-start">
        <div class="flex-shrink-0">
          <Icon class="w-5 h-5" />
        </div>
        <div class="ml-3 flex-1">
          <p class="text-sm font-medium">{toast.message}</p>
          {#if toast.actionLabel && toast.onAction}
            <div class="mt-2 flex justify-center">
              <button
                class="inline-flex items-center gap-1 rounded border border-current/25 px-2 py-1 text-xs font-medium hover:bg-white/40"
                on:click={() => toast.onAction?.()}
              >
                {#if toast.actionIcon === 'download'}
                  <Download class="h-3.5 w-3.5" />
                {/if}
                <span>{toast.actionLabel}</span>
              </button>
            </div>
          {/if}
        </div>
        <div class="ml-4 flex-shrink-0">
          <button
            class="text-gray-400 hover:text-gray-600 focus:outline-none"
            on:click={() => removeToast(toast.id)}
          >
            <span class="sr-only">{$_('common.close')}</span>
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  {/each}
</div>
