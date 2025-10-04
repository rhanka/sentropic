<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  
  export let value = '';
  const dispatch = createEventDispatcher();
  
  let editor;
  let editorElement;
  
  onMount(() => {
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit,
      ],
      content: value,
      onUpdate: ({ editor }) => {
        const html = editor.getHTML();
        value = html;
        dispatch('change', { value: html });
      },
    });
    
    return () => {
      editor?.destroy();
    };
  });
  
  onDestroy(() => {
    editor?.destroy();
  });
  
  // Mettre à jour l'éditeur quand la valeur change de l'extérieur
  $: if (editor && value !== editor.getHTML()) {
    editor.commands.setContent(value, false);
  }
</script>

<div class="tiptap-container">
  <div bind:this={editorElement} class="tiptap-editor"></div>
</div>

<style>
  .tiptap-container {
    width: 100%;
    min-height: 100px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    overflow: hidden;
  }
  
  :global(.tiptap-editor) {
    min-height: 100px;
    padding: 8px 12px;
    outline: none;
  }
  
  :global(.tiptap-editor:focus) {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
  
  :global(.tiptap-editor p) {
    margin: 0.5rem 0;
  }
  
  :global(.tiptap-editor p:first-child) {
    margin-top: 0;
  }
  
  :global(.tiptap-editor p:last-child) {
    margin-bottom: 0;
  }
  
  :global(.tiptap-editor ul, .tiptap-editor ol) {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }
  
  :global(.tiptap-editor li) {
    margin: 0.25rem 0;
  }
  
  :global(.tiptap-editor strong) {
    font-weight: bold;
  }
  
  :global(.tiptap-editor em) {
    font-style: italic;
  }
  
  :global(.tiptap-editor code) {
    background-color: #f3f4f6;
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-family: monospace;
  }
  
  :global(.tiptap-editor blockquote) {
    border-left: 4px solid #d1d5db;
    padding-left: 1rem;
    margin: 1rem 0;
    font-style: italic;
    color: #6b7280;
  }
</style>
