import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '../constants/permissions.js';

/** Guard har so'rovda to'ldiradi: kim, qaysi huquqlar, qaysi filiallar, joriy filial. */
export interface AuthUser {
  id: string;
  name: string;
  username: string;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  /** Egasi — barcha filiallar. */
  allBranches: boolean;
  /** Biriktirilgan filiallar (allBranches bo'lsa bo'sh bo'lishi mumkin). */
  branchIds: string[];
  defaultBranchId: string | null;
  mustChangePassword: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  /** X-Branch-Id yoki standart filial — BranchGuard qo'yadi. */
  branchId?: string;
  sessionId?: string;
}

export const PERMS_KEY = 'perms';
export const PUBLIC_KEY = 'public';
export const BRANCH_KEY = 'branch';

/** Endpoint kerakli huquqlar: bittasi bo'lsa yetadi (OR). Hammasi kerak bo'lsa `{ all: true }`. */
export const Perms = (...perms: Permission[]) => SetMetadata(PERMS_KEY, { perms, all: false });
export const PermsAll = (...perms: Permission[]) => SetMetadata(PERMS_KEY, { perms, all: true });
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Endpoint filial kontekstini talab qiladi (X-Branch-Id yoki standart filial). */
export const BranchScoped = () => SetMetadata(BRANCH_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthRequest>().user!;
});
export const BranchId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<AuthRequest>().branchId!;
});
export const Req = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthRequest => ctx.switchToHttp().getRequest<AuthRequest>());

/** pino-http beradigan so'rov id si (X-Request-Id). */
export const requestIdOf = (req: Request): string | undefined => {
  const id = (req as { id?: unknown }).id;
  return id == null ? undefined : String(id);
};

export const hasPerm = (u: Pick<AuthUser, 'permissions'>, p: Permission) => u.permissions.includes(p);
