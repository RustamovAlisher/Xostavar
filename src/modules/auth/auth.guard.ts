import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module.js';
import { branches } from '../../db/schema/index.js';
import { BRANCH_KEY, PERMS_KEY, PUBLIC_KEY, type AuthRequest } from '../../common/auth-context.js';
import { forbidden, unauthorized } from '../../common/errors.js';
import type { Permission } from '../../common/permissions.js';
import { AuthService } from './auth.service.js';

/**
 * Bitta global guard: token → foydalanuvchi → huquq → filial konteksti.
 * Tartib muhim: filial tekshiruvi huquqdan keyin, shunda 403 sabablari aniq.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw unauthorized();
    const payload = await this.auth.verifyAccess(token);
    const user = await this.auth.loadUser(payload.sub);
    if (!user) throw unauthorized('Akkaunt faol emas yoki o\'chirilgan');
    req.user = user;
    req.sessionId = payload.sid;

    // Vaqtinchalik parol bilan faqat parolni almashtirish va chiqish mumkin
    if (user.mustChangePassword && !req.path.startsWith('/api/v1/auth/')) {
      throw forbidden('Avval parolingizni almashtiring (POST /auth/change-password)');
    }

    const meta = this.reflector.getAllAndOverride<{ perms: Permission[]; all: boolean } | undefined>(PERMS_KEY, targets);
    if (meta?.perms.length) {
      const ok = meta.all ? meta.perms.every((p) => user.permissions.includes(p)) : meta.perms.some((p) => user.permissions.includes(p));
      if (!ok) throw forbidden();
    }

    // Filial konteksti (TZ 5, 8.12): X-Branch-Id → standart filial → (egasi uchun) birinchi faol filial.
    // Har doim aniqlanadi (katalog ham joriy filial qoldig'ini qaytaradi); @BranchScoped endpointda majburiy.
    const scoped = this.reflector.getAllAndOverride<boolean>(BRANCH_KEY, targets);
    const requested = (req.headers['x-branch-id'] as string | undefined)?.trim();
    let branchId = requested || user.defaultBranchId || undefined;
    if (!branchId && user.allBranches) {
      const [first] = await this.db.select({ id: branches.id }).from(branches).where(eq(branches.active, true)).orderBy(branches.createdAt).limit(1);
      branchId = first?.id;
    }
    if (!branchId) {
      if (scoped) throw forbidden(user.allBranches ? "Faol filial yo'q" : 'Sizga filial biriktirilmagan', 'branch_forbidden');
      return true;
    }
    if (!user.allBranches && !user.branchIds.includes(branchId)) throw forbidden("Bu filialga kirish huquqingiz yo'q", 'branch_forbidden');
    if (requested || scoped) {
      const [b] = await this.db.select({ active: branches.active }).from(branches).where(eq(branches.id, branchId)).limit(1);
      if (!b) throw forbidden('Filial topilmadi', 'branch_forbidden');
      if (!b.active) throw forbidden('Filial nofaol', 'branch_inactive');
    }
    req.branchId = branchId;
    return true;
  }
}
