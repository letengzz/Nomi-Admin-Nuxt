/**
 * 权限节点 / 角色 / 部门 / 账号 / 语言的**种子数据**。
 *
 * 放在 shared/ 而不是 server/database/ 的原因：
 *   · 服务端首次建表要把它们写进库（server/database/seed.ts）；
 *   · 前端演示站（NUXT_PUBLIC_DEMO=1）不连数据库，直接拿同一份数据渲染。
 * 两边引同一份常量，演示里看到的菜单/部门/成员才和真机种子完全一致；
 * 各写一份迟早会出现「演示有八个菜单、真机只有七个」这种对不上的问题。
 *
 * 这里只放纯数据（无 import、无 Node 依赖），保证能被浏览器打包。
 */

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
  departmentId: number;
  roleIds: number[];
  /**
   * 演示账号：只在非生产环境（或显式 `SEED_DEMO_ACCOUNTS=1`）创建。
   * 生产环境种子只建 `super` 一个，其余账号由管理员自己拉人。
   */
  demo?: boolean;
}

/**
 * 种子管理员。
 *
 * ★ 这里**没有 password 字段**，而且不能加回来：
 *   写死口令等于每一套新装实例都带同一个公开凭据；口令的解析见
 *   `server/utils/auth/initial-password.ts`（环境变量或启动时随机生成），
 *   落库时由 `server/database/seed.ts` 现算。
 *
 * `id` 必须显式写死：`user_role` 与审计日志都按 id 关联，自增会让每次全新安装
 * 指向不同的人。
 */
export const SEED_ADMINS: readonly AdminSeed[] = [
  { id: 1, username: 'super', nickname: '超级管理员', departmentId: 1, roleIds: [1] },
  { id: 2, username: 'admin', nickname: '管理员', departmentId: 2, roleIds: [2], demo: true },
  { id: 3, username: 'user', nickname: '普通用户', departmentId: 8, roleIds: [3], demo: true },
];

/** 注册页新建的账号默认挂这个角色（普通用户）。 */
export const DEFAULT_ROLE_ID = 3;

export interface UserSeed {
  username: string;
  nickname: string;
  email: string;
  mobile: string;
  motto: string;
  /** enable / disable */
  status: string;
  departmentId: number;
  /** 距今多少天前登录过；不填 = 从未登录 */
  lastLoginDaysAgo?: number;
}

/**
 * 演示员工。全部挂「普通用户」角色，部门落在各小组里，用户管理左树才有内容。
 *
 * 同样不含口令，且只在非生产环境创建（见 `seed.ts` 的 demoAccountsEnabled）。
 */
export const SEED_USERS: readonly UserSeed[] = [
  { username: 'linzhiyuan', nickname: '林知远', email: 'lin@nomi.dev', mobile: '13800000001', motto: '把复杂留在代码里', status: 'enable', departmentId: 2, lastLoginDaysAgo: 1 },
  { username: 'zhouxiaotong', nickname: '周晓彤', email: 'zhou@nomi.dev', mobile: '13800000002', motto: '先跑通，再跑快', status: 'enable', departmentId: 3, lastLoginDaysAgo: 3 },
  { username: 'wumingxuan', nickname: '吴明轩', email: 'wu@nomi.dev', mobile: '13800000003', motto: '', status: 'disable', departmentId: 4 },
  { username: 'chensiyuan', nickname: '陈思远', email: 'chen@nomi.dev', mobile: '13800000004', motto: '数据说话', status: 'enable', departmentId: 5, lastLoginDaysAgo: 9 },
  { username: 'sunkeyin', nickname: '孙可欣', email: 'sun@nomi.dev', mobile: '13800000005', motto: '', status: 'disable', departmentId: 6 },
  { username: 'xuzimo', nickname: '徐子墨', email: 'xu@nomi.dev', mobile: '13800000006', motto: '慢即是快', status: 'enable', departmentId: 7, lastLoginDaysAgo: 21 },
  { username: 'zhaoyinuo', nickname: '赵一诺', email: 'zhao@nomi.dev', mobile: '13800000007', motto: '增长来自细节', status: 'enable', departmentId: 8, lastLoginDaysAgo: 5 },
  { username: 'qianduoduo', nickname: '钱多多', email: 'qian@nomi.dev', mobile: '13800000008', motto: '', status: 'enable', departmentId: 9, lastLoginDaysAgo: 2 },
];
