import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { ListItem } from '@tiptap/extension-list-item';
import { Heading } from '@tiptap/extension-heading';

/**
 * Extensions TipTap avec classes Tailwind pour aligner avec renderMarkdown
 * Ces extensions remplacent les versions par défaut du StarterKit
 */

// Extension pour BulletList avec classes Tailwind (aligné avec renderMarkdown)
export const BulletListWithClasses = BulletList.extend({
  renderHTML({ HTMLAttributes }) {
    return ['ul', { 
      ...HTMLAttributes, 
      class: 'list-disc space-y-2 mb-4', 
      style: 'padding-left:1.5rem;' 
    }, 0];
  },
});

// Extension pour OrderedList avec classes Tailwind (aligné avec renderMarkdown)
export const OrderedListWithClasses = OrderedList.extend({
  renderHTML({ HTMLAttributes }) {
    return ['ol', { 
      ...HTMLAttributes, 
      class: 'list-decimal space-y-2 mb-4', 
      style: 'padding-left:1.5rem;' 
    }, 0];
  },
});

// Extension pour ListItem avec classes Tailwind (aligné avec renderMarkdown)
export const ListItemWithClasses = ListItem.extend({
  renderHTML({ HTMLAttributes }) {
    return ['li', { ...HTMLAttributes, class: 'mb-1' }, 0];
  },
});

// Extension pour Heading avec classes Tailwind (aligné avec renderMarkdown)
export const HeadingWithClasses = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level;
    const classes = {
      1: 'text-2xl font-semibold text-slate-900 mt-8 mb-4',
      2: 'text-xl font-semibold text-slate-900 mt-6 mb-4',
      3: 'text-lg font-semibold text-slate-800 mt-4 mb-3',
      4: 'text-base font-semibold text-slate-800 mt-4 mb-2',
      5: 'text-sm font-semibold text-slate-700 mt-3 mb-2',
      6: 'text-xs font-semibold text-slate-700 mt-3 mb-1',
    };
    
    const classValue = classes[level as keyof typeof classes] || '';
    
    return [`h${level}`, { ...HTMLAttributes, class: classValue }, 0];
  },
});

