import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { auditLogs } from '../../../entities/index.js';

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type AuditLogInsert = typeof auditLogs.$inferInsert;

/** Ro'yxat filtri (huquq bo'yicha filial cheklovi servisda hal qilinib, shu yerga tayyor keladi). */
export interface AuditFilter {
  /** `undefined` — filtr yo'q; `null` — faqat filialsiz (umumiy) yozuvlar; aks holda shu filial. */
  branchId?: string | null;
  module?: string;
  action?: string;
  userId?: string;
  from?: string;
  to?: string;
  q?: string;
}

/** Audit jadvali bo'yicha barcha SQL: yozish (chaqiruvchi tranzaksiyasida) va ro'yxat. */
@Injectable()
export class AuditRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  insert(v: AuditLogInsert, tx: DbOrTx = this.db) {
    return tx.insert(auditLogs).values(v);
  }

  /** Ro'yxat + jami + amal turlari bo'yicha sonlar — 3 ta so'rov, qator soniga bog'liq emas. */
  list(f: AuditFilter, q: { pageSize: number; offset: number }, tx: DbOrTx = this.db) {
    const where: SQL[] = [];
    if (f.branchId !== undefined) where.push(f.branchId === null ? isNull(auditLogs.branchId) : eq(auditLogs.branchId, f.branchId));
    if (f.module) where.push(eq(auditLogs.module, f.module));
    if (f.action) where.push(eq(auditLogs.action, f.action));
    if (f.userId) where.push(eq(auditLogs.userId, f.userId));
    if (f.from) where.push(gte(auditLogs.ts, new Date(f.from)));
    if (f.to) where.push(lte(auditLogs.ts, new Date(f.to + 'T23:59:59.999Z')));
    if (f.q) {
      const like = `%${f.q.trim()}%`;
      where.push(or(ilike(auditLogs.targetName, like), ilike(auditLogs.userName, like), ilike(auditLogs.details, like))!);
    }
    const cond = where.length ? and(...where) : undefined;
    return Promise.all([
      tx.select().from(auditLogs).where(cond).orderBy(desc(auditLogs.ts)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(cond).then((r) => r[0].total),
      tx.select({ action: auditLogs.action, n: sql<number>`count(*)::int` }).from(auditLogs).where(cond).groupBy(auditLogs.action),
    ]);
  }
}
