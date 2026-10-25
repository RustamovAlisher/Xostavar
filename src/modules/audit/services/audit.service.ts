import { Injectable, Logger } from '@nestjs/common';
import type { DbOrTx } from '../../../db/db.module.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import type { PageQuery } from '../../../common/utils/pagination.js';
import { toAuditPage, type AuditPage } from '../mappers/audit.mapper.js';
import { AuditRepository } from '../repositories/audit.repository.js';

export type { AuditPage } from '../mappers/audit.mapper.js';
export type { AuditLogRow } from '../repositories/audit.repository.js';

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

  constructor(private readonly repo: AuditRepository) {}

  /** Jadvalga yozadi va shu voqeani info darajasida ilova logiga ham chiqaradi (kim, nima, qayerda, requestId). */
  async log(actor: Pick<AuthUser, 'id' | 'name' | 'roleName'> | null, e: AuditEntry, tx?: DbOrTx) {
    this.logger.log(`${e.module}/${e.action} "${e.targetName}" user=${actor?.name ?? 'Tizim'}${e.branchId ? ` branch=${e.branchId}` : ''}${e.requestId ? ` requestId=${e.requestId}` : ''}${e.details ? `: ${e.details.slice(0, 200)}` : ''}`);
    await this.repo.insert({
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
    }, tx);
  }

  /**
   * TZ 9.10: filialga biriktirilgan xodim faqat o'z filiali yozuvlarini ko'radi (branch_id bo'sh yozuvlar ham ko'rsatilmaydi).
   * Ro'yxat + jami + amal turlari bo'yicha sonlar — 3 ta so'rov, qator soniga bog'liq emas.
   */
  async list(user: AuthUser, q: AuditQuery): Promise<AuditPage> {
    // Filial cheklovi: xodim — faqat o'z filiali; egasi — so'ralgan filial ('none' = filialsiz yozuvlar, 'all'/bo'sh = hammasi)
    const branchId = !user.allBranches ? (user.defaultBranchId ?? '') : q.branchId && q.branchId !== 'all' ? (q.branchId === 'none' ? null : q.branchId) : undefined;
    const [items, total, facets] = await this.repo.list({ branchId, module: q.module, action: q.action, userId: q.userId, from: q.from, to: q.to, q: q.q }, q);
    return toAuditPage(items, total, q, facets);
  }
}
