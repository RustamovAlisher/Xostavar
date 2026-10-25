import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { auditLogs } from '../../../entities/index.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { page, type Page, type PageQuery } from '../../../common/utils/pagination.js';

export type AuditAction =
  | 'add' | 'edit' | 'delete' | 'stock_in' | 'stock_adjust' | 'sale' | 'sale_void' | 'debt_payment' | 'user_update'
  | 'shift_open' | 'shift_close' | 'expense' | 'settings_reset' | 'password_reset' | 'login_failed';
export type AuditModule = 'Mahsulotlar' | 'Kassa' | 'Nasiya / Qarz' | 'Xodimlar' | 'Filiallar' | 'Sozlamalar' | 'Xarajatlar' | 'Xavfsizlik';

export interface AuditEntry {
  action: AuditAction;
  module: AuditModule;
  targetId?: string | null;
  targetName: string;
  details?: string;
  diff?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  /** Umumiy amal (sozlamalar, katalog) uchun null; filialga tegishli amalda filial id. */
  branchId?: string | null;
  ip?: string | null;
  requestId?: string | null;
}

export interface AuditQuery extends PageQuery {
  module?: string;
  action?: string;
  userId?: string;
  branchId?: string;
  q?: string;
  from?: string;
  to?: string;
}

/** Audit yozuvi biznes tranzaksiyasi bilan bir tranzaksiyada yoziladi (`tx` uzatiladi, TZ 11). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Jadvalga yozadi va shu voqeani info darajasida ilova logiga ham chiqaradi (kim, nima, qayerda, requestId). */
  async log(actor: Pick<AuthUser, 'id' | 'name' | 'roleName'> | null, e: AuditEntry, tx: DbOrTx = this.db) {
    this.logger.log(`${e.module}/${e.action} "${e.targetName}" user=${actor?.name ?? 'Tizim'}${e.branchId ? ` branch=${e.branchId}` : ''}${e.requestId ? ` requestId=${e.requestId}` : ''}${e.details ? `: ${e.details.slice(0, 200)}` : ''}`);
    await tx.insert(auditLogs).values({
      userId: actor?.id ?? null,
      userName: actor?.name ?? 'Tizim',
      userRole: actor?.roleName ?? '',
      action: e.action,
      module: e.module,
      targetId: e.targetId ?? null,
      targetName: e.targetName,
      details: e.details ?? '',
      diff: e.diff ?? null,
      branchId: e.branchId ?? null,
      ip: e.ip ?? null,
      requestId: e.requestId ?? null,
    });
  }

  /**
   * TZ 9.10: filialga biriktirilgan xodim faqat o'z filiali yozuvlarini ko'radi (branch_id bo'sh yozuvlar ham ko'rsatilmaydi).
   * Ro'yxat + jami + amal turlari bo'yicha sonlar — 3 ta so'rov, qator soniga bog'liq emas.
   */
  async list(user: AuthUser, q: AuditQuery): Promise<Page<typeof auditLogs.$inferSelect> & { facets: { byAction: Record<string, number> } }> {
    const where: SQL[] = [];
    if (!user.allBranches) {
      where.push(eq(auditLogs.branchId, user.defaultBranchId ?? ''));
    } else if (q.branchId && q.branchId !== 'all') {
      where.push(q.branchId === 'none' ? isNull(auditLogs.branchId) : eq(auditLogs.branchId, q.branchId));
    }
    if (q.module) where.push(eq(auditLogs.module, q.module));
    if (q.action) where.push(eq(auditLogs.action, q.action));
    if (q.userId) where.push(eq(auditLogs.userId, q.userId));
    if (q.from) where.push(gte(auditLogs.ts, new Date(q.from)));
    if (q.to) where.push(lte(auditLogs.ts, new Date(q.to + 'T23:59:59.999Z')));
    if (q.q) {
      const like = `%${q.q.trim()}%`;
      where.push(or(ilike(auditLogs.targetName, like), ilike(auditLogs.userName, like), ilike(auditLogs.details, like))!);
    }
    const cond = where.length ? and(...where) : undefined;

    const [items, [{ total }], facets] = await Promise.all([
      this.db.select().from(auditLogs).where(cond).orderBy(desc(auditLogs.ts)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(cond),
      this.db.select({ action: auditLogs.action, n: sql<number>`count(*)::int` }).from(auditLogs).where(cond).groupBy(auditLogs.action),
    ]);
    return { ...page(items, total, q), facets: { byAction: Object.fromEntries(facets.map((f) => [f.action, f.n])) } };
  }
}
