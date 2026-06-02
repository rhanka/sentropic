import { describe, expect, it } from 'vitest';
import {
    MissingTokenError,
    defaultRenderer,
    extractTokens,
    substitute,
} from '../src/templating/index.js';

describe('substitute', () => {
    it('replaces a single token', () => {
        expect(substitute('Hello {{name}}!', { name: 'world' })).toBe('Hello world!');
    });

    it('replaces multiple distinct tokens and repeated occurrences', () => {
        const out = substitute('{{a}}-{{b}}-{{a}}', { a: 'x', b: 'y' });
        expect(out).toBe('x-y-x');
    });

    it('tolerates whitespace inside the marker', () => {
        expect(substitute('{{  name  }}', { name: 'ok' })).toBe('ok');
    });

    it('substitutes into both content and slug-style strings', () => {
        expect(substitute('apps/{{slug}}/package.json', { slug: 'demo' })).toBe(
            'apps/demo/package.json',
        );
    });

    it('leaves text without markers untouched', () => {
        expect(substitute('no tokens here', {})).toBe('no tokens here');
    });

    it('throws MissingTokenError listing every missing token, sorted and de-duplicated', () => {
        try {
            substitute('{{z}} {{a}} {{z}} {{m}}', {});
            throw new Error('expected MissingTokenError');
        } catch (err) {
            expect(err).toBeInstanceOf(MissingTokenError);
            expect((err as MissingTokenError).tokens).toEqual(['a', 'm', 'z']);
        }
    });

    it('does not treat a provided-but-empty token as missing', () => {
        expect(substitute('[{{x}}]', { x: '' })).toBe('[]');
    });

    it('inserts replacement values verbatim without re-scanning them', () => {
        // A value that itself looks like a marker must NOT be expanded further.
        const out = substitute('{{wrapper}}', { wrapper: '{{inner}}' });
        expect(out).toBe('{{inner}}');
    });

    it('is idempotent: re-rendering already-rendered content is a no-op', () => {
        const tokens = { name: 'demo', port: '9211' };
        const once = substitute('{{name}}:{{port}}', tokens);
        const twice = substitute(once, tokens);
        expect(twice).toBe(once);
    });

    it('is deterministic across repeated runs with identical input', () => {
        const template = 'svc-{{name}} on {{port}} ({{name}})';
        const tokens = { name: 'alpha', port: '5411' };
        const a = substitute(template, tokens);
        const b = substitute(template, tokens);
        expect(a).toBe(b);
        expect(a).toBe('svc-alpha on 5411 (alpha)');
    });
});

describe('extractTokens', () => {
    it('returns sorted, de-duplicated token identifiers', () => {
        expect(extractTokens('{{b}} {{a}} {{b}} {{c}}')).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty list for marker-free templates', () => {
        expect(extractTokens('plain text')).toEqual([]);
    });
});

describe('defaultRenderer (R5 interface seam)', () => {
    it('delegates to substitute', () => {
        expect(defaultRenderer.render('{{k}}', { k: 'v' })).toBe('v');
    });
});
