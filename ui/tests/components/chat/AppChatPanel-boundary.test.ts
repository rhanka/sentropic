import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelPath = resolve(process.cwd(), 'src/lib/components/ChatPanel.svelte');
const appPanelPath = resolve(
  process.cwd(),
  'src/lib/components/chat/AppChatPanel.svelte',
);

describe('AppChatPanel boundary', () => {
  it('keeps public ChatPanel as a thin wrapper over the app implementation', () => {
    expect(existsSync(appPanelPath)).toBe(true);
    const source = readFileSync(panelPath, 'utf8');
    expect(source).toContain(
      "import PackageChatPanel from '@sentropic/chat-ui/components/ChatPanel.svelte'",
    );
    expect(source).toContain(
      "import AppChatPanel from '$lib/components/chat/AppChatPanel.svelte'",
    );
    expect(source).toContain('<PackageChatPanel');
    expect(source).toContain('renderShell={renderAppChatPanelShell}');
    expect(source).toContain('<AppChatPanel');
    expect(source).toContain('export const focusComposer');
    expect(source).not.toContain("import { apiFetch");
    expect(source).not.toContain('const sendMessage = async');
  });

  it('wires host-managed image attachments from composer to chat message payloads', () => {
    const source = readFileSync(appPanelPath, 'utf8');
    expect(source).toContain("@sentropic/chat-ui/state/chatAttachments");
    expect(source).toContain('let composerAttachments');
    expect(source).toContain('handleComposerPaste');
    expect(source).toContain('addGoogleDriveComposerAttachments');
    expect(source).toContain('payload.attachments');
    expect(source).toContain('kind: attachment.kind');
    // Attachments wired: sentAttachments captured into controller send factory
    // (capturedAttachments = sentAttachments, then buildUserMessage uses capturedAttachments)
    expect(source).toContain('capturedAttachments = sentAttachments');
    expect(source).toContain('attachments: capturedAttachments');
  });

  it('renders a pending-only attachment band with click-to-enlarge, not a persistent session-doc band', () => {
    const source = readFileSync(appPanelPath, 'utf8');
    // Band items are now built via the @sentropic/chat-ui/documents helper and
    // rendered by the <AttachmentBand> module component (the data-testid
    // `chat-composer-attachment-band` now lives inside that component).
    expect(source).toContain('buildAttachmentBandItems');
    // Gold shell adoption (S6a): the band/lightbox/thumbnails markup renders
    // inside @sentropic/chat-ui ChatPanelShell; the host passes the band items
    // and lightbox wiring as props.
    expect(source).toContain('<ChatPanelShell');
    expect(source).toContain('attachmentBand={attachmentBand}');
    expect(source).toContain('openLightbox');
    // The image lightbox + per-message thumbnails now render via the
    // @sentropic/chat-ui/documents module components (the data-testid
    // `chat-image-lightbox` lives inside <ImageLightbox>; the per-message
    // grid lives inside <MessageAttachments>).
    expect(source).toContain('lightboxImage={lightboxImage}');
    expect(source).toContain('getAttachmentImageSrc');
    // Documents follow the same per-message model as images.
    expect(source).toContain('attachFileToComposer');
    // The separate bottom attachment tray is removed.
    expect(source).not.toContain('chat-composer-attachment-tray');
    // No persistent session-document merge in the composer band.
    expect(source).not.toContain('mergeAttachmentBand');
  });
});
