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
import { arrayToMarkdown, markdownToArray } from '$lib/utils/markdown';

    export let value;
    export let forceList = false;
    let editor, element;
    let lastValue;
    const dispatch = createEventDispatcher();

    const LIST_LINE_REGEX = /^\s*(?:[-*+]|(?:\d+\.))\s+/;

    const ensureListMarkdown = (text) => {
      if (!forceList) return text || '';
      const source = text ?? '';
      const lines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const alreadyList = lines.length > 0 && lines.every((line) => LIST_LINE_REGEX.test(line));
      if (alreadyList || !lines.length) {
        return source;
      }
      const items = markdownToArray(source);
      if (!items.length) return '';
      return arrayToMarkdown(items);
    };

    // Mettre à jour uniquement si value change depuis l'extérieur
    // En mode forceList, on désactive le watcher pour éviter les boucles (normalisation uniquement à l'init)
    $: if (editor && value !== lastValue && !forceList) {
        const processed = ensureListMarkdown(value);
        if (processed !== lastValue) {
          editor.commands.setContent(processed);
          lastValue = processed;
        }
    }

  onMount(() => {
    const initialContent = ensureListMarkdown(value);
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
      content: initialContent,
      onUpdate: ({ editor }) => {
        const rawContent = editor.storage.markdown.getMarkdown();
        if (rawContent !== lastValue) {
            lastValue = rawContent;
            dispatch('change', { value: rawContent });
        }
      },
    });
    lastValue = initialContent;

    // Gérer les raccourcis clavier en mode forceList
    if (forceList) {
      editor.on('transaction', ({ editor, transaction }) => {
        const { selection, doc } = editor.state;
        const { $from } = selection;
        
        // Vérifier si on est dans un listItem
        let inListItem = false;
        for (let depth = $from.depth; depth >= 0; depth -= 1) {
          if ($from.node(depth).type.name === 'listItem') {
            inListItem = true;
            break;
          }
        }
        
        // Si on n'est plus dans une liste après la transaction, forcer le retour en liste
        if (!inListItem && doc.content.size > 0) {
          const firstChild = doc.firstChild;
          if (firstChild && firstChild.type.name !== 'bulletList' && firstChild.type.name !== 'orderedList') {
            // Convertir le contenu en liste
            editor.chain().focus().toggleBulletList().run();
          }
        }
      });
    }

    const handleKeyDown = (event) => {
      if (!forceList) return;
      // Empêcher Tab (indentation) et Shift+Tab (sortie de liste)
      if (event.key === 'Tab') {
        event.preventDefault();
        return false;
      }
      // Empêcher Ctrl+Shift (autres raccourcis de sortie)
      if (event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        return false;
      }
      // Si Enter sur un listItem vide, créer un nouveau listItem au lieu de sortir
      if (event.key === 'Enter') {
        const { selection } = editor.state;
        const { $from } = selection;
        let inListItem = false;
        let listItemNode = null;
        for (let depth = $from.depth; depth >= 0; depth -= 1) {
          const node = $from.node(depth);
          if (node.type.name === 'listItem') {
            inListItem = true;
            listItemNode = node;
            break;
          }
        }
        if (inListItem && listItemNode && !listItemNode.textContent.trim()) {
          // ListItem vide : forcer la création d'un nouveau listItem
          event.preventDefault();
          // Utiliser splitListItem pour créer un nouvel item
          editor.chain().splitListItem('listItem').run();
          return false;
        }
      }
    };

    element?.addEventListener('keydown', handleKeyDown, true);

    onDestroy(() => {
      element?.removeEventListener('keydown', handleKeyDown, true);
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