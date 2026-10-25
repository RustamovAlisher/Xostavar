import { todayISO } from '../../../common/utils/numbers.js';
import type { CustomerRow } from '../repositories/customers.repository.js';

/** Frontend `CustomerDebt` bilan mos: `role` = guruh nomi, `totalDebtUZS`, `creditLimitUZS`. */
export interface CustomerView {
  id: string;
  name: string;
  phone: string;
  groupId: string | null;
  role: string;
  totalDebtUZS: number;
  creditLimitUZS: number;
  dueDate: string | null;
  lastPaidDate: string | null;
  overdue: boolean;
  version: number;
  createdAt: Date;
}

/** Mijoz qatori + guruh nomi → API ko'rinishi; `overdue` bugungi sanaga nisbatan hisoblanadi. */
export function toCustomerView(c: CustomerRow, groupName: string | null, today = todayISO()): CustomerView {
  return {
    id: c.id, name: c.name, phone: c.phone, groupId: c.groupId, role: groupName ?? '', totalDebtUZS: c.totalDebt, creditLimitUZS: c.creditLimit,
    dueDate: c.dueDate, lastPaidDate: c.lastPaidDate, overdue: c.totalDebt > 0 && !!c.dueDate && c.dueDate < today, version: c.version, createdAt: c.createdAt,
  };
}
