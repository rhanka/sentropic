/** Supported view modes */
export type ViewMode = 'container' | 'detail';

/** A single action button descriptor */
export type ViewAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: any; // Lucide icon component
};

/** Column descriptor for container list/card views */
export type ViewColumn = {
  key: string;
  label: string;
  sortable?: boolean;
};

/** Card props for container view items */
export type CardProps = {
  title: string;
  subtitle?: string;
  icon?: any;
  iconColorClass?: string;
  badges?: Array<{ label: string; colorClass?: string }>;
  href?: string;
  onClick?: () => void;
};

/** View template descriptor */
export type ViewTemplateDescriptor = {
  mode: ViewMode;
  title?: string;
  subtitle?: string;
  columns?: ViewColumn[];
  items?: any[];
  actions?: ViewAction[];
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
  groupKey?: string;
  emptyMessage?: string;
  loading?: boolean;
  /** Card renderer: maps each item to card props */
  cardRenderer?: (item: any) => CardProps;
};
