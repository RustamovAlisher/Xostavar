import { boolean, index, inet, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, updatedAt, version } from './common.js';
import { branches, sqlLower } from './branches.js';

/** Rollar — huquqlar shabloni (TZ 7.1). `allBranches` — egasi: barcha filiallarni ko'radi. */
export const roles = pgTable(
  'roles',
  {
    id: id(),
    name: text('name').notNull(),
    permissions: text('permissions').array().notNull().default([]),
    allBranches: boolean('all_branches').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_name_lower_uq').on(sqlLower(t.name))],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    username: text('username').notNull(),
    email: text('email'),
    phone: text('phone'),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    /** Rol shablonidan nusxa; xodimga alohida o'zgartiriladi. */
    permissions: text('permissions').array().notNull().default([]),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    deletedAt: deletedAt(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_username_lower_uq').on(sqlLower(t.username)),
    uniqueIndex('users_email_lower_uq').on(sqlLower(t.email)),
    index('users_role_idx').on(t.roleId),
  ],
);

/** Xodim qaysi filiallarda ishlaydi (TZ 7.0). `allBranches` rolida qator kerak emas. */
export const userBranches = pgTable(
  'user_branches',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] }), index('user_branches_branch_idx').on(t.branchId)],
);

/** Refresh-token sessiyalari (TZ 6.1): hash saqlanadi, har ishlatilganda aylantiriladi. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshHash: text('refresh_hash').notNull(),
    /** Bitta login oilasi: qayta ishlatilgan token aniqlansa butun oila bekor qilinadi. */
    familyId: uuid('family_id').notNull(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), uniqueIndex('sessions_refresh_hash_uq').on(t.refreshHash)],
);

/** Muvaffaqiyatsiz kirish urinishlari — bloklash (TZ 6.2: 5 ta / 15 daqiqa). */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: id(),
    login: text('login').notNull(),
    ip: inet('ip'),
    success: boolean('success').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('login_attempts_login_time_idx').on(t.login, t.createdAt)],
);
