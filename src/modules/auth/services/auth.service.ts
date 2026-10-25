import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DB, type Db } from '../../../db/db.module.js';
import { branches, loginAttempts, roles, sessions, userBranches, users } from '../../../entities/index.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { AppError, forbidden, unauthorized, unprocessable } from '../../../common/errors/app-error.js';
import { isPermission, type Permission } from '../../../common/constants/permissions.js';
import type { Env } from '../../../config/env.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { HttpStatus } from '@nestjs/common';

const MAX_FAILED = 5;
const MAX_FAILED_PER_IP = 30;
const LOCK_MINUTES = 15;
/** Foydalanuvchi ma'lumoti har so'rovda bazadan o'qilmasin: qisqa kesh (huquq o'zgarsa `invalidate`). */
const USER_CACHE_MS = 10_000;

export interface JwtPayload {
  sub: string;
  sid: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly cache = new Map<string, { at: number; user: AuthUser }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  /* ───────── Foydalanuvchini yuklash (guard uchun) ───────── */

  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
    this.sessionCache.clear();
  }

  /** 2 ta so'rov (user+role, filiallar) — N+1 yo'q, 10 s kesh. */
  async loadUser(userId: string): Promise<AuthUser | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.user;
    const [row] = await this.db
      .select({ u: users, r: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!row || !row.u.active) return null;
    const ub = row.r.allBranches
      ? []
      : await this.db
          .select({ branchId: userBranches.branchId, isDefault: userBranches.isDefault, active: branches.active })
          .from(userBranches)
          .innerJoin(branches, eq(branches.id, userBranches.branchId))
          .where(eq(userBranches.userId, userId));
    const user: AuthUser = {
      id: row.u.id,
      name: row.u.name,
      username: row.u.username,
      roleId: row.r.id,
      roleName: row.r.name,
      permissions: row.u.permissions.filter(isPermission) as Permission[],
      allBranches: row.r.allBranches,
      branchIds: ub.map((b) => b.branchId),
      defaultBranchId: ub.find((b) => b.isDefault)?.branchId ?? ub[0]?.branchId ?? null,
      mustChangePassword: row.u.mustChangePassword,
    };
    this.cache.set(userId, { at: Date.now(), user });
    return user;
  }

  /** Sessiya tirikmi (bekor qilinmagan, muddati o'tmagan). Qisqa kesh — har so'rovda bazaga bormaslik uchun. */
  private readonly sessionCache = new Map<string, { at: number; alive: boolean }>();
  async isSessionAlive(sessionId: string): Promise<boolean> {
    const hit = this.sessionCache.get(sessionId);
    if (hit && Date.now() - hit.at < 5_000 && hit.alive) return true;
    const [s] = await this.db.select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    const alive = !!s && !s.revokedAt && s.expiresAt > new Date();
    this.sessionCache.set(sessionId, { at: Date.now(), alive });
    return alive;
  }

  /* ───────── Login ───────── */

  async login(login: string, password: string, meta: { ip?: string; userAgent?: string; requestId?: string }) {
    const key = login.trim().toLowerCase();
    if (!key || !password) throw unauthorized('Login va parolni kiriting');

    // Bloklash (TZ 6.2): oxirgi 15 daqiqada shu login uchun 5 ta xato, yoki shu IP dan 30 ta xato
    // (do'konda hamma kassa bitta IP orqali chiqadi — bitta xato parol hammani bloklamasin)
    const since = new Date(Date.now() - LOCK_MINUTES * 60_000);
    const [{ byLogin, byIp }] = await this.db
      .select({
        byLogin: sql<number>`count(case when ${loginAttempts.login} = ${key} then 1 end)::int`,
        byIp: sql<number>`count(case when ${loginAttempts.ip} = ${meta.ip ?? null}::inet then 1 end)::int`,
      })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
    if (byLogin >= MAX_FAILED || byIp >= MAX_FAILED_PER_IP) {
      this.logger.warn(`Login bloklandi: login=${key} ip=${meta.ip ?? '-'} byLogin=${byLogin} byIp=${byIp}`);
      throw new AppError('rate_limited', `Juda ko'p urinish. ${LOCK_MINUTES} daqiqadan keyin qayta urinib ko'ring`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const [row] = await this.db
      .select({ u: users, r: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(or(eq(sql`lower(${users.username})`, key), eq(sql`lower(${users.email})`, key)), isNull(users.deletedAt)))
      .limit(1);

    const ok = row ? await argon2.verify(row.u.passwordHash, password) : false;
    await this.db.insert(loginAttempts).values({ login: key, ip: meta.ip ?? null, success: ok });
    if (Math.random() < 0.02) void this.db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(Date.now() - 86_400_000))).catch(() => undefined);
    if (!row || !ok) {
      await this.audit.log(null, { action: 'login_failed', module: 'Xavfsizlik', targetName: key, details: 'Login yoki parol xato', ip: meta.ip, requestId: meta.requestId });
      throw unauthorized('Login yoki parol xato');
    }
    if (!row.u.active) throw forbidden('Ushbu akkaunt faol emas');

    // Biriktirilgan filiali nofaol bo'lsa kirmaydi (TZ 7.0.1)
    if (!row.r.allBranches) {
      const ub = await this.db
        .select({ active: branches.active })
        .from(userBranches)
        .innerJoin(branches, eq(branches.id, userBranches.branchId))
        .where(eq(userBranches.userId, row.u.id));
      if (ub.length && !ub.some((b) => b.active)) throw forbidden('Sizga biriktirilgan filial faol emas', 'branch_inactive');
    }

    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.u.id));
    this.invalidate(row.u.id);
    const tokens = await this.issueTokens(row.u.id, randomUUID(), meta);
    const user = await this.loadUser(row.u.id);
    this.logger.log(`Kirish: user=${row.u.username} role=${row.r.name} ip=${meta.ip ?? '-'} session=${tokens.sessionId}`);
    return { ...tokens, user };
  }

  /* ───────── Tokenlar ───────── */

  private async issueTokens(userId: string, familyId: string, meta: { ip?: string; userAgent?: string }) {
    const refreshToken = randomBytes(48).toString('base64url');
    const ttlDays = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    const [s] = await this.db
      .insert(sessions)
      .values({
        userId,
        familyId,
        refreshHash: sha256(refreshToken),
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        ip: meta.ip ?? null,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      })
      .returning({ id: sessions.id });
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: s.id } satisfies JwtPayload);
    return { accessToken, refreshToken, sessionId: s.id };
  }

  /** Rotation: eski refresh bekor qilinadi, yangisi beriladi. Bekor qilingan token qayta kelsa — butun oila o'chadi. */
  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
    const hash = sha256(refreshToken);
    const [s] = await this.db.select().from(sessions).where(eq(sessions.refreshHash, hash)).limit(1);
    if (!s) throw unauthorized('Sessiya topilmadi, qayta kiring');
    if (s.revokedAt) {
      // Token qayta ishlatilmoqda — o'g'irlangan bo'lishi mumkin
      this.logger.warn(`Refresh token qayta ishlatildi, sessiya oilasi bekor qilindi: userId=${s.userId} family=${s.familyId} ip=${meta.ip ?? '-'}`);
      await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt)));
      throw unauthorized('Sessiya bekor qilingan, qayta kiring');
    }
    if (s.expiresAt < new Date()) throw unauthorized('Sessiya muddati tugagan, qayta kiring');
    const user = await this.loadUser(s.userId);
    if (!user) throw unauthorized('Akkaunt faol emas');
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, s.id));
    const tokens = await this.issueTokens(s.userId, s.familyId, meta);
    this.logger.debug(`Refresh: user=${user.username} session=${s.id} → ${tokens.sessionId}`);
    return { ...tokens, user };
  }

  async verifyAccess(token: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw unauthorized('Token yaroqsiz yoki muddati tugagan');
    }
  }

  async logout(sessionId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    this.sessionCache.delete(sessionId);
    this.logger.log(`Chiqish: session=${sessionId}`);
  }

  async logoutAll(userId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    this.sessionCache.clear();
    this.logger.log(`Barcha sessiyalar yopildi: userId=${userId}`);
  }

  /** Foydalanuvchi nofaol qilinganda barcha sessiyalari darhol bekor (TZ 3.3 (5)). */
  async revokeUserSessions(userIds: string[]) {
    if (!userIds.length) return;
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(inArray(sessions.userId, userIds), isNull(sessions.revokedAt)));
    userIds.forEach((id) => this.invalidate(id));
  }

  async listSessions(userId: string) {
    return this.db
      .select({ id: sessions.id, userAgent: sessions.userAgent, ip: sessions.ip, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    this.sessionCache.delete(sessionId);
  }

  /* ───────── Parol ───────── */

  static async hash(password: string) {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  static checkPolicy(password: string) {
    const p = password.trim();
    if (p.length < 8) throw unprocessable('validation_failed', "Parol kamida 8 belgi bo'lsin");
    if (['12345678', 'password', 'qwerty123', '11111111', 'admin123'].includes(p.toLowerCase())) {
      throw unprocessable('validation_failed', 'Bu parol juda oddiy, boshqasini tanlang');
    }
  }

  async changePassword(user: AuthUser, current: string, next: string, keepSessionId: string) {
    const [u] = await this.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
    if (!u || !(await argon2.verify(u.hash, current))) throw unprocessable('validation_failed', "Joriy parol noto'g'ri");
    if (current === next) throw unprocessable('validation_failed', 'Yangi parol eskisidan farq qilsin');
    AuthService.checkPolicy(next);
    await this.db.update(users).set({ passwordHash: await AuthService.hash(next), mustChangePassword: false }).where(eq(users.id, user.id));
    // Boshqa qurilmalardagi sessiyalar yopiladi, joriy qoladi
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), sql`${sessions.id} <> ${keepSessionId}`));
    this.invalidate(user.id);
    this.sessionCache.clear();
    await this.audit.log(user, { action: 'user_update', module: 'Xodimlar', targetId: user.id, targetName: user.name, details: "O'z parolini almashtirdi" });
  }
}
