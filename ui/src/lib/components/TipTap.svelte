<script>
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
    import { Markdown } from 'tiptap-markdown';
    import { 
      BulletListWithClasses, 
      OrderedListWithClasses, 
      ListItemWithClasses, 
      HeadingWithClasses 
    } from '$lib/extensions/tailwind-classes';

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
      extensions: [
        // StarterKit avec certaines extensions désactivées pour utiliser nos versions avec classes Tailwind
        StarterKit.configure({
          bulletList: false,  // Remplacé par BulletListWithClasses
          orderedList: false, // Remplacé par OrderedListWithClasses
          listItem: false,    // Remplacé par ListItemWithClasses
          heading: false,     // Remplacé par HeadingWithClasses
        }),
        // Nos extensions avec classes Tailwind
        BulletListWithClasses,
        OrderedListWithClasses,
        ListItemWithClasses,
        HeadingWithClasses,
        // Extension Markdown
        Markdown,
      ],
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

    /* Masquer le paragraphe vide que TipTap ajoute après une liste */
    :global(.markdown-wrapper .ProseMirror > p:last-child:empty),
    :global(.markdown-wrapper .ProseMirror > p:last-child:has(> br:only-child)) {
        display: none;
    }

    :global(.markdown-wrapper .ProseMirror > *:last-child),
    :global(.markdown-wrapper .ProseMirror > *:nth-last-child(2):is(p, ul, ol)),
    :global(.markdown-wrapper .ProseMirror > ul:last-child),
    :global(.markdown-wrapper .ProseMirror > ol:last-child),
    :global(.markdown-wrapper .ProseMirror > ul:nth-last-child(2)),
    :global(.markdown-wrapper .ProseMirror > ol:nth-last-child(2)),
    :global(.markdown-wrapper .ProseMirror > ul:last-child li:last-child),
    :global(.markdown-wrapper .ProseMirror > ol:last-child li:last-child) {
        margin-bottom: 0 !important;
    }

    :global(.markdown-wrapper .ProseMirror > ul:nth-last-child(2) li:last-child),
    :global(.markdown-wrapper .ProseMirror > ol:nth-last-child(2) li:last-child) {
        margin-bottom: 0 !important;
    }

    /* Supprimé: padding-bottom: 0.2rem sur .tiptap > ul > li */
    /* Maintenant géré par les classes Tailwind (space-y-2 + mb-1) */
</style>