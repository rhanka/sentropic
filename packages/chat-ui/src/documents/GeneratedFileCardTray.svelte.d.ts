import type { Component } from 'svelte';
import type { ChatGeneratedFileCard } from './types.js';

export type GeneratedFileCardTrayProps = {
  /** The generated file cards to render. */
  cards: ChatGeneratedFileCard[];
  /** Download callback — host implements the actual download logic. */
  onDownload?: (card: ChatGeneratedFileCard) => void;
  /** Label for the download button. Defaults to 'Download'. */
  downloadLabel?: string;
};

declare const GeneratedFileCardTray: Component<GeneratedFileCardTrayProps>;

export default GeneratedFileCardTray;
