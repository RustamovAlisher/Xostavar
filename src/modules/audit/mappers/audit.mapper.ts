import { page, type Page, type PageQuery } from '../../../common/utils/pagination.js';
import type { AuditLogRow } from '../repositories/audit.repository.js';

export type AuditPage = Page<AuditLogRow> & { facets: { byAction: Record<string, number> } };

/** Sahifa + amal turlari bo'yicha sonlar (frontend filtr chiplari uchun). */
export function toAuditPage(items: AuditLogRow[], total: number, q: Pick<PageQuery, 'page' | 'pageSize'>, facets: { action: string; n: number }[]): AuditPage {
  return { ...page(items, total, q), facets: { byAction: Object.fromEntries(facets.map((f) => [f.action, f.n])) } };
}
