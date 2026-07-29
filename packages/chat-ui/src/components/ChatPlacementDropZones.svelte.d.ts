import type { Component } from 'svelte';
import type { ChatPlacement } from '../state/chatPlacement.js';
import type { DropZone } from '../state/chatPlacementDnd.js';

export type ChatPlacementDropZonesProps = {
  zones?: DropZone[];
  hovered?: ChatPlacement | null;
  labelForPlacement: (placement: ChatPlacement) => string;
};

declare const ChatPlacementDropZones: Component<ChatPlacementDropZonesProps>;

export default ChatPlacementDropZones;
