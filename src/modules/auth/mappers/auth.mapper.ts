import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { isPermission, type Permission } from '../../../common/constants/permissions.js';
import type { RoleRow, UserBranchRow, UserRow } from '../repositories/auth.repository.js';

/**
 * So'rov konteksti (guard) uchun foydalanuvchi: faqat ro'yxatdagi (haqiqiy) huquqlar qoldiriladi,
 * standart filial — `isDefault` belgilangani, bo'lmasa birinchisi.
 */
export function toAuthUser(u: UserRow, r: RoleRow, ub: UserBranchRow[]): AuthUser {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    roleId: r.id,
    roleName: r.name,
    permissions: u.permissions.filter(isPermission) as Permission[],
    allBranches: r.allBranches,
    branchIds: ub.map((b) => b.branchId),
    defaultBranchId: ub.find((b) => b.isDefault)?.branchId ?? ub[0]?.branchId ?? null,
    mustChangePassword: u.mustChangePassword,
  };
}
