/**
 * image-lightbox.dom.spec.ts — DOM/ARIA tests for @sentropic/chat-ui documents/ImageLightbox.
 *
 * Tests: closed when image=null, overlay+img render, Escape/backdrop/close-button
 * call onClose, download link attributes. Fake-host harness: zero sentropic strings.
 *
 * Environment: jsdom via vitest.config.ts (test-chat-ui-dom target).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImageLightbox from '../src/documents/ImageLightbox.svelte';

afterEach(() => cleanup());

const IMAGE = { src: 'https://example.test/photo.png', alt: 'photo.png' };

describe('ImageLightbox — visibility', () => {
  it('should render nothing when image is null', () => {
    const { container } = render(ImageLightbox, { props: { image: null } });
    expect(container.querySelector('[data-testid="chat-image-lightbox"]')).toBeNull();
  });

  it('should render the overlay and the image when image is set', () => {
    const { container } = render(ImageLightbox, { props: { image: IMAGE } });
    expect(container.querySelector('[data-testid="chat-image-lightbox"]')).not.toBeNull();
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(IMAGE.src);
    expect(img?.getAttribute('alt')).toBe(IMAGE.alt);
  });
});

describe('ImageLightbox — close interactions', () => {
  it('should call onClose on Escape keydown', async () => {
    const onClose = vi.fn();
    render(ImageLightbox, { props: { image: IMAGE, onClose } });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should NOT call onClose on Escape when already closed', async () => {
    const onClose = vi.fn();
    render(ImageLightbox, { props: { image: null, onClose } });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should NOT call onClose on a non-Escape key', async () => {
    const onClose = vi.fn();
    render(ImageLightbox, { props: { image: IMAGE, onClose } });
    await fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should call onClose when the backdrop or the close button is clicked', async () => {
    const onClose = vi.fn();
    render(ImageLightbox, { props: { image: IMAGE, onClose } });
    // Backdrop and the X button both carry the close label (default 'Close').
    const closeControls = screen.getAllByRole('button', { name: 'Close' });
    expect(closeControls.length).toBe(2);
    await fireEvent.click(closeControls[0]);
    await fireEvent.click(closeControls[1]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('should honor a custom closeLabel', () => {
    render(ImageLightbox, {
      props: { image: IMAGE, closeLabel: 'Dismiss' },
    });
    expect(screen.getAllByRole('button', { name: 'Dismiss' }).length).toBe(2);
  });
});

describe('ImageLightbox — download link', () => {
  it('should render a download link pointing at the image src', () => {
    render(ImageLightbox, { props: { image: IMAGE } });
    const link = screen.getByRole('link', { name: 'Download' });
    expect(link.getAttribute('href')).toBe(IMAGE.src);
    expect(link.getAttribute('download')).toBe(IMAGE.alt);
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
