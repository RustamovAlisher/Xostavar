import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../db/db.module.js';
import { branches, roles, userBranches, users } from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { OWNER_ONLY, type Permission } from '../../common/permissions.js';
import { assertVersion } from '../../common/version.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { CreateUserDto, ResetPasswordDto, RoleDto, SetBranchesDto, SetPermissionsDto, UpdateUserDto } from './users.dto.js';

type UserRow = typeof users.$inferSelect;

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

/**
 * Xodimlar va rollar (TZ 3.3, 7.1, 8.12).
 * Filial doirasidagi admin (biriktirilgan filiali bor + manage_users) faqat o'z filiali xodimlarini boshqaradi.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /* ───────── Doira (scope) yordamchilari ───────── */

  /** Filial admini doirasi: null = cheklanmagan (egasi). */
  private scopeOf(actor: AuthUser): string | null {
    return actor.allBranches ? null : (actor.defaultBranchId ?? actor.branchIds[0] ?? null);
  }

  /** Filial admini bera oladigan huquqlar: o'zida borlari, egaga xoslaridan tashqari (TZ 3.3 (8)). */
  private grantable(actor: AuthUser): Permission[] | null {
    if (actor.allBranches) return null;
    return actor.permissions.filter((p) => !OWNER_ONLY.includes(p));
  }

  /** So'ralgan huquqlardan ruxsat etilganlari; admin bera olmaydiganlari avvalgidek qoladi. */
  private mergePerms(actor: AuthUser, requested: Permission[], previous: string[] = []): string[] {
    const g = this.grantable(actor);
    if (!g) return [...new Set(requested)];
    const ok = new Set(g);
    return [...new Set([...previous.filter((p) => !ok.has(p as Permission)), ...requested.filter((p) => ok.has(p))])];
  }

  private async roleOrThrow(roleId: string) {
    const [r] = await this.db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!r) throw notFound('Rol');
    return r;
  }

  /** Filial admini egaga xos rolni (manage_branches/manage_settings yoki all_branches) bera olmaydi. */
  private assertRoleAllowed(actor: AuthUser, role: typeof roles.$inferSelect) {
    if (actor.allBranches) return;
    if (role.allBranches || role.permissions.some((p) => OWNER_ONLY.includes(p as Permission))) {
      throw forbidden('Bu rolni faqat bosh admin bera oladi');
    }
  }

  /* ───────── O'qish ───────── */

  /** Ro'yxat 2 ta so'rov: xodimlar (rol bilan) + barcha filial bog'lanishlari — N+1 yo'q. */
  async list(actor: AuthUser): Promise<UserView[]> {
    const scope = this.scopeOf(actor);
    const rows = await this.db
      .select({ u: users, r: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.createdAt));
    const links = await this.db.select().from(userBranches).where(inArray(userBranches.userId, rows.map((r) => r.u.id).concat('00000000-0000-0000-0000-000000000000')));
    const byUser = new Map<string, typeof links>();
    for (const l of links) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);
    const views = rows.map((r) => this.toView(r.u, r.r, byUser.get(r.u.id) ?? []));
    // Filial admini faqat o'z filiali xodimlarini ko'radi (egasi va boshqa filial xodimlari ko'rinmaydi)
    return scope ? views.filter((v) => !v.allBranches && v.branchIds.includes(scope)) : views;
  }

  async get(actor: AuthUser, id: string): Promise<UserView> {
    const v = await this.getRaw(id);
    this.assertInScope(actor, v);
    return v;
  }

  private async getRaw(id: string): Promise<UserView> {
    const [row] = await this.db.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    if (!row) throw notFound('Xodim');
    const links = await this.db.select().from(userBranches).where(eq(userBranches.userId, id));
    return this.toView(row.u, row.r, links);
  }

  private toView(u: UserRow, r: typeof roles.$inferSelect, links: (typeof userBranches.$inferSelect)[]): UserView {
    return {
      id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone, roleId: r.id, role: r.name,
      permissions: u.permissions, active: u.active, mustChangePassword: u.mustChangePassword, allBranches: r.allBranches,
      branchIds: links.map((l) => l.branchId), defaultBranchId: links.find((l) => l.isDefault)?.branchId ?? links[0]?.branchId ?? null,
      lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, version: u.version,
    };
  }

  private assertInScope(actor: AuthUser, target: UserView) {
    const scope = this.scopeOf(actor);
    if (!scope) return;
    if (target.allBranches || !target.branchIds.includes(scope)) throw forbidden("Faqat o'z filialingiz xodimlarini boshqara olasiz");
  }

  /* ───────── Yozish ───────── */

  private async assertUnique(username: string, email: string | null, exceptId?: string) {
    const conds = [eq(sql`lower(${users.username})`, username.toLowerCase())];
    if (email) conds.push(eq(sql`lower(${users.email})`, email.toLowerCase()));
    const dup = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(sql`(${sql.join(conds, sql` or `)})`, exceptId ? ne(users.id, exceptId) : undefined, isNull(users.deletedAt)));
    if (dup.length) {
      const sameLogin = dup.some((d) => d.username.toLowerCase() === username.toLowerCase());
      throw conflict('duplicate_code', sameLogin ? 'Bu login band' : 'Bu email band');
    }
  }

  /** Kamida bitta faol `manage_users` qolishi shart (TZ 3.3 (4)). Tranzaksiya ichida chaqiriladi. */
  private async assertAdminRemains(tx: DbOrTx) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.active, true), isNull(users.deletedAt), sql`'manage_users' = any(${users.permissions})`));
    if (n === 0) throw conflict('last_admin', 'Kamida bitta faol administrator (xodimlarni boshqarish huquqi) qolishi kerak');
  }

  private async setBranchesTx(tx: DbOrTx, userId: string, branchIds: string[], defaultBranchId?: string) {
    const ids = [...new Set(branchIds)];
    if (ids.length) {
      const found = await tx.select({ id: branches.id }).from(branches).where(inArray(branches.id, ids));
      if (found.length !== ids.length) throw notFound('Filial');
    }
    await tx.delete(userBranches).where(eq(userBranches.userId, userId));
    if (ids.length) {
      const def = defaultBranchId && ids.includes(defaultBranchId) ? defaultBranchId : ids[0];
      await tx.insert(userBranches).values(ids.map((branchId) => ({ userId, branchId, isDefault: branchId === def })));
    }
  }

  async create(actor: AuthUser, dto: CreateUserDto): Promise<UserView> {
    const role = await this.roleOrThrow(dto.roleId);
    this.assertRoleAllowed(actor, role);
    AuthService.checkPolicy(dto.password);
    const email = dto.email?.trim() || null;
    await this.assertUnique(dto.username, email);
    const scope = this.scopeOf(actor);
    const requested = (dto.permissions ?? (role.permissions as Permission[])) as Permission[];
    const permissions = this.mergePerms(actor, requested);
    // all_branches rolida filial biriktirilmaydi; filial admini faqat o'z filialiga biriktiradi
    const branchIds = role.allBranches ? [] : scope ? [scope] : (dto.branchIds ?? []);
    const hash = await AuthService.hash(dto.password);

    const view = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ name: dto.name.trim(), username: dto.username.trim().toLowerCase(), email, phone: dto.phone?.trim() || null, roleId: role.id, permissions, passwordHash: hash, mustChangePassword: true, active: dto.active ?? true })
        .returning();
      await this.setBranchesTx(tx, u.id, branchIds, dto.defaultBranchId);
      await this.audit.log(actor, { action: 'add', module: 'Xodimlar', targetId: u.id, targetName: u.name, details: `Yangi xodim (${role.name})` }, tx);
      return u.id;
    });
    return this.getRaw(view);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto): Promise<UserView> {
    const old = await this.getRaw(id);
    this.assertInScope(actor, old);
    assertVersion(old.version, dto.version, 'Xodim');
    const isSelf = id === actor.id;
    const scope = this.scopeOf(actor);

    let role = await this.roleOrThrow(dto.roleId ?? old.roleId);
    if (dto.roleId && dto.roleId !== old.roleId) this.assertRoleAllowed(actor, role);
    const username = dto.username?.trim().toLowerCase() ?? old.username;
    const email = dto.email !== undefined ? dto.email.trim() || null : old.email;
    if (username !== old.username || email !== old.email) await this.assertUnique(username, email, id);

    // O'z huquqi va holatini o'zgartira olmaydi (TZ 3.3 (3))
    let permissions = old.permissions;
    if (!isSelf && dto.roleId && dto.roleId !== old.roleId && dto.resetPermissionsToRole) {
      permissions = this.mergePerms(actor, role.permissions as Permission[], old.permissions);
    }
    const active = isSelf ? old.active : (dto.active ?? old.active);
    if (dto.password) AuthService.checkPolicy(dto.password);
    const hash = dto.password ? await AuthService.hash(dto.password) : undefined;

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          name: dto.name?.trim() ?? old.name, username, email, phone: dto.phone !== undefined ? dto.phone.trim() || null : old.phone,
          roleId: role.id, permissions, active, version: old.version + 1,
          ...(hash ? { passwordHash: hash, mustChangePassword: !isSelf } : {}),
        })
        .where(eq(users.id, id));
      // Filiallar: filial admini o'zgartira olmaydi (majburan o'z filiali); egasi — so'rovdagi ro'yxat
      if (!scope && (dto.branchIds || role.allBranches !== old.allBranches)) {
        await this.setBranchesTx(tx, id, role.allBranches ? [] : (dto.branchIds ?? old.branchIds), dto.defaultBranchId);
      }
      await this.assertAdminRemains(tx);
      await this.audit.log(actor, {
        action: 'user_update', module: 'Xodimlar', targetId: id, targetName: dto.name?.trim() ?? old.name,
        details: `Profil tahrirlandi${dto.password ? ', parol almashtirildi' : ''}`,
        diff: { before: { rol: old.role, login: old.username, email: old.email }, after: { rol: role.name, login: username, email } },
      }, tx);
    });
    if (!active || dto.password) await this.auth.revokeUserSessions([id]);
    this.auth.invalidate(id);
    return this.getRaw(id);
  }

  async setPermissions(actor: AuthUser, id: string, dto: SetPermissionsDto): Promise<UserView> {
    if (id === actor.id) throw forbidden("O'z huquqlaringizni o'zgartira olmaysiz", 'self_action_forbidden');
    const old = await this.getRaw(id);
    this.assertInScope(actor, old);
    const permissions = this.mergePerms(actor, dto.permissions, old.permissions);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ permissions, version: old.version + 1 }).where(eq(users.id, id));
      await this.assertAdminRemains(tx);
      await this.audit.log(actor, {
        action: 'user_update', module: 'Xodimlar', targetId: id, targetName: old.name, details: `Huquqlar yangilandi: ${permissions.length} ta`,
        diff: { before: { huquqlar: old.permissions.join(', ') }, after: { huquqlar: permissions.join(', ') } },
      }, tx);
    });
    this.auth.invalidate(id);
    return this.getRaw(id);
  }

  async setBranches(actor: AuthUser, id: string, dto: SetBranchesDto): Promise<UserView> {
    const old = await this.getRaw(id);
    this.assertInScope(actor, old);
    if (old.allBranches) throw unprocessable('validation_failed', 'Barcha filiallarni ko\'ruvchi rolga filial biriktirilmaydi');
    const scope = this.scopeOf(actor);
    const ids = scope ? [scope] : dto.branchIds;
    await this.db.transaction(async (tx) => {
      await this.setBranchesTx(tx, id, ids, dto.defaultBranchId);
      await this.audit.log(actor, { action: 'user_update', module: 'Xodimlar', targetId: id, targetName: old.name, details: `Filiallar: ${ids.length} ta` }, tx);
    });
    this.auth.invalidate(id);
    return this.getRaw(id);
  }

  async toggleActive(actor: AuthUser, id: string): Promise<UserView> {
    if (id === actor.id) throw forbidden("O'z akkauntingizni nofaol qila olmaysiz", 'self_action_forbidden');
    const old = await this.getRaw(id);
    this.assertInScope(actor, old);
    const active = !old.active;
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ active, version: old.version + 1 }).where(eq(users.id, id));
      await this.assertAdminRemains(tx);
      await this.audit.log(actor, { action: 'user_update', module: 'Xodimlar', targetId: id, targetName: old.name, details: `Holat: ${active ? 'Faol' : 'Nofaol'}` }, tx);
    });
    if (!active) await this.auth.revokeUserSessions([id]);
    this.auth.invalidate(id);
    return this.getRaw(id);
  }

  async resetPassword(actor: AuthUser, id: string, dto: ResetPasswordDto) {
    const old = await this.getRaw(id);
    this.assertInScope(actor, old);
    AuthService.checkPolicy(dto.password);
    await this.db.update(users).set({ passwordHash: await AuthService.hash(dto.password), mustChangePassword: id !== actor.id }).where(eq(users.id, id));
    await this.auth.revokeUserSessions([id]);
    await this.audit.log(actor, { action: 'password_reset', module: 'Xodimlar', targetId: id, targetName: old.name, details: 'Parol tiklandi (vaqtinchalik)' });
  }

  /** Yumshoq o'chirish (TZ 8.11): audit va cheklardagi ismlar saqlanadi. */
  async remove(actor: AuthUser, id: string) {
    if (id === actor.id) throw forbidden("O'z akkauntingizni o'chira olmaysiz", 'self_action_forbidden');
    const old = await this.getRaw(id);
    this.assertInScope(actor, old);
    await this.db.transaction(async (tx) => {
      // Login va email bo'shatiladi: keyin shu login bilan yangi xodim ochish mumkin
      await tx.update(users).set({ deletedAt: new Date(), active: false, username: `${old.username}#del#${Date.now()}`, email: null }).where(eq(users.id, id));
      await tx.delete(userBranches).where(eq(userBranches.userId, id));
      await this.assertAdminRemains(tx);
      await this.audit.log(actor, { action: 'delete', module: 'Xodimlar', targetId: id, targetName: old.name, details: "Xodim o'chirildi" }, tx);
    });
    await this.auth.revokeUserSessions([id]);
  }

  /* ───────── Rollar ───────── */

  listRoles() {
    return this.db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.createdAt));
  }

  async createRole(actor: AuthUser, dto: RoleDto) {
    this.assertRolePerms(dto);
    const [dup] = await this.db.select({ id: roles.id }).from(roles).where(eq(sql`lower(${roles.name})`, dto.name.trim().toLowerCase())).limit(1);
    if (dup) throw conflict('duplicate_code', 'Bu nomli rol allaqachon bor');
    const [r] = await this.db.insert(roles).values({ name: dto.name.trim(), permissions: dto.permissions, allBranches: dto.allBranches ?? false }).returning();
    await this.audit.log(actor, { action: 'add', module: 'Sozlamalar', targetId: r.id, targetName: r.name, details: `Yangi rol, ${r.permissions.length} ta huquq` });
    return r;
  }

  async updateRole(actor: AuthUser, id: string, dto: RoleDto) {
    const old = await this.roleOrThrow(id);
    assertVersion(old.version, dto.version, 'Rol');
    this.assertRolePerms(dto);
    const [dup] = await this.db.select({ id: roles.id }).from(roles).where(and(eq(sql`lower(${roles.name})`, dto.name.trim().toLowerCase()), ne(roles.id, id))).limit(1);
    if (dup) throw conflict('duplicate_code', 'Bu nomli rol allaqachon bor');
    const [r] = await this.db.update(roles).set({ name: dto.name.trim(), permissions: dto.permissions, allBranches: dto.allBranches ?? old.allBranches, version: old.version + 1 }).where(eq(roles.id, id)).returning();
    // Rol shablonining o'zgarishi mavjud xodimlarga avtomatik qo'llanmaydi (TZ 7.1); nom o'zgarsa kesh yangilanadi
    this.auth.invalidate();
    await this.audit.log(actor, { action: 'edit', module: 'Sozlamalar', targetId: id, targetName: r.name, details: 'Rol tahrirlandi', diff: { before: { nomi: old.name, huquqlar: old.permissions.join(', ') }, after: { nomi: r.name, huquqlar: r.permissions.join(', ') } } });
    return r;
  }

  /** TZ 3.3 (9): manage_branches/manage_settings faqat all_branches rolida. */
  private assertRolePerms(dto: RoleDto) {
    if (!dto.allBranches && dto.permissions.some((p) => OWNER_ONLY.includes(p))) {
      throw unprocessable('validation_failed', 'Filiallar va sozlamalarni boshqarish huquqi faqat "barcha filiallar" roliga beriladi');
    }
  }

  async deleteRole(actor: AuthUser, id: string) {
    const r = await this.roleOrThrow(id);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.roleId, id), isNull(users.deletedAt)));
    if (n > 0) throw conflict('in_use', `${n} ta xodim shu rolda`, { users: n });
    await this.db.delete(roles).where(eq(roles.id, id));
    await this.audit.log(actor, { action: 'delete', module: 'Sozlamalar', targetId: id, targetName: r.name, details: "Rol o'chirildi" });
  }
}
