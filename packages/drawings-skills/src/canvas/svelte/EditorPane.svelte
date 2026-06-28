<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, keymap, lineNumbers } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

  let { value = '', onchange }: { value?: string; onchange?: (v: string) => void } = $props();

  let el: HTMLDivElement;
  let view: EditorView | undefined;

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onchange?.(u.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          }),
        ],
      }),
      parent: el,
    });
    return () => view?.destroy();
  });

  // External source changes (e.g. chat local-tool) -> editor.
  $effect(() => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  });
</script>

<div bind:this={el} class="h-full w-full overflow-auto"></div>
