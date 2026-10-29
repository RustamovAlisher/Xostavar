import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, forbidden, isForeignKeyViolation, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { OWNER_ONLY, type Permission } from '../../../common/constants/permissions.js';
import { assertVersion } from '../../../common/utils/version.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { AuthService } from '../../auth/services/auth.service.js';
import type { CreateUserDto, ResetPasswordDto, RoleDto, SetBranchesDto, SetPermissionsDto, UpdateUserDto } from '../dto/users.dto.js';
import { toUserList, toUserView, type UserView } from '../mappers/users.mapper.js';
import { UsersRepository, type RoleRow } from '../repositories/users.repository.js';

export type { UserView } from '../mappers/users.mapper.js';

/**
 * Xodimlar va rollar (TZ 3.3, 7.1, 8.12).
 * Filial doirasidagi admin (biriktirilgan filiali bor + manage_users) faqat o'z filiali xodimlarini boshqaradi.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: UsersRepository,
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
    const r = await this.repo.findRole(roleId);
    if (!r) throw notFound('Rol');
    return r;
  }

  /** Filial admini egaga xos rolni (manage_branches/manage_settings yoki all_branches) bera olmaydi. */
  private assertRoleAllowed(actor: AuthUser, role: RoleRow) {
    if (actor.allBranches) return;
    if (role.allBranches || role.permissions.some((p) => OWNER_ONLY.includes(p as Permission))) {
      throw forbidden('Bu rolni faqat bosh admin bera oladi');
    }
  }

  /* ───────── O'qish ───────── */

  /** Ro'yxat 2 ta so'rov: xodimlar (rol bilan) + barcha filial bog'lanishlari — N+1 yo'q. */
  async list(actor: AuthUser): Promise<UserView[]> {
    const scope = this.scopeOf(actor);
    const rows = await this.repo.listWithRoles();
    const links = await this.repo.branchLinksOf(rows.map((r) => r.u.id));
    const views = toUserList(rows, links);
    // Filial admini faqat o'z filiali xodimlarini ko'radi (egasi va boshqa filial xodimlari ko'rinmaydi)
    return scope ? views.filter((v) => !v.allBranches && v.branchIds.includes(scope)) : views;
  }

  async get(actor: AuthUser, id: string): Promise<UserView> {
    const v = await this.getRaw(id);
    this.assertInScope(actor, v);
    return v;
  }

  private async getRaw(id: string): Promise<UserView> {
    const row = await this.repo.findWithRole(id);
    if (!row) throw notFound('Xodim');
    const links = await this.repo.branchLinksOfUser(id);
    return toUserView(row.u, row.r, links);
  }

  private assertInScope(actor: AuthUser, target: UserView) {
    const scope = this.scopeOf(actor);
    if (!scope) return;
    if (target.allBranches || !target.branchIds.includes(scope)) throw forbidden("Faqat o'z filialingiz xodimlarini boshqara olasiz");
  }

  /* ───────── Yozish ───────── */

  private async assertUnique(username: string, email: string | null, exceptId?: string) {
    const dup = await this.repo.findDuplicates(username, email, exceptId);
    if (dup.length) {
      const sameLogin = dup.some((d) => d.username.toLowerCase() === username.toLowerCase());
      throw conflict('duplicate_code', sameLogin ? 'Bu login band' : 'Bu email band');
    }
  }

  /** Kamida bitta faol `manage_users` qolishi shart (TZ 3.3 (4)). Tranzaksiya ichida chaqiriladi. */
  private async assertAdminRemains(tx: DbOrTx) {
    const n = await this.repo.countActiveAdmins(tx);
    if (n === 0) throw conflict('last_admin', 'Kamida bitta faol administrator (xodimlarni boshqarish huquqi) qolishi kerak');
  }

  private async setBranchesTx(tx: DbOrTx, userId: string, branchIds: string[], defaultBranchId?: string) {
    const ids = [...new Set(branchIds)];
    if (ids.length) {
      const found = await this.repo.countBranches(tx, ids);
      if (found !== ids.length) throw notFound('Filial');
    }
    await this.repo.deleteBranchLinks(tx, userId);
    if (ids.length) {
      const def = defaultBranchId && ids.includes(defaultBranchId) ? defaultBranchId : ids[0];
      await this.repo.insertBranchLinks(tx, ids.map((branchId) => ({ userId, branchId, isDefault: branchId === def })));
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

    const view = await runTx(this.db, async (tx) => {
      const u = await this.repo.insert(tx, { name: dto.name.trim(), username: dto.username.trim().toLowerCase(), email, phone: dto.phone?.trim() || null, roleId: role.id, permissions, passwordHash: hash, active: dto.active ?? true });
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

    await runTx(this.db, async (tx) => {
      await this.repo.update(id, {
        name: dto.name?.trim() ?? old.name, username, email, phone: dto.phone !== undefined ? dto.phone.trim() || null : old.phone,
        roleId: role.id, permissions, active, version: old.version + 1,
        ...(hash ? { passwordHash: hash } : {}),
      }, tx);
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
    await runTx(this.db, async (tx) => {
      await this.repo.update(id, { permissions, version: old.version + 1 }, tx);
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
    await runTx(this.db, async (tx) => {
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
    await runTx(this.db, async (tx) => {
      await this.repo.update(id, { active, version: old.version + 1 }, tx);
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
    await this.repo.update(id, { passwordHash: await AuthService.hash(dto.password) });
    await this.auth.revokeUserSessions([id]);
    await this.audit.log(actor, { action: 'password_reset', module: 'Xodimlar', targetId: id, targetName: old.name, details: 'Parol tiklandi (vaqtinchalik)' });
  }

  /** Yumshoq o'chirish (TZ 8.11): audit va cheklardagi ismlar saqlanadi. */
  async remove(actor: AuthUser, id: string) {
    if (id === actor.id) throw forbidden("O'z akkauntingizni o'chira olmaysiz", 'self_action_forbidden');
    const old = await this.getRaw(id);
    this.assertInScope(actor, old);
    await runTx(this.db, async (tx) => {
      // Login va email bo'shatiladi: keyin shu login bilan yangi xodim ochish mumkin
      await this.repo.softDelete(tx, id, `${old.username}#del#${Date.now()}`);
      await this.repo.deleteBranchLinks(tx, id);
      await this.assertAdminRemains(tx);
      await this.audit.log(actor, { action: 'delete', module: 'Xodimlar', targetId: id, targetName: old.name, details: "Xodim o'chirildi" }, tx);
    });
    await this.auth.revokeUserSessions([id]);
  }

  /* ───────── Rollar ───────── */

  listRoles() {
    return this.repo.listRoles();
  }

  async createRole(actor: AuthUser, dto: RoleDto) {
    this.assertRolePerms(dto);
    const dup = await this.repo.findRoleByName(dto.name.trim());
    if (dup) throw conflict('duplicate_code', 'Bu nomli rol allaqachon bor');
    const r = await this.repo.insertRole({ name: dto.name.trim(), permissions: dto.permissions, allBranches: dto.allBranches ?? false });
    await this.audit.log(actor, { action: 'add', module: 'Sozlamalar', targetId: r.id, targetName: r.name, details: `Yangi rol, ${r.permissions.length} ta huquq` });
    return r;
  }

  async updateRole(actor: AuthUser, id: string, dto: RoleDto) {
    const old = await this.roleOrThrow(id);
    assertVersion(old.version, dto.version, 'Rol');
    this.assertRolePerms(dto);
    const dup = await this.repo.findRoleByName(dto.name.trim(), id);
    if (dup) throw conflict('duplicate_code', 'Bu nomli rol allaqachon bor');
    const r = await this.repo.updateRole(id, { name: dto.name.trim(), permissions: dto.permissions, allBranches: dto.allBranches ?? old.allBranches, version: old.version + 1 });
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
    // Hammasi bitta tranzaksiyada: tekshiruv va o'chirish orasida shu rolda xodim yaratilsa FK xatosi (500) o'rniga 409 qaytadi
    await runTx(this.db, async (tx) => {
      const { n, deleted } = await this.repo.roleUsage(id, tx);
      if (n > 0) throw conflict('in_use', `${n} ta xodim shu rolda`, { users: n });
      if (deleted > 0) {
        // O'chirilgan xodimlar tarix uchun saqlanadi — ularni standart "Kassir" roliga o'tkazib, rolni o'chiramiz
        const fallback = await this.repo.fallbackRole(id, tx);
        if (!fallback) throw conflict('in_use', "O'chirilgan xodimlar shu rolga bog'langan");
        await this.repo.reassignDeletedUsers(id, fallback.id, tx);
      }
      try {
        await this.repo.deleteRole(id, tx);
      } catch (e) {
        if (isForeignKeyViolation(e)) throw conflict('in_use', 'Shu rolda xodim bor');
        throw e;
      }
      await this.audit.log(actor, { action: 'delete', module: 'Sozlamalar', targetId: id, targetName: r.name, details: "Rol o'chirildi" }, tx);
    });
  }
}
