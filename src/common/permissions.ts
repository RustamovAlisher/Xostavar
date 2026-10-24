/** Frontend `Permission` bilan bir xil kodlar (TZ 3.2). */
export const PERMISSIONS = [
  'view_pos',
  'view_inventory',
  'view_analytics',
  'view_debts',
  'view_audit_logs',
  'view_users',
  'add_product',
  'edit_product',
  'delete_product',
  'stock_in',
  'give_debt',
  'view_cost_price',
  'view_expenses',
  'manage_expenses',
  'manage_users',
  'manage_branches',
  'manage_settings',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Faqat `all_branches` roliga beriladigan huquqlar (TZ 3.3 (9)). */
export const OWNER_ONLY: Permission[] = ['manage_branches', 'manage_settings'];

export const isPermission = (s: string): s is Permission => (PERMISSIONS as readonly string[]).includes(s);
