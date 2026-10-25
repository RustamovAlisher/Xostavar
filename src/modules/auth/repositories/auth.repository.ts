import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import { branches, loginAttempts, roles, sessions, userBranches, users } from '../../../entities/index.js';

export type UserRow = typeof users.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
/** Xodimning filial bog'lanishi + filial faolligi (login va guard uchun). */
export type UserBranchRow = { branchId: string; isDefault: boolean; active: boolean };

/**
 * Autentifikatsiya SQL'i: foydalanuvchi+rol, filiallar, sessiyalar, kirish urinishlari.
 * Kesh, token va hash — servisda; bu yerda faqat so'rovlar.
 */
@Injectable()
export class AuthRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Bir nechta yozuvni bitta tranzaksiyada (deadlock bo'lsa qayta urinish bilan). */
  runInTx<T>(fn: (tx: DbOrTx) => Promise<T>) {
    return runTx(this.db, fn);
  }

  /* ───────── Foydalanuvchi ───────── */

  /** O'chirilmagan foydalanuvchi + roli (faollik servisda tekshiriladi). */
  findUserWithRole(userId: string, tx: DbOrTx = this.db) {
    return tx
      .select({ u: users, r: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1)
      .then((r) => r[0] ?? null);
  }

  /** Login yoki email bo'yicha (katta-kichik harf farqsiz), o'chirilmaganlar ichidan. */
  findUserByLogin(key: string, tx: DbOrTx = this.db) {
    return tx
      .select({ u: users, r: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(or(eq(sql`lower(${users.username})`, key), eq(sql`lower(${users.email})`, key)), isNull(users.deletedAt)))
      .limit(1)
      .then((r) => r[0] ?? null);
  }

  /** Biriktirilgan filiallar va ularning faolligi (1 ta so'rov, N+1 yo'q). */
  userBranches(userId: string, tx: DbOrTx = this.db): Promise<UserBranchRow[]> {
    return tx
      .select({ branchId: userBranches.branchId, isDefault: userBranches.isDefault, active: branches.active })
      .from(userBranches)
      .innerJoin(branches, eq(branches.id, userBranches.branchId))
      .where(eq(userBranches.userId, userId));
  }

  touchLastLogin(userId: string, tx: DbOrTx = this.db) {
    return tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  }

  passwordHashOf(userId: string, tx: DbOrTx = this.db) {
    return tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1).then((r) => r[0]?.hash ?? null);
  }

  /** O'z parolini almashtirdi — vaqtinchalik parol belgisi olib tashlanadi. */
  setPassword(userId: string, passwordHash: string, tx: DbOrTx = this.db) {
    return tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, userId));
  }

  /* ───────── Kirish urinishlari (TZ 6.2) ───────── */

  /** `since` dan beri xato urinishlar: shu login bo'yicha va shu IP bo'yicha (bitta so'rov). */
  countFailedAttempts(login: string, ip: string | undefined, since: Date, tx: DbOrTx = this.db) {
    return tx
      .select({
        byLogin: sql<number>`count(case when ${loginAttempts.login} = ${login} then 1 end)::int`,
        byIp: sql<number>`count(case when ${loginAttempts.ip} = ${ip ?? null}::inet then 1 end)::int`,
      })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)))
      .then((r) => r[0]);
  }

  insertAttempt(v: { login: string; ip: string | null; success: boolean }, tx: DbOrTx = this.db) {
    return tx.insert(loginAttempts).values(v);
  }

  /** Eski urinishlarni tozalash (jadval o'smasin). */
  purgeAttemptsBefore(before: Date, tx: DbOrTx = this.db) {
    return tx.delete(loginAttempts).where(lt(loginAttempts.createdAt, before));
  }

  /* ───────── Sessiyalar ───────── */

  insertSession(v: { userId: string; familyId: string; refreshHash: string; userAgent: string | null; ip: string | null; expiresAt: Date }, tx: DbOrTx = this.db) {
    return tx.insert(sessions).values(v).returning({ id: sessions.id }).then((r) => r[0].id);
  }

  findSessionState(sessionId: string, tx: DbOrTx = this.db) {
    return tx.select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, sessionId)).limit(1).then((r) => r[0] ?? null);
  }

  findSessionByHash(refreshHash: string, tx: DbOrTx = this.db): Promise<SessionRow | null> {
    return tx.select().from(sessions).where(eq(sessions.refreshHash, refreshHash)).limit(1).then((r) => r[0] ?? null);
  }

  /** Oiladagi barcha tirik sessiyalar bekor (refresh token qayta ishlatilganda). */
  revokeFamily(familyId: string, tx: DbOrTx = this.db) {
    return tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  /** Faqat tirik sessiyani bekor qiladi; bekor qilingan qatorlar soni (0 — allaqachon bekor edi, ya'ni parallel/qayta ishlatish). */
  revokeIfAlive(sessionId: string, tx: DbOrTx = this.db) {
    return tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt))).returning({ id: sessions.id }).then((r) => r.length);
  }

  revokeAllOfUser(userId: string, tx: DbOrTx = this.db) {
    return tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  revokeAllOfUsers(userIds: string[], tx: DbOrTx = this.db) {
    return tx.update(sessions).set({ revokedAt: new Date() }).where(and(inArray(sessions.userId, userIds), isNull(sessions.revokedAt)));
  }

  /** Joriy qurilmadan tashqari hammasi (parol almashtirilganda). */
  revokeOthersOfUser(userId: string, keepSessionId: string, tx: DbOrTx = this.db) {
    return tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.id} <> ${keepSessionId}`));
  }

  /** Faqat o'ziniki bo'lsa bekor qiladi (boshqa foydalanuvchi sessiyasini yopib bo'lmaydi). */
  revokeOwned(userId: string, sessionId: string, tx: DbOrTx = this.db) {
    return tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  }

  listAlive(userId: string, tx: DbOrTx = this.db) {
    return tx
      .select({ id: sessions.id, userAgent: sessions.userAgent, ip: sessions.ip, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  }
}
