/**
 * message-attachments.dom.spec.ts — DOM/ARIA tests for @sentropic/chat-ui
 * documents/MessageAttachments.
 *
 * Tests: image thumbnails via host onResolveSrc (with previewUrl/url fallbacks),
 * placeholder when unresolvable, file download rows, onEnlarge wiring.
 * Fake-host harness: zero sentropic strings.
 *
 * Environment: jsdom via vitest.config.ts (test-chat-ui-dom target).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MessageAttachments from '../src/documents/MessageAttachments.svelte';
import type { ChatMessageAttachment } from '../src/state/chatProjection.js';

afterEach(() => cleanup());

const imageAttachment = (over: Partial<ChatMessageAttachment> = {}): ChatMessageAttachment => ({
  id: 'att_1',
  kind: 'image',
  fileName: 'photo.png',
  mimeType: 'image/png',
  documentId: 'doc_1',
  ...over,
});

const fileAttachment = (over: Partial<ChatMessageAttachment> = {}): ChatMessageAttachment => ({
  id: 'att_2',
  kind: 'file',
  fileName: 'report.pdf',
  mimeType: 'application/pdf',
  documentId: 'doc_2',
  ...over,
});

describe('MessageAttachments — rendering', () => {
  it('should render nothing for an empty attachment list', () => {
    const { container } = render(MessageAttachments, { props: { attachments: [] } });
    expect(container.querySelector('[data-testid="chat-message-attachments"]')).toBeNull();
  });

  it('should render an image thumbnail using the host onResolveSrc', () => {
    const onResolveSrc = vi.fn(() => 'https://example.test/dl/doc_1');
    const { container } = render(MessageAttachments, {
      props: { attachments: [imageAttachment()], onResolveSrc },
    });
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.test/dl/doc_1');
    expect(img?.getAttribute('alt')).toBe('photo.png');
    expect(onResolveSrc).toHaveBeenCalledOnce();
  });

  it('should fall back to previewUrl then url without onResolveSrc', () => {
    const { container } = render(MessageAttachments, {
      props: {
        attachments: [
          imageAttachment({ id: 'a', previewUrl: 'blob:preview' }),
          imageAttachment({ id: 'b', documentId: undefined, url: 'https://example.test/ext.png' }),
        ],
      },
    });
    const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['blob:preview', 'https://example.test/ext.png']);
  });

  it('should render a placeholder (no img) when the src is unresolvable', () => {
    const { container } = render(MessageAttachments, {
      props: { attachments: [imageAttachment({ documentId: undefined })] },
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('should render a file row as a download link', () => {
    const onResolveSrc = vi.fn(() => 'https://example.test/dl/doc_2');
    render(MessageAttachments, {
      props: { attachments: [fileAttachment()], onResolveSrc },
    });
    const link = screen.getByRole('link', { name: /report\.pdf/ });
    expect(link.getAttribute('href')).toBe('https://example.test/dl/doc_2');
    expect(link.getAttribute('download')).toBe('report.pdf');
  });
});

describe('MessageAttachments — enlarge wiring', () => {
  it('should call onEnlarge with (src, alt) when an image thumbnail is clicked', async () => {
    const onEnlarge = vi.fn();
    render(MessageAttachments, {
      props: {
        attachments: [imageAttachment({ previewUrl: 'blob:preview' })],
        onEnlarge,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Enlarge' }));
    expect(onEnlarge).toHaveBeenCalledWith('blob:preview', 'photo.png');
  });

  it('should honor a custom enlargeLabel', () => {
    render(MessageAttachments, {
      props: {
        attachments: [imageAttachment({ previewUrl: 'blob:preview' })],
        enlargeLabel: 'Zoom',
      },
    });
    expect(screen.getByRole('button', { name: 'Zoom' })).not.toBeNull();
  });
});
