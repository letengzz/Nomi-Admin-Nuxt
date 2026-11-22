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
import {
  persistInitialPassword,
  resolveInitialAdminPassword,
  type InitialPassword,
} from '../utils/auth/initial-password';
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
async function insertRoles(pool: Pool, userId: number, roleIds: readonly number[]): Promise<void> {
  if (roleIds.length === 0) return;
  await pool.query('INSERT IGNORE INTO `user_role` (`user_id`,`role_id`) VALUES ?', [
    roleIds.map((roleId) => [userId, roleId]),
  ]);
}

export interface SeedReport {
  /** 表名 → 本次写入行数；空对象表示库已经初始化过，本次什么都没写 */
  inserted: Record<string, number>;
  /**
   * 首次创建初始超管时的凭据。只在**本次真的写了 `user` 表**时存在，
   * 由 `init.ts` 负责打印 / 落盘提示 —— 种子层不做控制台输出，方便单测。
   */
  initialAdmin?: {
    username: string;
    password: string;
    source: InitialPassword['source'];
    /** 随机口令落盘后的绝对路径；写文件失败时为 undefined */
    filePath?: string;
  };
}

/**
 * 是否创建演示账号（admin / user + 8 名员工）。
 *
 * 默认「非生产环境才建」：这些账号是给本地开发和演示站看的，口令与初始超管相同，
 * 一旦跟着镜像进生产，等于又开了一扇没有必要的门。
 * 例外用 `SEED_DEMO_ACCOUNTS=1`（构建演示环境时显式开启）/ `=0`（本地也不建）。
 */
export function demoAccountsEnabled(): boolean {
  const flag = process.env.SEED_DEMO_ACCOUNTS?.trim();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/** 这些表里出现过就必须提示的演示账号（升级上来的老库里可能还留着它们）。 */
const DEMO_USERNAMES: readonly string[] = [
  ...SEED_ADMINS.filter((admin) => admin.demo).map((admin) => admin.username),
  ...SEED_USERS.map((user) => user.username),
];

export interface SeedAudit {
  /** 仍处于「首次登录必须改密」状态的账号 */
  pendingPasswordChange: string[];
  /** 库里仍存在的演示账号 —— 生产环境出现这些说明种子是从老版本带过来的 */
  demoAccounts: string[];
}

/**
 * 启动时的账号体检（只读）。
 *
 * 两个必须让人看见的信号：
 *   · 还有账号没改初始密码 —— 说明交付出去的凭据可能还生效；
 *   · 生产库里躺着演示账号 —— 说明这套库是从老版本升级来的，需要人工清理。
 * 都不自动修：删账号 / 停账号属于改数据，交给人决定。
 */
export async function auditSeededAccounts(pool: Pool): Promise<SeedAudit> {
  const [pendingRows] = await pool.query<Array<{ username: string } & RowDataPacket>>(
    'SELECT `username` FROM `user` WHERE `must_change_password` = 1 ORDER BY `id` ASC LIMIT 20',
  );
  const [demoRows] = await pool.query<Array<{ username: string } & RowDataPacket>>(
    'SELECT `username` FROM `user` WHERE `username` IN (?) ORDER BY `id` ASC LIMIT 20',
    [DEMO_USERNAMES],
  );

  return {
    pendingPasswordChange: pendingRows.map((row) => row.username),
    demoAccounts: demoRows.map((row) => row.username),
  };
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

  // ★ 口令从这里开始「现算」：环境变量优先，否则随机生成。源码里没有任何字面量。
  //   放这一行而不是函数入口：已有库重启不该被一个配错的 INITIAL_ADMIN_PASSWORD 拦住。
  const seedDemo = demoAccountsEnabled();
  const initial = resolveInitialAdminPassword();
  let initialAdmin: SeedReport['initialAdmin'];

  let userRows = 0;
  for (const admin of SEED_ADMINS) {
    // 演示账号只在非生产环境创建，且与初始超管共用同一串随机口令 ——
    // 「少一个写死的口令」比「多一个让本地方便的常量」重要得多。
    if (admin.demo && !seedDemo) continue;

    // 逐个哈希：scrypt 是 CPU 密集的，查一次慢，但只在首次启动发生。
    const password = await hashPassword(initial.password);
    await pool.query(
      'INSERT INTO `user` (`id`,`username`,`department_id`,`nickname`,`password`,`status`,`must_change_password`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?,?,?,?)',
      [
        admin.id,
        admin.username,
        admin.departmentId,
        admin.nickname,
        password,
        'enable',
        // 种子账号的口令一定「经手过别人」（日志 / 文件 / 环境变量），首次登录必须换掉。
        // 演示账号不打这个标记：它们的存在意义就是开箱即登，且不会进生产。
        admin.demo ? 0 : 1,
        ts,
        ts,
      ],
    );
    await insertRoles(pool, admin.id, admin.roleIds);
    userRows += 1;

    if (!admin.demo) {
      const filePath =
        initial.source === 'generated' ? await persistInitialPassword(initial.password) : undefined;
      initialAdmin = {
        username: admin.username,
        password: initial.password,
        source: initial.source,
        filePath,
      };
    }
  }

  const day = 24 * 3600;
  for (const [index, user] of (seedDemo ? SEED_USERS : []).entries()) {
    const password = await hashPassword(initial.password);
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

  return { inserted, initialAdmin };
}
