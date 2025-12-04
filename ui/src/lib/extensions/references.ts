import { Mark } from '@tiptap/core';

/**
 * Extension TipTap pour transformer les références [1], [2] en liens cliquables
 * Similaire au post-traitement parseReferencesInMarkdown() utilisé dans renderMarkdown
 */

export interface ReferencesOptions {
  references?: Array<{title: string; url: string}>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    references: {
      /**
       * Set references for the editor
       */
      setReferences: (references: Array<{title: string; url: string}>) => ReturnType;
    };
  }
}

export const References = Mark.create<ReferencesOptions>({
  name: 'references',

  addOptions() {
    return {
      references: [],
    };
  },

  addAttributes() {
    return {
      refNum: {
        default: null,
        parseHTML: element => element.getAttribute('data-ref-num'),
        renderHTML: attributes => {
          if (!attributes.refNum) {
            return {};
          }
          return {
            'data-ref-num': attributes.refNum,
          };
        },
      },
      refTitle: {
        default: null,
        parseHTML: element => element.getAttribute('data-ref-title'),
        renderHTML: attributes => {
          if (!attributes.refTitle) {
            return {};
          }
          return {
            'data-ref-title': attributes.refTitle,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-ref-num]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const refNum = HTMLAttributes.refNum;
    const refTitle = HTMLAttributes.refTitle;
    const refId = `ref-${refNum}`;

    return [
      'a',
      {
        ...HTMLAttributes,
        href: `#${refId}`,
        class: 'text-blue-600 hover:text-blue-800 hover:underline cursor-pointer',
        title: refTitle?.replace(/"/g, '&quot;') || '',
        'data-ref-num': refNum,
        'data-ref-title': refTitle,
        onclick: `event.preventDefault(); document.getElementById('${refId}')?.scrollIntoView({behavior: 'smooth', block: 'center'}); return false;`,
      },
      0,
    ];
  },

  // Conversion Markdown vers HTML: détecter [1], [2] et les transformer en liens
  addProseMirrorPlugins() {
    return [
      {
        key: 'parseReferences',
        props: {
          handleText: (view: any, pos: number, text: string) => {
            // Cette approche nécessite de post-traiter le markdown avant qu'il ne soit rendu
            // Alternative: post-traiter dans EditableInput après rendu
            return false;
          },
        },
      } as any,
    ];
  },
});

