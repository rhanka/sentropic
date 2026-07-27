import type { ChatPlacement } from './chatPlacement.js';

export type ChatPlacementContainerContext = {
  dialogClass?: string;
  dockWidthCss?: string;
};

type ChatPlacementContainerResult = {
  className: string;
  style: string;
};

const appendDialogClass = (base: string, dialogClass?: string): string =>
  dialogClass ? `${base} ${dialogClass}` : base;

export function placementContainerClasses(
  placement: ChatPlacement,
  ctx: ChatPlacementContainerContext = {},
): ChatPlacementContainerResult {
  const dialogClass = ctx.dialogClass;
  const dockWidthCss = ctx.dockWidthCss ?? '0px';

  switch (placement.kind) {
    case 'drawer':
      return {
        className: appendDialogClass(
          placement.side === 'left'
            ? 'chat-dock-shell fixed top-0 left-0 bottom-0 z-50 bg-white border-r border-gray-200 flex flex-col'
            : 'chat-dock-shell fixed top-0 right-0 bottom-0 z-50 bg-white border-l border-gray-200 flex flex-col',
          dialogClass,
        ),
        style: `width: ${dockWidthCss};`,
      };
    case 'floating':
      if (placement.anchor === 'left') {
        return { className: appendDialogClass(
          'chat-dock-shell fixed inset-x-0 bottom-0 z-50 bg-white shadow-2xl border border-gray-200 flex flex-col h-[85dvh] max-h-[calc(100dvh-1rem)] rounded-t-xl sm:fixed sm:inset-auto sm:bottom-4 sm:left-4 sm:h-[70vh] sm:max-h-[calc(100vh-2rem)] sm:w-[28rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-lg',
          dialogClass), style: '' };
      }
      if (placement.anchor === 'center') {
        return { className: appendDialogClass(
          'chat-dock-shell fixed inset-x-0 bottom-0 z-50 bg-white shadow-2xl border border-gray-200 flex flex-col h-[85dvh] max-h-[calc(100dvh-1rem)] rounded-t-xl sm:fixed sm:inset-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:h-[70vh] sm:max-h-[calc(100vh-2rem)] sm:w-[28rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-lg',
          dialogClass), style: '' };
      }
      return {
        className: appendDialogClass(
          'chat-dock-shell fixed inset-x-0 bottom-0 z-50 bg-white shadow-2xl border border-gray-200 flex flex-col h-[85dvh] max-h-[calc(100dvh-1rem)] rounded-t-xl sm:fixed sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[70vh] sm:max-h-[calc(100vh-2rem)] sm:w-[28rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-lg',
          dialogClass,
        ),
        style: '',
      };
    case 'full':
      return { className: appendDialogClass('chat-dock-shell fixed inset-0 z-50 bg-white flex flex-col', dialogClass), style: '' };
    default:
      throw new Error(`Unhandled ChatPlacement kind: ${JSON.stringify(placement)}`);
  }
}
