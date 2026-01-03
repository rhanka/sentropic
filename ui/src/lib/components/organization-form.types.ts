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


