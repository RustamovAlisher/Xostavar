import type { RoleRow, UserBranchLink, UserRow } from '../repositories/users.repository.js';

export interface UserView {
  id: string;
  name: string;
  username: string;
  email: string | null;
  phone: string | null;
  roleId: string;
  role: string;
  permissions: string[];
  active: boolean;
  mustChangePassword: boolean;
  allBranches: boolean;
  branchIds: string[];
  defaultBranchId: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  version: number;
}

/** Xodim javobi: parol hashi chiqarilmaydi; rol nomi va filial ro'yxati qo'shiladi. */
export function toUserView(u: UserRow, r: RoleRow, links: UserBranchLink[]): UserView {
  return {
    id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone, roleId: r.id, role: r.name,
    permissions: u.permissions, active: u.active, mustChangePassword: u.mustChangePassword, allBranches: r.allBranches,
    branchIds: links.map((l) => l.branchId), defaultBranchId: links.find((l) => l.isDefault)?.branchId ?? links[0]?.branchId ?? null,
    lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, version: u.version,
  };
}

/** Ro'yxat: bog'lanishlar xodim bo'yicha guruhlanadi (2 ta so'rov natijasi birlashtiriladi). */
export function toUserList(rows: { u: UserRow; r: RoleRow }[], links: UserBranchLink[]): UserView[] {
  const byUser = new Map<string, UserBranchLink[]>();
  for (const l of links) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);
  return rows.map((r) => toUserView(r.u, r.r, byUser.get(r.u.id) ?? []));
}
