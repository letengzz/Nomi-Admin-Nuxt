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

/** COUNT(*) 的行类型，mysql2 的泛型要求显式实现 RowDataPacket。 */
interface CountRow extends RowDataPacket {
  total: number;
}

export type RuleType = 'menu_dir' | 'menu' | 'button';

export interface RuleSeed {
  id: number;
  pid: number;
  type: RuleType;
  name: string;
  path: string;
  title: string;
  icon?: string;
  weigh?: number;
  remark?: string;
}

/**
 * 规则节点。`name` 是接口鉴权用的标识（大小写不敏感），`path` 是前端路由。
 * 只有 menu 型需要 path；button 型只对 authNode（按钮显隐）与接口验权有意义。
 *
 * `weigh` 决定同一父级下的先后：菜单树按「权重倒序 + id 正序」排，
 * 所以系统管理下的四件事要显式给权重，否则只能按 id 撞运气。
 */
export const SEED_RULES: readonly RuleSeed[] = [
  { id: 1, pid: 0, type: 'menu', name: 'dashboard', path: '/admin', title: 'layout.menu.dashboard', icon: 'dashboard', weigh: 100 },
  { id: 2, pid: 0, type: 'menu', name: 'analytics', path: '/admin/analytics', title: 'layout.menu.analytics', icon: 'chart', weigh: 90 },

  { id: 3, pid: 0, type: 'menu_dir', name: 'business', path: '#group-business', title: 'layout.menu.business', icon: 'grid', weigh: 80 },
  { id: 9, pid: 3, type: 'menu', name: 'business/orders', path: '/admin/orders', title: 'layout.menu.orders', icon: 'orders' },
  { id: 10, pid: 9, type: 'button', name: 'business/orders/index', path: '', title: 'auth.action.view' },
  { id: 11, pid: 9, type: 'button', name: 'business/orders/add', path: '', title: 'auth.action.add' },
  { id: 12, pid: 9, type: 'button', name: 'business/orders/edit', path: '', title: 'auth.action.edit' },
  { id: 13, pid: 9, type: 'button', name: 'business/orders/del', path: '', title: 'auth.action.delete' },
  { id: 14, pid: 3, type: 'menu', name: 'business/orderDetail', path: '/admin/orders/detail', title: 'layout.menu.orderDetail', icon: 'file' },

  { id: 15, pid: 0, type: 'menu_dir', name: 'system', path: '#group-system', title: 'layout.menu.system', icon: 'settings', weigh: 70 },

  // 用户管理（id 4-8 沿用旧节点，避免已有安装升级时角色授权指向空 id）
  { id: 4, pid: 15, type: 'menu', name: 'system/user', path: '/admin/system/users', title: 'layout.menu.users', icon: 'users', weigh: 60 },
  { id: 5, pid: 4, type: 'button', name: 'system/user/index', path: '', title: 'auth.action.view' },
  { id: 6, pid: 4, type: 'button', name: 'system/user/add', path: '', title: 'auth.action.add' },
  { id: 7, pid: 4, type: 'button', name: 'system/user/edit', path: '', title: 'auth.action.edit' },
  { id: 8, pid: 4, type: 'button', name: 'system/user/del', path: '', title: 'auth.action.delete' },
  { id: 40, pid: 4, type: 'button', name: 'system/user/status', path: '', title: 'auth.action.status' },
  { id: 41, pid: 4, type: 'button', name: 'system/user/resetPwd', path: '', title: 'auth.action.resetPwd' },

  // 部门管理
  { id: 42, pid: 15, type: 'menu', name: 'system/department', path: '/admin/system/departments', title: 'layout.menu.departments', icon: 'department', weigh: 50 },
  { id: 43, pid: 42, type: 'button', name: 'system/department/index', path: '', title: 'auth.action.view' },
  { id: 44, pid: 42, type: 'button', name: 'system/department/add', path: '', title: 'auth.action.add' },
  { id: 45, pid: 42, type: 'button', name: 'system/department/edit', path: '', title: 'auth.action.edit' },
  { id: 46, pid: 42, type: 'button', name: 'system/department/del', path: '', title: 'auth.action.delete' },

  // 通知公告：字段口径见 announcement 表；权重落在用户(60)与部门(50)之间
  { id: 64, pid: 15, type: 'menu', name: 'system/notice', path: '/admin/system/notices', title: 'layout.menu.notices', icon: 'notice', weigh: 55 },
  { id: 65, pid: 64, type: 'button', name: 'system/notice/index', path: '', title: 'auth.action.view' },
  { id: 66, pid: 64, type: 'button', name: 'system/notice/add', path: '', title: 'auth.action.add' },
  { id: 67, pid: 64, type: 'button', name: 'system/notice/edit', path: '', title: 'auth.action.edit' },
  { id: 68, pid: 64, type: 'button', name: 'system/notice/del', path: '', title: 'auth.action.delete' },

  // 角色管理（路由是 /admin/system/roles，节点名沿用 system/role）
  { id: 19, pid: 15, type: 'menu', name: 'system/role', path: '/admin/system/roles', title: 'layout.menu.roles', icon: 'role', weigh: 40 },
  { id: 20, pid: 19, type: 'button', name: 'system/role/index', path: '', title: 'auth.action.view' },
  { id: 21, pid: 19, type: 'button', name: 'system/role/add', path: '', title: 'auth.action.add' },
  { id: 22, pid: 19, type: 'button', name: 'system/role/edit', path: '', title: 'auth.action.edit' },
  { id: 23, pid: 19, type: 'button', name: 'system/role/del', path: '', title: 'auth.action.delete' },

  { id: 29, pid: 15, type: 'menu', name: 'system/rule', path: '/admin/system/rules', title: 'layout.menu.rules', icon: 'menu', weigh: 30 },
  { id: 30, pid: 29, type: 'button', name: 'system/rule/index', path: '', title: 'auth.action.view' },
  { id: 31, pid: 29, type: 'button', name: 'system/rule/add', path: '', title: 'auth.action.add' },
  { id: 32, pid: 29, type: 'button', name: 'system/rule/edit', path: '', title: 'auth.action.edit' },
  { id: 33, pid: 29, type: 'button', name: 'system/rule/del', path: '', title: 'auth.action.delete' },
  { id: 34, pid: 29, type: 'button', name: 'system/rule/sortable', path: '', title: 'auth.action.sortable' },

  // 系统监控：独立分组。系统日志沿用旧的 system/log 节点（id 35/36），
  // 只换父级与路径，权限标识不变，已有角色授权与接口验权都不用动。
  { id: 60, pid: 0, type: 'menu_dir', name: 'monitor', path: '#group-monitor', title: 'layout.menu.monitor', icon: 'monitor', weigh: 65 },
  { id: 61, pid: 60, type: 'menu', name: 'monitor/online', path: '/admin/monitor/online', title: 'layout.menu.onlineUsers', icon: 'monitor', weigh: 60 },
  { id: 62, pid: 61, type: 'button', name: 'monitor/online/index', path: '', title: 'auth.action.view' },
  { id: 63, pid: 61, type: 'button', name: 'monitor/online/kick', path: '', title: 'monitor.online.kick' },
  { id: 35, pid: 60, type: 'menu', name: 'system/log', path: '/admin/monitor/logs', title: 'layout.menu.systemLogs', icon: 'file', weigh: 50 },
  { id: 36, pid: 35, type: 'button', name: 'system/log/index', path: '', title: 'auth.action.view' },

  // 语言管理：菜单权重落在日志(20)与设置(10)之间
  { id: 47, pid: 15, type: 'menu', name: 'system/language', path: '/admin/system/languages', title: 'layout.menu.languages', icon: 'language', weigh: 15 },
  { id: 48, pid: 47, type: 'button', name: 'system/language/index', path: '', title: 'auth.action.view' },
  { id: 49, pid: 47, type: 'button', name: 'system/language/add', path: '', title: 'auth.action.add' },
  { id: 50, pid: 47, type: 'button', name: 'system/language/edit', path: '', title: 'auth.action.edit' },
  { id: 51, pid: 47, type: 'button', name: 'system/language/del', path: '', title: 'auth.action.delete' },

  { id: 16, pid: 15, type: 'menu', name: 'system/settings', path: '/admin/system/settings', title: 'layout.menu.systemSettings', icon: 'sliders', weigh: 10 },
  { id: 17, pid: 16, type: 'button', name: 'system/settings/index', path: '', title: 'auth.action.view' },
  { id: 18, pid: 16, type: 'button', name: 'system/settings/edit', path: '', title: 'auth.action.edit' },

  { id: 37, pid: 0, type: 'menu', name: 'system/profile', path: '/admin/profile', title: 'layout.menu.profile', icon: 'user', weigh: 60 },
  { id: 38, pid: 37, type: 'button', name: 'system/profile/index', path: '', title: 'auth.action.view' },
  { id: 39, pid: 37, type: 'button', name: 'system/profile/edit', path: '', title: 'auth.action.edit' },
];

export interface RoleSeed {
  id: number;
  pid: number;
  name: string;
  /** 代码/接口里引用的稳定标识；名字可以随便改，编码别轻易动 */
  code: string;
  /** `'*'` 表示超级管理员；其余是 SEED_RULES 的 id */
  rules: '*' | number[];
}

/** 三个角色：超管 / 管理员 / 普通用户。id=1 的 `'*'` 让未来新增节点天然对超管可见。 */
export const SEED_ROLES: readonly RoleSeed[] = [
  { id: 1, pid: 0, name: '超级管理员', code: 'super', rules: '*' },
  {
    id: 2,
    pid: 1,
    name: '管理员',
    code: 'admin',
    rules: [
      1, 2, 3, 9, 10, 11, 12, 14,
      4, 5, 6, 7, 8, 40, 41,
      42, 43, 44, 45, 46,
      64, 65, 66, 67, 68,
      16, 17, 18,
      19, 20, 21, 22,
      29, 30, 31, 32,
      35, 36, 47, 48, 49, 50, 51,
      60, 61, 62, 63,
      37, 38, 39,
    ],
  },
  // 普通用户：只有仪表盘和个人中心。角色本身就是「最小权限」的表达，
  // 不需要再靠一个 user_type 字段告诉他「你不能进后台」。
  { id: 3, pid: 1, name: '普通用户', code: 'member', rules: [1, 37, 38, 39] },
];

/** 语言定义。code 必须和 nuxt.config.ts 的 i18n.locales.code 对齐。 */
export interface LanguageSeed {
  code: string;
  name: string;
  nativeName: string;
  weigh: number;
}

export const SEED_LANGUAGES: readonly LanguageSeed[] = [
  { code: 'zh', name: '简体中文', nativeName: '简体中文', weigh: 100 },
  { code: 'en', name: 'English', nativeName: 'English', weigh: 90 },
];

export interface DepartmentSeed {
  id: number;
  pid: number;
  name: string;
  leader: string;
  phone: string;
  weigh: number;
}

/** 组织树：总经办下挂三中心，中心下挂小组。用户管理左侧的树就是这棵树。 */
export const SEED_DEPARTMENTS: readonly DepartmentSeed[] = [
  { id: 1, pid: 0, name: '总经办', leader: '陈明远', phone: '010-88000001', weigh: 100 },
  { id: 2, pid: 1, name: '技术中心', leader: '林知远', phone: '010-88000002', weigh: 90 },
  { id: 3, pid: 2, name: '前端组', leader: '周晓彤', phone: '010-88000003', weigh: 30 },
  { id: 4, pid: 2, name: '后端组', leader: '吴明轩', phone: '010-88000004', weigh: 20 },
  { id: 5, pid: 1, name: '产品设计中心', leader: '陈思远', phone: '010-88000005', weigh: 80 },
  { id: 6, pid: 5, name: '产品组', leader: '孙可欣', phone: '010-88000006', weigh: 30 },
  { id: 7, pid: 5, name: '设计组', leader: '徐子墨', phone: '010-88000007', weigh: 20 },
  { id: 8, pid: 1, name: '市场运营中心', leader: '赵一诺', phone: '010-88000008', weigh: 70 },
  { id: 9, pid: 8, name: '运营组', leader: '钱多多', phone: '010-88000009', weigh: 30 },
  { id: 10, pid: 1, name: '财务部', leader: '孙可欣', phone: '010-88000010', weigh: 60 },
];

export interface AdminSeed {
  id: number;
  username: string;
  nickname: string;
  password: string;
  departmentId: number;
  roleIds: number[];
}

/**
 * 三个演示账号，与登录页的演示数据一一对应（super / admin / user，密码 123456）。
 * 首次启动会把它们写进数据库；线上部署后请立刻改密码或删掉多余账号。
 */
export const SEED_ADMINS: readonly AdminSeed[] = [
  { id: 1, username: 'super', nickname: '超级管理员', password: '123456', departmentId: 1, roleIds: [1] },
  { id: 2, username: 'admin', nickname: '管理员', password: '123456', departmentId: 2, roleIds: [2] },
  { id: 3, username: 'user', nickname: '普通用户', password: '123456', departmentId: 8, roleIds: [3] },
];

/** 注册页新建的账号默认挂这个角色（普通用户）。 */
export const DEFAULT_ROLE_ID = 3;

export interface UserSeed {
  username: string;
  nickname: string;
  email: string;
  mobile: string;
  motto: string;
  password: string;
  /** enable / disable */
  status: string;
  departmentId: number;
  /** 距今多少天前登录过；不填 = 从未登录 */
  lastLoginDaysAgo?: number;
}

/** 演示员工。全部挂「普通用户」角色，部门落在各小组里，用户管理左树才有内容。 */
export const SEED_USERS: readonly UserSeed[] = [
  { username: 'linzhiyuan', nickname: '林知远', email: 'lin@nomi.dev', mobile: '13800000001', motto: '把复杂留在代码里', password: '123456', status: 'enable', departmentId: 2, lastLoginDaysAgo: 1 },
  { username: 'zhouxiaotong', nickname: '周晓彤', email: 'zhou@nomi.dev', mobile: '13800000002', motto: '先跑通，再跑快', password: '123456', status: 'enable', departmentId: 3, lastLoginDaysAgo: 3 },
  { username: 'wumingxuan', nickname: '吴明轩', email: 'wu@nomi.dev', mobile: '13800000003', motto: '', password: '123456', status: 'disable', departmentId: 4 },
  { username: 'chensiyuan', nickname: '陈思远', email: 'chen@nomi.dev', mobile: '13800000004', motto: '数据说话', password: '123456', status: 'enable', departmentId: 5, lastLoginDaysAgo: 9 },
  { username: 'sunkeyin', nickname: '孙可欣', email: 'sun@nomi.dev', mobile: '13800000005', motto: '', password: '123456', status: 'disable', departmentId: 6 },
  { username: 'xuzimo', nickname: '徐子墨', email: 'xu@nomi.dev', mobile: '13800000006', motto: '慢即是快', password: '123456', status: 'enable', departmentId: 7, lastLoginDaysAgo: 21 },
  { username: 'zhaoyinuo', nickname: '赵一诺', email: 'zhao@nomi.dev', mobile: '13800000007', motto: '增长来自细节', password: '123456', status: 'enable', departmentId: 8, lastLoginDaysAgo: 5 },
  { username: 'qianduoduo', nickname: '钱多多', email: 'qian@nomi.dev', mobile: '13800000008', motto: '', password: '123456', status: 'enable', departmentId: 9, lastLoginDaysAgo: 2 },
];

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
