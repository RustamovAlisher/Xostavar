import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { branches, roles, userBranches, users } from '../../../entities/index.js';

export type UserRow = typeof users.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type UserBranchLink = typeof userBranches.$inferSelect;
type UserInsert = typeof users.$inferInsert;

/** Bo'sh `inArray` bo'lmasin: hech qachon mos kelmaydigan id qo'shiladi (so'rov shakli o'zgarmaydi). */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Xodimlar, rollar va filial bog'lanishlari bo'yicha barcha SQL. Doira (scope) va huquq tekshiruvlari servisda.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ───────── Xodimlar: o'qish ───────── */

  /** O'chirilmagan xodimlar roli bilan, yaratilish tartibida. */
  listWithRoles(tx: DbOrTx = this.db) {
    return tx.select({ u: users, r: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(isNull(users.deletedAt)).orderBy(asc(users.createdAt));
  }

  findWithRole(id: string, tx: DbOrTx = this.db) {
    return tx
      .select({ u: users, r: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1)
      .then((r) => r[0] ?? null);
  }

  /** Bir nechta xodimning filial bog'lanishlari bitta so'rovda (ro'yxat uchun, N+1 yo'q). */
  branchLinksOf(userIds: string[], tx: DbOrTx = this.db): Promise<UserBranchLink[]> {
    return tx.select().from(userBranches).where(inArray(userBranches.userId, userIds.concat(NIL_UUID)));
  }

  branchLinksOfUser(userId: string, tx: DbOrTx = this.db): Promise<UserBranchLink[]> {
    return tx.select().from(userBranches).where(eq(userBranches.userId, userId));
  }

  /** Login (va berilgan bo'lsa email) bo'yicha dublikatlar, katta-kichik harf farqsiz; `exceptId` — o'zi hisobga olinmaydi. */
  findDuplicates(username: string, email: string | null, exceptId?: string, tx: DbOrTx = this.db) {
    const conds = [eq(sql`lower(${users.username})`, username.toLowerCase())];
    if (email) conds.push(eq(sql`lower(${users.email})`, email.toLowerCase()));
    return tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(sql`(${sql.join(conds, sql` or `)})`, exceptId ? ne(users.id, exceptId) : undefined, isNull(users.deletedAt)));
  }

  /** Faol, o'chirilmagan, `manage_users` huquqli xodimlar soni (TZ 3.3 (4)). */
  countActiveAdmins(tx: DbOrTx): Promise<number> {
    return tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.active, true), isNull(users.deletedAt), sql`'manage_users' = any(${users.permissions})`))
      .then((r) => r[0].n);
  }

  /* ───────── Xodimlar: yozish ───────── */

  insert(tx: DbOrTx, v: UserInsert): Promise<UserRow> {
    return tx.insert(users).values(v).returning().then((r) => r[0]);
  }

  update(id: string, v: Partial<UserInsert>, tx: DbOrTx = this.db) {
    return tx.update(users).set(v).where(eq(users.id, id));
  }

  /** Yumshoq o'chirish: login va email bo'shatiladi (keyin shu login bilan yangi xodim ochish mumkin). */
  softDelete(tx: DbOrTx, id: string, freedUsername: string) {
    return tx.update(users).set({ deletedAt: new Date(), active: false, username: freedUsername, email: null }).where(eq(users.id, id));
  }

  /* ───────── Filial bog'lanishlari ───────── */

  /** Berilgan id lardan bazada nechtasi bor. */
  countBranches(tx: DbOrTx, ids: string[]): Promise<number> {
    return tx.select({ id: branches.id }).from(branches).where(inArray(branches.id, ids)).then((r) => r.length);
  }

  deleteBranchLinks(tx: DbOrTx, userId: string) {
    return tx.delete(userBranches).where(eq(userBranches.userId, userId));
  }

  insertBranchLinks(tx: DbOrTx, links: { userId: string; branchId: string; isDefault: boolean }[]) {
    return tx.insert(userBranches).values(links);
  }

  /* ───────── Rollar ───────── */

  listRoles(tx: DbOrTx = this.db): Promise<RoleRow[]> {
    return tx.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.createdAt));
  }

  findRole(id: string, tx: DbOrTx = this.db): Promise<RoleRow | null> {
    return tx.select().from(roles).where(eq(roles.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  /** Nom bo'yicha (katta-kichik harf farqsiz) boshqa rol bormi. */
  findRoleByName(name: string, exceptId?: string, tx: DbOrTx = this.db) {
    return tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(sql`lower(${roles.name})`, name.toLowerCase()), exceptId ? ne(roles.id, exceptId) : undefined))
      .limit(1)
      .then((r) => r[0] ?? null);
  }

  insertRole(v: { name: string; permissions: string[]; allBranches: boolean }, tx: DbOrTx = this.db): Promise<RoleRow> {
    return tx.insert(roles).values(v).returning().then((r) => r[0]);
  }

  updateRole(id: string, v: { name: string; permissions: string[]; allBranches: boolean; version: number }, tx: DbOrTx = this.db): Promise<RoleRow> {
    return tx.update(roles).set(v).where(eq(roles.id, id)).returning().then((r) => r[0]);
  }

  /** Roldagi xodimlar: faol (o'chirilmagan) va o'chirilganlar soni. */
  roleUsage(roleId: string, tx: DbOrTx = this.db) {
    return tx
      .select({ n: sql<number>`count(case when ${users.deletedAt} is null then 1 end)::int`, deleted: sql<number>`count(case when ${users.deletedAt} is not null then 1 end)::int` })
      .from(users)
      .where(eq(users.roleId, roleId))
      .then((r) => r[0]);
  }

  /** O'chirilgan xodimlarni o'tkazish uchun standart (all_branches bo'lmagan, tartibda birinchi) rol. */
  fallbackRole(exceptId: string, tx: DbOrTx = this.db) {
    return tx.select({ id: roles.id }).from(roles).where(and(ne(roles.id, exceptId), eq(roles.allBranches, false))).orderBy(asc(roles.sortOrder)).limit(1).then((r) => r[0] ?? null);
  }

  reassignDeletedUsers(fromRoleId: string, toRoleId: string, tx: DbOrTx = this.db) {
    return tx.update(users).set({ roleId: toRoleId }).where(and(eq(users.roleId, fromRoleId), sql`${users.deletedAt} is not null`));
  }

  deleteRole(id: string, tx: DbOrTx = this.db) {
    return tx.delete(roles).where(eq(roles.id, id));
  }
}
