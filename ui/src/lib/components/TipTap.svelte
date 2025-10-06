<script>
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
    import { Markdown } from 'tiptap-markdown';

    export let value;
    let editor, element;
    let lastValue;
    const dispatch = createEventDispatcher();

    // Mettre à jour uniquement si value change depuis l'extérieur
    $: if (editor && value !== lastValue) {
        editor.commands.setContent(value);
        lastValue = value;
    }

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [StarterKit, Markdown],
      content: value,
      onUpdate: ({ editor }) => {
        const content = editor.storage.markdown.getMarkdown();
        if (content !== value) {
            lastValue = content;
            value = content;
            dispatch('change', { value: content });
        }
      },
    });
  });

  onDestroy(() => editor?.destroy());
</script>

<div bind:this={element}></div>

<style>
	:global(.ProseMirror-focused) {
        border: none!important;
        outline: none!important;
    }

    :global(.tiptap > ul > li) {
        padding-bottom: 0.2rem;
    }
</style>