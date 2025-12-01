<script lang="ts">
  import { toasts, removeToast } from '$lib/stores/toast';
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';

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
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
      default:
        return '•';
    }
  };
</script>

<div class="fixed top-4 right-4 z-50 space-y-2">
  {#each $toasts as toast (toast.id)}
    <div
      class={getToastClasses(toast.type)}
      animate:flip={{ duration: 200 }}
      transition:fly={{ x: 300, duration: 200 }}
      role="alert"
    >
      <div class="flex items-start">
        <div class="flex-shrink-0">
          <span class="text-lg font-bold">{getIcon(toast.type)}</span>
        </div>
        <div class="ml-3 flex-1">
          <p class="text-sm font-medium">{toast.message}</p>
        </div>
        <div class="ml-4 flex-shrink-0">
          <button
            class="text-gray-400 hover:text-gray-600 focus:outline-none"
            on:click={() => removeToast(toast.id)}
          >
            <span class="sr-only">Fermer</span>
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  {/each}
</div>


