import type { ExpenseRow } from '../repositories/expenses.repository.js';

export type ExpenseListRow = { e: ExpenseRow; category: string; method: string };
export type ExpenseCategorySum = { categoryId: string; name: string; sum: number };
export type ExpenseSums = { sum: number; fromRegister: number };

/** Ro'yxat elementi: xarajat + kategoriya va to'lov usuli nomi (frontend jadvali uchun). */
export const toExpenseItem = (r: ExpenseListRow) => ({ ...r.e, category: r.category, method: r.method });

export type ExpenseItem = ReturnType<typeof toExpenseItem>;

/** Ro'yxat jamlari: umumiy, kassadan, kategoriya bo'yicha (TZ 9.12). */
export const toExpenseSummary = (sums: ExpenseSums, byCategory: ExpenseCategorySum[]) => ({ sum: sums.sum, fromRegister: sums.fromRegister, byCategory });
