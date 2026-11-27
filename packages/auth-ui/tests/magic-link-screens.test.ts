import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

import { createFrenchAuthUiLabels } from '../src/labels.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let renderLoginComponent: (props: Record<string, unknown>) => string;
let renderVerifyComponent: (props: Record<string, unknown>) => string;

const compileMagicLinkComponents = async (): Promise<{
  renderLogin: (props: Record<string, unknown>) => string;
  renderVerify: (props: Record<string, unknown>) => string;
}> => {
  const output = await build({
    stdin: {
      contents: `import { render } from 'svelte/server';
        import AuthLogin from './src/components/AuthLogin.svelte';
        import AuthMagicLinkVerify from './src/components/AuthMagicLinkVerify.svelte';
        export const renderLogin = props => render(AuthLogin, { props }).body;
        export const renderVerify = props => render(AuthMagicLinkVerify, { props }).body;`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    conditions: ['svelte', 'node'],
    plugins: [
      {
        name: 'svelte-server',
        setup(builder) {
          builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
            contents: compile(await readFile(path, 'utf8'), { filename: path, generate: 'server' }).js.code,
            resolveDir: dirname(path),
            loader: 'js',
          }));
        },
      },
    ],
  });
  const mod = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
  );
  return { renderLogin: mod.renderLogin, renderVerify: mod.renderVerify };
};

beforeAll(async () => {
  const compiled = await compileMagicLinkComponents();
  renderLoginComponent = compiled.renderLogin;
  renderVerifyComponent = compiled.renderVerify;
}, 60_000);

describe('AuthLogin magicLinkSignIn mode', () => {
  it('renders the primary magic-link email form in French without WebAuthn or 6-digit registration', () => {
    const labels = createFrenchAuthUiLabels();
    const html = renderLoginComponent({
      transport: {},
      labels,
      magicLinkSignIn: true,
      presetEmail: 'invitee@example.com',
      oauthContinuation: 'sealed-continue',
      onLoggedIn: () => undefined,
    });

    expect(html).toContain('Connexion par e-mail');
    expect(html).toContain('Recevoir un lien de connexion par e-mail');
    expect(html).toContain('invitee@example.com');
    expect(html).not.toContain('Se connecter avec WebAuthn');
    expect(html).not.toContain("S'inscrire");
  });

  it('keeps default passkey mode when magicLinkSignIn is false', () => {
    const labels = createFrenchAuthUiLabels();
    const html = renderLoginComponent({
      transport: {},
      labels,
      magicLinkSignIn: false,
      onLoggedIn: () => undefined,
    });

    expect(html).toContain('Connexion');
    expect(html).not.toContain('Recevoir un lien de connexion par e-mail');
  });
});

describe('AuthMagicLinkVerify one-click confirm guard', () => {
  it('exposes the one-click confirm button labels in French without verifying during mount/SSR', () => {
    const labels = createFrenchAuthUiLabels();
    const verifyMagicLink = vi.fn();
    const html = renderVerifyComponent({
      transport: { verifyMagicLink },
      labels,
      tokenSource: () => 'raw-token',
      onVerified: () => undefined,
    });

    expect(verifyMagicLink).not.toHaveBeenCalled();
    expect(labels.magicLinkConfirmTitle).toBe('Confirmer la connexion');
    expect(labels.magicLinkConfirmButton).toBe('Confirmer et se connecter');
    expect(html).toBeTypeOf('string');
  });
});
