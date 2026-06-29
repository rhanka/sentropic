import type { DrawingSkill } from '../types';
import { mermaidParse } from './parse';
import { MERMAID_KEYWORDS } from './precheck';

export const mermaidSkill: DrawingSkill = {
  formatId: 'mermaid',
  name: 'mermaid-generation',
  description: 'Generate valid Mermaid diagram source from a natural-language request.',
  systemPrompt: [
    'You generate Mermaid diagram source code.',
    `Always return a single valid Mermaid document that starts with a diagram keyword (one of: ${MERMAID_KEYWORDS.join(', ')}).`,
    'Prefer "flowchart TD" unless the request clearly implies another diagram type.',
    'Never wrap the output in markdown code fences. Keep node ids stable, short, and meaningful',
    '(they are used to anchor user annotations).',
  ].join(' '),
  examples: [
    {
      prompt: 'a simple login flow',
      source: 'flowchart TD\n  User[User] --> Login[Login]\n  Login --> Auth{Auth ok?}\n  Auth -- yes --> Home[Home]\n  Auth -- no --> Login',
    },
  ],
  validate: mermaidParse,
};
