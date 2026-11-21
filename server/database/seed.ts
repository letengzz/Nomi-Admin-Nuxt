/**
 * 种子数据：首次建表后灌入的「能让系统立刻跑起来」的最小集合。
 *
 * 覆盖六块：语言 / 部门 / 菜单与权限节点 / 角色 / 账号（含超级管理员）/ 系统配置。
 * 前五块是「系统能跑起来」的前提，系统配置则是把 DEFAULT_CONFIG 整份落库，
 * 让运维不必翻代码就知道系统有哪些可配置项。
 *
 * 结构照抄 docs/权限系统设计.md 2.4 节的 88 节点表，但内容换成本项目真实的
 * 页面（控制台 / 业务 / 组织 / 系统管理）。节点 id 显式写死：
 * `role.rules` 是 id 的逗号串，id 由自增决定的话，种子角色的授权
 * 就会在每次全新安装时指向不同节点。
 *
 * 幂等策略：**只在表为空时写入**。用户改过菜单/授权之后重启，种子不会
 * 把它们覆盖回去 —— 这是「自动初始化」而不是「自动重置」。
 */
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { hashPassword } from '../utils/auth/password';
import { DEFAULT_CONFIG } from '../utils/system-config';
import {
  DEFAULT_ROLE_ID,
  SEED_ADMINS,
  SEED_DEPARTMENTS,
  SEED_LANGUAGES,
  SEED_ROLES,
  SEED_RULES,
  SEED_USERS,
} from '../../shared/constants/seed-data';

/** COUNT(*) 的行类型，mysql2 的泛型要求显式实现 RowDataPacket。 */
interface CountRow extends RowDataPacket {
  total: number;
}

/**
 * 种子数据本体在 `shared/constants/seed-data.ts`。
 *
 * 挪出去的唯一原因是前端演示站（`NUXT_PUBLIC_DEMO=1`）也要用同一份菜单 / 角色 /
 * 部门 / 账号：它不连数据库，若在这里再抄一份，演示与真机迟早会对不上。
 * 下面的 re-export 保证服务端原有的引用方式（`from '.../database/seed'`）不受影响。
 */
export {
  DEFAULT_ROLE_ID,
  SEED_ADMINS,
  SEED_DEPARTMENTS,
  SEED_LANGUAGES,
  SEED_ROLES,
  SEED_RULES,
  SEED_USERS,
};
export type {
  AdminSeed,
  DepartmentSeed,
  LanguageSeed,
  RoleSeed,
  RuleSeed,
  RuleType,
  UserSeed,
} from '../../shared/constants/seed-data';

/**
 * 系统配置的初始行：把 `DEFAULT_CONFIG` 摊平成 `(section, config_key, config_value)`。
 *
 * 读配置本来就有「库里没有这个键就回落默认值」的兜底，所以这份种子的内容就是
 * **默认值本身**。写进库的意义在于：新装完的系统，`system_config` 表不是空的 ——
 * 运维打开表就能看到「这套系统有哪些配置项、当前值是什么」，改配置也只是改一行，
 * 不用先去读代码找默认值。
 *
 * 取值直接来自 DEFAULT_CONFIG，所以以后新增区块/键不需要同步改这里；
 * 已经存在的键不会被覆盖（`INSERT IGNORE` + 空表判断）—— 自动初始化，不是自动重置。
 */
export function defaultConfigRows(ts: number): unknown[][] {
  const config = DEFAULT_CONFIG as unknown as Record<string, Record<string, unknown>>;
  const rows: unknown[][] = [];
  for (const [section, values] of Object.entries(config)) {
    for (const [key, value] of Object.entries(values)) {
      rows.push([
        section,
        key,
        typeof value === 'boolean' ? (value ? '1' : '0') : String(value ?? ''),
        ts,
      ]);
    }
  }
  return rows;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** 种子唯一的写入条件：这张表还是空的。表名只来自本文件的字面量，不拼外部输入。 */
async function isEmpty(pool: Pool, table: string): Promise<boolean> {
  const [rows] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS total FROM \`${table}\``);
  return Number(rows[0]?.total ?? 0) === 0;
}

/** 账号 → 角色的映射表写入（账号 id 已知）。 */
async function insertRoles(
  pool: Pool,
  userId: number,
  roleIds: readonly number[],
): Promise<void> {
  if (roleIds.length === 0) return;
  await pool.query('INSERT IGNORE INTO `user_role` (`user_id`,`role_id`) VALUES ?', [
    roleIds.map((roleId) => [userId, roleId]),
  ]);
}

export interface SeedReport {
  /** 表名 → 本次写入行数；空对象表示库已经初始化过，本次什么都没写 */
  inserted: Record<string, number>;
}

/**
 * 只在空表上写入。几张表分别判断：如果用户删光了规则但保留账号，
 * 规则会被重新种回来（否则系统会变成「能登录但没有任何菜单」的死状态）。
 *
 * 返回每张表真正写入的行数，启动日志据此说明「这次初始化到底种了什么」。
 */
export async function seedIfEmpty(pool: Pool): Promise<SeedReport> {
  const ts = now();
  const inserted: Record<string, number> = {};
  const record = (table: string, rows: number): void => {
    if (rows > 0) inserted[table] = rows;
  };

  if (await isEmpty(pool, 'language')) {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO `language` (`code`,`name`,`native_name`,`weigh`,`status`,`create_time`,`update_time`) VALUES ?',
      [
        SEED_LANGUAGES.map((lang) => [
          lang.code,
          lang.name,
          lang.nativeName,
          lang.weigh,
          1,
          ts,
          ts,
        ]),
      ],
    );
    record('language', result.affectedRows);
  }

  if (await isEmpty(pool, 'department')) {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO `department` (`id`,`pid`,`name`,`leader`,`phone`,`weigh`,`status`,`create_time`,`update_time`) VALUES ?',
      [
        SEED_DEPARTMENTS.map((dept) => [
          dept.id,
          dept.pid,
          dept.name,
          dept.leader,
          dept.phone,
          dept.weigh,
          1,
          ts,
          ts,
        ]),
      ],
    );
    record('department', result.affectedRows);
  }

  if (await isEmpty(pool, 'permission_rule')) {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO `permission_rule` (`id`,`pid`,`type`,`title`,`name`,`path`,`icon`,`weigh`,`status`,`create_time`,`update_time`) VALUES ?',
      [
        SEED_RULES.map((rule) => [
          rule.id,
          rule.pid,
          rule.type,
          rule.title,
          rule.name,
          rule.path,
          rule.icon ?? '',
          rule.weigh ?? 0,
          1,
          ts,
          ts,
        ]),
      ],
    );
    record('permission_rule', result.affectedRows);
  }

  if (await isEmpty(pool, 'role')) {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO `role` (`id`,`pid`,`name`,`code`,`rules`,`status`,`create_time`,`update_time`) VALUES ?',
      [
        SEED_ROLES.map((role) => [
          role.id,
          role.pid,
          role.name,
          role.code,
          role.rules === '*' ? '*' : role.rules.join(','),
          1,
          ts,
          ts,
        ]),
      ],
    );
    record('role', result.affectedRows);
  }

  // 系统配置：按「区块 + 键」一行一条，空表时把默认值整份落库。
  if (await isEmpty(pool, 'system_config')) {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT IGNORE INTO `system_config` (`section`,`config_key`,`config_value`,`update_time`) VALUES ?',
      [defaultConfigRows(ts)],
    );
    record('system_config', result.affectedRows);
  }

  if (!(await isEmpty(pool, 'user'))) return { inserted };

  let userRows = 0;
  for (const admin of SEED_ADMINS) {
    // 逐个哈希：scrypt 是 CPU 密集的，查一次慢，但只在首次启动发生。
    const password = await hashPassword(admin.password);
    await pool.query(
      'INSERT INTO `user` (`id`,`username`,`department_id`,`nickname`,`password`,`status`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?,?,?)',
      [admin.id, admin.username, admin.departmentId, admin.nickname, password, 'enable', ts, ts],
    );
    await insertRoles(pool, admin.id, admin.roleIds);
    userRows += 1;
  }

  const day = 24 * 3600;
  for (const [index, user] of SEED_USERS.entries()) {
    const password = await hashPassword(user.password);
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT IGNORE INTO `user` (`username`,`department_id`,`nickname`,`email`,`mobile`,`motto`,`password`,`status`,`create_time`,`update_time`,`last_login_time`,`last_login_ip`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        user.username,
        user.departmentId,
        user.nickname,
        user.email,
        user.mobile,
        user.motto,
        password,
        user.status,
        ts - (SEED_USERS.length - index) * 12 * day,
        ts,
        user.lastLoginDaysAgo === undefined ? 0 : ts - user.lastLoginDaysAgo * day,
        user.lastLoginDaysAgo === undefined ? '' : '127.0.0.1',
      ],
    );
    // INSERT IGNORE 撞了唯一键时 insertId 为 0：这种账号已有归属，不再补角色。
    if (result.insertId) {
      await insertRoles(pool, result.insertId, [DEFAULT_ROLE_ID]);
      userRows += 1;
    }
  }
  record('user', userRows);

  return { inserted };
}
