import type { Component, Snippet } from 'svelte';
import type { ChatWidgetDisplayMode } from '../stores/chatWidgetLayout.js';
import type { ChatWidgetHostMode } from '../state/chatWidgetShell.js';
import type { ChatPlacementMenu } from '../state/chatPlacementMenu.js';

export type ChatDockProps = {
  /** Current display mode (docked | floating). Host should persist changes via onDisplayModeChange. */
  displayMode?: ChatWidgetDisplayMode;
  /** Host mode: 'overlay' (default) or 'sidepanel'. */
  hostMode?: ChatWidgetHostMode;
  /** True when running inside a Chrome extension overlay — forces floating mode. */
  isExtensionOverlayHost?: boolean;
  /** True when the dock should start open. Sidepanel host sets this automatically. */
  initialOpen?: boolean;
  /**
   * When true the dialog container renders overflow-visible instead of overflow-hidden.
   * Set to true when a popover menu must extend outside the dialog bounds.
   */
  contentOverflowVisible?: boolean;
  /** Inline style string for the outer container div. */
  containerStyle?: string;
  /** Override the dialog element id. */
  dialogId?: string;
  /** aria-label for the dialog element. */
  dialogAriaLabel?: string;
  /** Whether the browser context is available (guards localStorage/window access). */
  isBrowser?: boolean;
  /**
   * Optional headless placement menu (surfaces L1c-menu). It drives the dialog
   * container's placement ONLY where it can legitimately own it — see
   * `canChatPlacementMenuOwnPlacement`: a sidepanel host, a Chrome extension
   * overlay and a mobile viewport all force their own mode and ignore the menu.
   * Undefined (default) = zero change. ChatDock renders NO trigger/popup UI
   * for this menu — mount ChatPlacementMenuButton separately (e.g. in the
   * host's own header toolbar) driven by the same menu instance.
   */
  placementMenu?: ChatPlacementMenu;
  /**
   * Renders the floating bubble trigger button.
   * Receives { toggle: () => void; isOpen: boolean }.
   * Not rendered in sidepanel host mode.
   */
  renderBubble?: Snippet<[{ toggle: () => void; isOpen: boolean }]>;
  /**
   * Renders the dialog body (header + panels).
   * Receives { isDocked: boolean; isMobileViewport: boolean }.
   */
  renderContent?: Snippet<[{ isDocked: boolean; isMobileViewport: boolean }]>;
  /** Called when the dock closes. In sidepanel mode, host should call window.close(). */
  onClose?: () => void;
  /**
   * Overrides the built-in dialog keydown handler.
   * Use to supply custom Tab cycling (e.g. composer → session menu).
   * If undefined, ChatDock uses its own Escape + Tab cycle handler.
   */
  onDialogKeyDown?: (e: KeyboardEvent) => void;
  /** Called when open/close state changes. */
  onOpenChange?: (isOpen: boolean) => void;
  /** Called when displayMode changes so the host can persist to localStorage. */
  onDisplayModeChange?: (mode: ChatWidgetDisplayMode) => void;
  /**
   * Bindable: the dialog container element.
   * Bind to access for custom keyboard handling or position measurements.
   */
  dialogEl?: HTMLDivElement | null;
  /**
   * Bindable: the bubble button element.
   * Bind if the host needs to restore focus to it explicitly.
   */
  bubbleButtonEl?: HTMLButtonElement | null;
  /** Bindable: current open state. */
  isOpen?: boolean;
  /**
   * Bindable: true when the dock renders as a side panel. Derived from the
   * effective placement when a menu owns it (a drawer placement is docked),
   * otherwise from the legacy `effectiveMode === 'docked'`.
   */
  isDocked?: boolean;
  /** Bindable: true when the viewport is ≤639px (mobile bottom-sheet mode). */
  isMobileViewportBound?: boolean;
  /**
   * Extra CSS class(es) appended to the outer container div.
   * Use to add app-specific classes needed for existing CSS rules.
   */
  containerClass?: string;
  /**
   * Extra CSS class(es) appended to the dialog container div.
   * Use to add app-specific classes (e.g. 'topai-chat-widget-shell') for
   * existing CSS rules (e.g. vscode dark mode overrides in app.css).
   */
  dialogClass?: string;
};

export type ChatDockInstance = {
  toggle: () => Promise<void>;
  open: () => Promise<void>;
  close: () => void;
};

/**
 * ChatDock — generic dock surface (floating widget or docked sidebar panel).
 *
 * Encapsulates: displayMode, open/close/toggle, mobile bottom-sheet + scroll-lock,
 * resize tracking, chatWidgetLayout publication, Ctrl+Shift+K shortcut, base focus trap.
 *
 * App-specific concerns (bubble badge, tabs, extension settings, sessions) are injected
 * via renderBubble / renderContent snippets.
 *
 * sentropic's ChatWidget consumes ChatDock with ZERO UX change.
 */
declare const ChatDock: Component<ChatDockProps, ChatDockInstance>;

export default ChatDock;
