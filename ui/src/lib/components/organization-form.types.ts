export type OrgField =
  | 'name'
  | 'industry'
  | 'size'
  | 'technologies'
  | 'products'
  | 'processes'
  | 'challenges'
  | 'objectives'
  | 'kpis';

export type OnFieldUpdate = (field: OrgField, value: string) => void;
export type OnFieldSaved = (field: OrgField, value: string) => void;
export type GetFieldPayload = (field: OrgField) => Record<string, unknown> | null | undefined;
export type GetFieldOriginal = (field: OrgField) => string;

