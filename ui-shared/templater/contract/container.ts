/** Client-only family (a). Functions stay functions: never store this in the API. */
export type DsIconName = string;
export type DsTone = 'neutral' | 'category1' | 'category2' | 'category3' |
  'category4' | 'category5' | 'category6' | 'category7' | 'category8';
export type Callback = () => void | Promise<void>;
export type ViewAction = {
  label: string; href?: string; onClick?: Callback;
  variant?: 'primary' | 'secondary' | 'ghost'; icon?: DsIconName;
};
export type CardProps = {
  title: string; subtitle?: string; icon?: DsIconName; iconTone?: DsTone;
  badges?: Array<{ label: string; tone?: DsTone }>;
  href?: string; onClick?: Callback;
};
export type ViewColumn = { key: string; label: string; sortable?: boolean };
export type ViewFileMenu = {
  showNew?: boolean; showImport?: boolean; showExport?: boolean;
  showPrint?: boolean; showDelete?: boolean;
  onNew?: Callback; onImport?: Callback; onExport?: Callback;
  onPrint?: Callback; onDelete?: Callback;
};
export type ViewTemplateDescriptor<Item> = {
  mode: 'container' | 'detail'; title?: string; subtitle?: string;
  columns?: ViewColumn[]; items?: Item[]; actions?: ViewAction[];
  sortKey?: string; sortDirection?: 'asc' | 'desc'; groupKey?: string;
  emptyMessage?: string; loading?: boolean;
  cardRenderer?: (item: Item) => CardProps;
  fileMenu?: ViewFileMenu; headerOnly?: boolean;
};

export type Navigate = (href: string) => void | Promise<void>;

/** Anchors win over callbacks, as in ContainerView.svelte:195-245. */
export function activate(target: Pick<CardProps, 'href' | 'onClick'>, navigate: Navigate) {
  return target.href ? navigate(target.href) : target.onClick?.();
}

const menuBindings = {
  new: ['showNew', 'onNew'], import: ['showImport', 'onImport'],
  export: ['showExport', 'onExport'], print: ['showPrint', 'onPrint'],
  delete: ['showDelete', 'onDelete'],
} as const;
export type FileMenuAction = keyof typeof menuBindings;

/** Explicitly hidden actions must not dispatch, including keyboard dispatch. */
export function dispatchFileMenu(menu: ViewFileMenu, action: FileMenuAction) {
  const [visible, callback] = menuBindings[action];
  if (menu[visible]) return menu[callback]?.();
}

/** A renderer maps data to DS props; it never returns HTML or a component. */
export function cardFor<Item extends { name?: string; title?: string; description?: string; subtitle?: string }>(
  descriptor: ViewTemplateDescriptor<Item>, item: Item,
): CardProps {
  return descriptor.cardRenderer?.(item) ?? {
    title: item.name ?? item.title ?? 'Untitled',
    subtitle: item.description ?? item.subtitle,
  };
}
