/**
 * 演示站的内存数据。
 *
 * 用途：`NUXT_PUBLIC_DEMO=1` 构建出来的静态站没有 Nitro、没有 MySQL，
 * 所有 `/api/**` 都由 `app/mock/index.ts` 从这里取数据应答。
 *
 * 三条约定：
 *   ① **种子优先**：菜单 / 角色 / 部门 / 账号直接取 `shared/constants/seed-data.ts`，
 *      和真实后端首次建表写入的是同一份，演示里看到的菜单顺序、部门层级不会跑偏。
 *   ② **只在内存里生效**：新增/编辑/删除改的是这个模块的对象，刷新页面就复原。
 *      演示站不该让人以为自己的操作被持久化了。
 *   ③ **时间是相对的**：所有 `createTime` / `last_active_time` 都以「此刻」为基准
 *      往前推，静态站放上几个月再打开，列表里也不会出现一堆「三年前」的记录。
 */
import type {
  AdminLogItem,
  AdminRule,
  DepartmentItem,
  MenuNode,
  NoticeItem,
  RoleItem,
  RuleType,
  UserItem,
} from '../types/permission';
import type { LanguageEntryItem, LanguageItem } from '../types/language';
import type {
  LoginLogItem,
  OnlineSession,
  OperationLogDetail,
  OperationLogItem,
} from '../types/monitor';
import type { SelfProfile } from '../services/profile';
import type { SystemConfig } from '../services/system-config';
import {
  SEED_ADMINS,
  SEED_DEPARTMENTS,
  SEED_LANGUAGES,
  SEED_ROLES,
  SEED_RULES,
  SEED_USERS,
} from '#shared/constants/seed-data';

const DAY = 86_400;
const HOUR = 3_600;

/** 秒级时间戳。与真实接口一致：全部用 unix 秒，不用 Date 对象。 */
export const now = (): number => Math.floor(Date.now() / 1000);

/** 「几天前的某个整点」，用来造一批看起来正常的登录/操作记录。 */
export function ago(days: number, hour = 9): number {
  const base = now() - days * DAY;
  return base - (base % DAY) + hour * HOUR;
}

const AVATAR = '';

interface SeedDepartmentLookup {
  name: string;
  pid: number;
}

/** id → 部门，供用户列表补 departmentName 用（种子里的部门不会再变）。 */
const DEPARTMENTS: ReadonlyMap<number, SeedDepartmentLookup> = new Map(
  SEED_DEPARTMENTS.map((dept) => [dept.id, { name: dept.name, pid: dept.pid }]),
);

function departmentNameOf(id: number): string {
  return DEPARTMENTS.get(id)?.name ?? '未分配';
}

/** 部门子树（含自身）：用户管理的左树选中一个中心时，要连下面小组的人一起列出来。 */
export function departmentSubtree(id: number): Set<number> {
  const result = new Set<number>();
  if (!id) return result;
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || result.has(current)) continue;
    result.add(current);
    for (const dept of SEED_DEPARTMENTS) {
      if (dept.pid === current) queue.push(dept.id);
    }
  }
  return result;
}

// --- 规则节点 --------------------------------------------------------------

/** 种子 → 规则表行。`children` 先留空，交给 attachChildren 组装。 */
function toRuleRows(): AdminRule[] {
  return SEED_RULES.map((rule) => ({
    id: rule.id,
    pid: rule.pid,
    name: rule.name,
    title: rule.title,
    path: rule.path,
    icon: rule.icon ?? '',
    type: rule.type,
    keepalive: rule.type === 'menu' ? 1 : 0,
    menu_type: rule.type === 'menu_dir' ? 'dir' : rule.type,
    url: '',
    component: rule.type === 'menu' ? `pages${rule.path}.vue` : '',
    extend: '',
    remark: rule.remark ?? '',
    weigh: rule.weigh ?? 0,
    status: 1,
    children: [],
  }));
}

/** 同层排序：权重倒序 + id 正序。与后端 `buildMenuTree` 的排序一致。 */
function byWeight(a: { weigh: number; id: number }, b: { weigh: number; id: number }): number {
  return b.weigh - a.weigh || a.id - b.id;
}

/** 按 pid 组装树（所有层级都按 byWeight 排序）。 */
function attachChildren(rows: readonly AdminRule[]): AdminRule[] {
  const nodes = rows.map((row) => ({ ...row, children: [] as AdminRule[] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: AdminRule[] = [];
  for (const node of nodes) {
    const parent = node.pid ? byId.get(node.pid) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortLevel = (list: AdminRule[]): void => {
    list.sort(byWeight);
    for (const item of list) sortLevel(item.children);
  };
  sortLevel(roots);
  return roots;
}

/** 规则管理页的树（含按钮节点，按权重排）。 */
export function buildRuleTree(rules: readonly AdminRule[]): AdminRule[] {
  return attachChildren(rules);
}

/** 侧边栏/菜单树：只要 menu 与 menu_dir，按钮节点不进导航。 */
export function buildMenuTree(rules: readonly AdminRule[]): MenuNode[] {
  const toNode = (rule: AdminRule): MenuNode => ({
    id: rule.id,
    name: rule.name,
    title: rule.title,
    path: rule.path,
    icon: rule.icon,
    type: rule.type as RuleType,
    keepalive: rule.keepalive,
    children: rule.children.map(toNode),
  });
  return attachChildren(rules.filter((rule) => rule.type !== 'button')).map(toNode);
}

/**
 * `path → 可用动作`。与 `server/api/admin/init.get.ts` 同一套推导：
 * 按钮子节点的 name 去掉「父节点路径前缀」就是动作名（add / edit / del …）。
 */
export function buildAuthNode(rules: readonly AdminRule[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const rule of rules) {
    if (rule.type === 'button' || !rule.path || rule.path.startsWith('#')) continue;
    const prefix = `${rule.name.toLowerCase()}/`;
    result[rule.path] = rules
      .filter((child) => child.pid === rule.id && child.type === 'button')
      .map((child) => {
        const name = child.name.toLowerCase();
        return name.startsWith(prefix) ? name.slice(prefix.length) : name;
      });
  }
  return result;
}

// --- 账号 ------------------------------------------------------------------

const GENDERS = ['male', 'female', 'unknown'];

/**
 * 账号表：三个种子管理员（id 1-3）+ 八个演示员工（id 4-11）。
 *
 * id 与真实库保持一致 —— `role.rules` 存的是规则 id，`user_role` 存的是两边 id，
 * 演示里如果自己另编一套，角色成员数、部门人数都会对不上。
 */
export function buildUsers(): UserItem[] {
  const roleNameOf = (roleId: number): string =>
    SEED_ROLES.find((role) => role.id === roleId)?.name ?? '普通用户';

  const admins: UserItem[] = SEED_ADMINS.map((admin, index) => ({
    id: admin.id,
    username: admin.username,
    departmentId: admin.departmentId,
    departmentName: departmentNameOf(admin.departmentId),
    nickname: admin.nickname,
    avatar: AVATAR,
    email: `${admin.username}@nomi.dev`,
    mobile: `1380000000${index}`,
    motto: index === 0 ? '把系统做得让人少看文档' : '',
    gender: GENDERS[index % GENDERS.length] ?? 'unknown',
    status: 'enable',
    loginFailure: 0,
    lastLoginTime: ago(index + 1, 9),
    lastLoginIp: `192.168.10.${10 + index}`,
    createTime: ago(120 - index),
    roles: admin.roleIds.map((id) => ({ id, name: roleNameOf(id) })),
    isSuper: admin.roleIds.includes(1),
    operable: index !== 0,
    self: index === 0,
  }));

  const members: UserItem[] = SEED_USERS.map((user, index) => ({
    id: 4 + index,
    username: user.username,
    departmentId: user.departmentId,
    departmentName: departmentNameOf(user.departmentId),
    nickname: user.nickname,
    avatar: AVATAR,
    email: user.email,
    mobile: user.mobile,
    motto: user.motto,
    gender: GENDERS[(index + 1) % GENDERS.length] ?? 'unknown',
    status: user.status,
    loginFailure: user.status === 'disable' ? 3 : 0,
    lastLoginTime: user.lastLoginDaysAgo === undefined ? 0 : ago(user.lastLoginDaysAgo, 10),
    lastLoginIp: user.lastLoginDaysAgo === undefined ? '' : `192.168.20.${20 + index}`,
    createTime: ago(90 - index, 14),
    roles: [{ id: 3, name: '普通用户' }],
    isSuper: false,
    operable: true,
    self: false,
  }));

  return [...admins, ...members];
}

export function buildRoles(users: readonly UserItem[]): RoleItem[] {
  const allRuleIds = SEED_RULES.map((rule) => rule.id);
  return SEED_ROLES.map((role) => {
    const isSuper = role.code === 'super';
    return {
      id: role.id,
      pid: role.pid,
      name: role.name,
      code: role.code,
      rules: role.rules === '*' ? allRuleIds : [...role.rules],
      isSuper,
      status: 1,
      memberCount: users.filter((user) => user.roles.some((item) => item.id === role.id)).length,
      assignable: !isSuper,
      createTime: ago(120),
      updateTime: ago(20),
    };
  });
}

export function buildDepartments(users: readonly UserItem[]): DepartmentItem[] {
  return SEED_DEPARTMENTS.map((dept) => ({
    id: dept.id,
    pid: dept.pid,
    name: dept.name,
    leader: dept.leader,
    phone: dept.phone,
    weigh: dept.weigh,
    status: 1,
    userCount: users.filter((user) => user.departmentId === dept.id).length,
    createTime: ago(120),
    updateTime: ago(30),
  }));
}

// --- 公告 ------------------------------------------------------------------

interface NoticeSeed {
  title: string;
  category: NoticeItem['category'];
  content: string;
  daysAgo: number;
  isTop: number;
  status: number;
  /** 0 = 已发布；> 0 = 定时中（从现在起 N 天后发） */
  publishInDays?: number;
}

const NOTICE_SEEDS: readonly NoticeSeed[] = [
  {
    title: 'Nomi Admin v2.4 发布：新增在线用户与操作日志看板',
    category: 'bulletin',
    daysAgo: 1,
    isTop: 1,
    status: 1,
    content:
      '<p>本次更新主要包含三块内容：</p><ul><li>系统监控新增「在线用户」，支持查看终端、IP 归属地与最后活跃时间，并可就地强退；</li><li>操作日志支持按模块、状态筛选，展开行可看完整请求/响应报文；</li><li>用户管理左侧部门树改为按数据范围加载。</li></ul><p>升级方式：拉取最新代码后执行 <code>pnpm install &amp;&amp; pnpm build</code>，重启服务即可，无需手工迁移。</p>',
  },
  {
    title: '关于本周六凌晨系统维护的通知',
    category: 'notice',
    daysAgo: 2,
    isTop: 1,
    status: 1,
    content:
      '<p>为配合机房网络割接，系统将于本周六 02:00 - 04:00 进行维护。期间登录、上传与消息推送不可用，已登录用户的会话会被保留，维护结束后无需重新登录。</p><p>如维护窗口有变，会在此公告下更新。</p>',
  },
  {
    title: '账号安全提醒：请及时更换初始密码',
    category: 'notice',
    daysAgo: 3,
    isTop: 0,
    status: 1,
    content:
      '<p>近期发现有账号仍在使用初始化密码 <code>123456</code>。请在「个人中心 → 安全设置」中修改，并开启二次验证。</p>',
  },
  {
    title: '市场运营中心 Q4 活动排期',
    category: 'activity',
    daysAgo: 5,
    isTop: 0,
    status: 1,
    content:
      '<p>Q4 共安排三场活动，分别为 11 月品牌日、12 月年终盘点与 1 月新春预热，各小组排期见附件表格。</p>',
  },
  {
    title: '前端组组件库迁移进度同步',
    category: 'notice',
    daysAgo: 8,
    isTop: 0,
    status: 1,
    content:
      '<p>组件前缀已统一为 <code>Nomi*</code>，旧的 <code>art-*</code> 组件在下一个大版本移除，请各位留意自己的分支。</p>',
  },
  {
    title: '关于规范接口返回结构的说明',
    category: 'bulletin',
    daysAgo: 12,
    isTop: 0,
    status: 1,
    content:
      '<p>所有接口统一返回 <code>{ code, msg, data }</code>，HTTP 状态码恒为 200；<code>code</code> 为 200 表示成功，303 表示未登录，409 表示令牌过期。</p>',
  },
  {
    title: '年终绩效自评入口开放',
    category: 'activity',
    daysAgo: 15,
    isTop: 0,
    status: 1,
    content: '<p>自评入口开放至下月底，提交后可在个人中心查看进度。</p>',
  },
  {
    title: '数据库慢查询治理专项（进行中）',
    category: 'notice',
    daysAgo: 20,
    isTop: 0,
    status: 0,
    content: '<p>本周已清理 12 条超过 500ms 的查询，剩余 3 条待优化，涉及操作日志与在线会话两张表。</p>',
  },
  {
    title: '新同事入职指引已更新',
    category: 'notice',
    daysAgo: 25,
    isTop: 0,
    status: 1,
    content: '<p>入职指引补充了本地开发环境的启动步骤与常见问题。</p>',
  },
  {
    title: '关于开展信息安全培训的通知（定时发布）',
    category: 'activity',
    daysAgo: 0,
    publishInDays: 3,
    isTop: 0,
    status: 1,
    content: '<p>培训定于下周三下午，线上会议链接届时在公告内更新。</p>',
  },
];

export function buildNotices(): NoticeItem[] {
  return NOTICE_SEEDS.map((seed, index) => {
    const publishTime = seed.publishInDays ? now() + seed.publishInDays * DAY : 0;
    return {
      id: 100 + index,
      title: seed.title,
      category: seed.category,
      content: seed.content,
      publishTime,
      isTop: seed.isTop,
      notifyMethod: 'internal',
      notifyScope: 'all',
      scopeIds: [],
      status: seed.status,
      creatorId: 1,
      creatorName: '超级管理员',
      createTime: seed.daysAgo ? ago(seed.daysAgo, 10) : now(),
      updateTime: seed.daysAgo ? ago(seed.daysAgo, 11) : now(),
      published: publishTime === 0 || publishTime <= now(),
    };
  });
}

// --- 日志 / 会话 ------------------------------------------------------------

/** 日志的标题与 URL 取自规则表，看起来才像这套系统自己产生的记录。 */
function logTargets(rules: readonly AdminRule[]): Array<{ title: string; url: string }> {
  const targets = rules
    .filter((rule) => rule.type === 'button' && rule.path === '')
    .slice(0, 12)
    .map((rule) => ({
      title: rule.name,
      url: `/${rule.name.replaceAll('/', '/')}`.replace('//', '/'),
    }));
  return targets.length > 0 ? targets : [{ title: 'system/user/add', url: '/admin/users/add' }];
}

const IPS = ['192.168.10.11', '192.168.20.24', '10.8.4.90', '10.8.4.121', '172.16.3.8'];
const BROWSERS = ['Chrome 128', 'Edge 128', 'Safari 18', 'Firefox 130'];
const SYSTEMS = ['Windows 11', 'macOS 15', 'Ubuntu 24.04', 'iOS 18'];
const LOCATIONS = ['北京市', '上海市', '深圳市', '杭州市', '成都市'];

export function buildAdminLogs(users: readonly UserItem[], rules: readonly AdminRule[]): AdminLogItem[] {
  const targets = logTargets(rules);
  return Array.from({ length: 46 }, (_, index) => {
    const user = users[index % users.length];
    const target = targets[index % targets.length] ?? targets[0];
    return {
      id: 1000 + index,
      user_id: user?.id ?? 1,
      username: user?.username ?? 'super',
      url: target?.url ?? '/admin',
      title: target?.title ?? 'system/user/edit',
      data: index % 3 === 0 ? JSON.stringify({ id: index + 1, status: 'enable' }) : null,
      ip: IPS[index % IPS.length] ?? '127.0.0.1',
      useragent: (BROWSERS[index % BROWSERS.length] ?? 'Chrome') + ' / ' + (SYSTEMS[index % SYSTEMS.length] ?? 'Windows'),
      create_time: ago(index, 8 + (index % 10)),
    };
  });
}

export function buildLoginLogs(users: readonly UserItem[]): LoginLogItem[] {
  const behaviors = ['login', 'login', 'login', 'logout', 'failed', 'locked', 'kick'];
  return Array.from({ length: 38 }, (_, index) => {
    const user = users[index % users.length];
    const behavior = behaviors[index % behaviors.length] ?? 'login';
    return {
      id: 2000 + index,
      user_id: user?.id ?? 1,
      username: user?.username ?? 'super',
      nickname: user?.nickname ?? '超级管理员',
      behavior,
      status: behavior === 'failed' || behavior === 'locked' ? 0 : 1,
      message: behavior === 'failed' ? '密码错误' : behavior === 'locked' ? '连续失败已锁定' : '',
      ip: IPS[index % IPS.length] ?? '127.0.0.1',
      ip_location: LOCATIONS[index % LOCATIONS.length] ?? '北京市',
      browser: BROWSERS[index % BROWSERS.length] ?? 'Chrome 128',
      os: SYSTEMS[index % SYSTEMS.length] ?? 'Windows 11',
      useragent: 'Mozilla/5.0 (demo) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
      create_time: ago(index % 20, 8 + (index % 12)),
    };
  });
}

export function buildOperationLogs(users: readonly UserItem[]): OperationLogItem[] {
  const modules = ['system/user', 'system/role', 'system/rule', 'system/department', 'system/notice', 'system/language', 'system/settings'];
  return Array.from({ length: 42 }, (_, index) => {
    const user = users[index % users.length];
    const module = modules[index % modules.length] ?? 'system/user';
    const failed = index % 7 === 3;
    return {
      id: 3000 + index,
      user_id: user?.id ?? 1,
      username: user?.username ?? 'super',
      url: `/api/admin/${module.replace('/system', '')}/list`,
      title: `${module.replace('/', ' · ')} · 列表查询`,
      module,
      trace_id: `trace-${(3000 + index).toString(16)}-${(index * 37).toString(16)}`,
      status: failed ? 'fail' : 'success',
      duration: failed ? 12 : 8 + ((index * 13) % 120),
      error_msg: failed ? '演示数据：模拟一次业务校验失败' : '',
      ip: IPS[index % IPS.length] ?? '127.0.0.1',
      ip_location: LOCATIONS[index % LOCATIONS.length] ?? '北京市',
      browser: BROWSERS[index % BROWSERS.length] ?? 'Chrome 128',
      os: SYSTEMS[index % SYSTEMS.length] ?? 'Windows 11',
      useragent: 'Mozilla/5.0 (demo) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
      create_time: ago(index % 15, 9 + (index % 9)),
    };
  });
}

export function buildOperationDetail(item: OperationLogItem): OperationLogDetail {
  return {
    ...item,
    data: JSON.stringify({ page: 1, limit: 10, keyword: '' }, null, 2),
    request_headers: JSON.stringify({ batoken: 'demo-token', 'content-type': 'application/json' }, null, 2),
    response_headers: JSON.stringify({ 'content-type': 'application/json; charset=utf-8' }, null, 2),
    response_body: JSON.stringify({ code: 200, msg: '演示数据', data: { list: [], total: 0 } }, null, 2),
  };
}

export function buildSessions(users: readonly UserItem[]): OnlineSession[] {
  return Array.from({ length: 6 }, (_, index) => {
    const user = users[index % users.length];
    const loginTime = now() - (index + 1) * 1800 - index * 400;
    const status: OnlineSession['status'] = index === 5 ? 'away' : index === 4 ? 'expired' : 'online';
    return {
      session_id: `demo-session-${index + 1}`,
      user_id: user?.id ?? 1,
      nickname: user?.nickname ?? '超级管理员',
      username: user?.username ?? 'super',
      ip: IPS[index % IPS.length] ?? '127.0.0.1',
      ip_location: LOCATIONS[index % LOCATIONS.length] ?? '北京市',
      browser: BROWSERS[index % BROWSERS.length] ?? 'Chrome 128',
      os: SYSTEMS[index % SYSTEMS.length] ?? 'Windows 11',
      login_time: loginTime,
      last_active_time: now() - index * 240,
      expire_time: loginTime + 2 * DAY,
      last_refresh_time: loginTime + 3600,
      status,
      is_self: index === 0 ? 1 : 0,
    };
  });
}

// --- 语言 ------------------------------------------------------------------

const ENTRY_SEEDS: ReadonlyArray<{ key: string; module: string; zh: string; en: string }> = [
  { key: 'layout.menu.dashboard', module: 'layout', zh: '控制台', en: 'Dashboard' },
  { key: 'layout.menu.analytics', module: 'layout', zh: '数据分析', en: 'Analytics' },
  { key: 'layout.menu.business', module: 'layout', zh: '业务中心', en: 'Business' },
  { key: 'layout.menu.orders', module: 'layout', zh: '订单管理', en: 'Orders' },
  { key: 'layout.menu.system', module: 'layout', zh: '系统管理', en: 'System' },
  { key: 'layout.menu.users', module: 'layout', zh: '用户管理', en: 'Users' },
  { key: 'layout.menu.roles', module: 'layout', zh: '角色管理', en: 'Roles' },
  { key: 'layout.menu.rules', module: 'layout', zh: '权限节点', en: 'Permissions' },
  { key: 'layout.menu.departments', module: 'layout', zh: '部门管理', en: 'Departments' },
  { key: 'layout.menu.notices', module: 'layout', zh: '通知公告', en: 'Notices' },
  { key: 'layout.menu.languages', module: 'layout', zh: '语言管理', en: 'Languages' },
  { key: 'layout.menu.systemSettings', module: 'layout', zh: '系统配置', en: 'Settings' },
  { key: 'layout.menu.monitor', module: 'layout', zh: '系统监控', en: 'Monitor' },
  { key: 'layout.menu.onlineUsers', module: 'layout', zh: '在线用户', en: 'Online users' },
  { key: 'layout.menu.systemLogs', module: 'layout', zh: '系统日志', en: 'System logs' },
  { key: 'layout.menu.profile', module: 'layout', zh: '个人中心', en: 'Profile' },
  { key: 'auth.action.view', module: 'auth', zh: '查看', en: 'View' },
  { key: 'auth.action.add', module: 'auth', zh: '新增', en: 'Add' },
  { key: 'auth.action.edit', module: 'auth', zh: '编辑', en: 'Edit' },
  { key: 'auth.action.delete', module: 'auth', zh: '删除', en: 'Delete' },
  { key: 'auth.action.status', module: 'auth', zh: '状态', en: 'Status' },
  { key: 'auth.action.sortable', module: 'auth', zh: '排序', en: 'Sort' },
  { key: 'auth.rule.types.menu', module: 'auth', zh: '菜单', en: 'Menu' },
  { key: 'auth.rule.types.menu_dir', module: 'auth', zh: '目录', en: 'Directory' },
  { key: 'auth.rule.types.button', module: 'auth', zh: '按钮', en: 'Button' },
  { key: 'common.confirm', module: 'common', zh: '确定', en: 'Confirm' },
  { key: 'common.cancel', module: 'common', zh: '取消', en: 'Cancel' },
  { key: 'common.save', module: 'common', zh: '保存', en: 'Save' },
  { key: 'common.reset', module: 'common', zh: '重置', en: 'Reset' },
  { key: 'common.search', module: 'common', zh: '搜索', en: 'Search' },
  { key: 'common.loading', module: 'common', zh: '加载中…', en: 'Loading…' },
  { key: 'common.empty', module: 'common', zh: '暂无数据', en: 'No data' },
  { key: 'monitor.online.kick', module: 'monitor', zh: '强制下线', en: 'Force offline' },
  { key: 'monitor.online.online', module: 'monitor', zh: '在线', en: 'Online' },
  { key: 'monitor.online.away', module: 'monitor', zh: '离开', en: 'Away' },
  { key: 'monitor.online.expired', module: 'monitor', zh: '已过期', en: 'Expired' },
];

export function buildLanguages(): LanguageItem[] {
  return SEED_LANGUAGES.map((lang, index) => ({
    id: index + 1,
    code: lang.code,
    name: lang.name,
    nativeName: lang.nativeName,
    weigh: lang.weigh,
    status: 1,
    translated: ENTRY_SEEDS.length,
    isDefault: lang.code === 'zh',
  }));
}

export function buildEntries(): LanguageEntryItem[] {
  return ENTRY_SEEDS.map((entry, index) => ({
    id: 100 + index,
    key: entry.key,
    module: entry.module,
    type: 'system',
    remark: '',
    values: { zh: entry.zh, en: entry.en },
  }));
}

// --- 系统配置 / 个人中心 ----------------------------------------------------

export function buildConfig(): SystemConfig {
  return {
    site: {
      logo: '',
      favicon: '',
      name: 'Nomi Admin',
      description: '基于 Nuxt 4 的企业级中后台模板',
      copyrightEnabled: true,
      copyright: '© 2026 Nomi Admin',
      icp: '京 ICP 备 00000000 号',
    },
    security: {
      loginFailLimit: 5,
      lockMinutes: 30,
      passwordExpireDays: 90,
      passwordExpireRemindDays: 7,
      passwordHistoryLimit: 3,
      passwordMinLength: 8,
      allowPasswordUsername: false,
      requireSpecialChar: true,
    },
    login: {
      // 演示站关掉滑块验证码：静态页没有人机校验接口，留着只会挡住所有访客。
      captchaEnabled: false,
      maintenanceEnabled: false,
      registrationEnabled: true,
    },
    email: {
      enabled: false,
      host: 'smtp.example.com',
      port: 465,
      encryption: 'ssl',
      fromAddress: 'noreply@nomi.dev',
      fromName: 'Nomi Admin',
      username: 'noreply@nomi.dev',
      password: '',
    },
    storage: {
      driver: 'local',
      localDir: 'data/uploads',
      publicUrl: '',
      maxFileSize: 2,
      allowedExtensions: 'png,jpg,jpeg,gif,webp,ico,svg,pdf',
    },
    environment: {
      current: 'production',
      showBadge: false,
      devUrl: 'http://localhost:3000',
      testUrl: 'https://test.nomi.dev',
      prodUrl: 'https://nomi.dev',
    },
    seo: {
      titleTemplate: '%s',
      description: '基于 Nuxt 4 的企业级中后台模板，含权限、组织架构、多语言与系统监控。',
      keywords: 'Nuxt,Admin,中后台,权限管理',
      ogImage: '',
      canonicalBase: '',
      allowIndexing: false,
      ogType: 'website',
    },
  };
}

export function buildProfile(user: UserItem | undefined): SelfProfile {
  const base = user ?? buildUsers()[0];
  return {
    id: base?.id ?? 1,
    username: base?.username ?? 'super',
    nickname: base?.nickname ?? '超级管理员',
    avatar: AVATAR,
    email: base?.email ?? 'super@nomi.dev',
    mobile: base?.mobile ?? '13800000000',
    motto: base?.motto ?? '',
    gender: base?.gender ?? 'unknown',
    status: base?.status ?? 'enable',
    departmentId: base?.departmentId ?? 1,
    departmentName: base?.departmentName ?? '总经办',
    roles: (base?.roles ?? [{ id: 1, name: '超级管理员' }]).map((role) => ({
      id: role.id,
      name: role.name,
    })),
    isSuper: base?.isSuper ?? true,
    createTime: base?.createTime ?? ago(120),
    lastLoginTime: base?.lastLoginTime ?? ago(1),
    lastLoginIp: base?.lastLoginIp ?? '192.168.10.10',
    security: { mobile: true, email: true, password: false },
    thirdParty: { qq: false, wechat: false },
    // 演示站不模拟「初始口令」状态：否则一进后台就被按到改密弹窗上。
    mustChangePassword: false,
  };
}

// --- 汇总 ------------------------------------------------------------------

export interface DemoState {
  rules: AdminRule[];
  roles: RoleItem[];
  departments: DepartmentItem[];
  users: UserItem[];
  notices: NoticeItem[];
  logs: AdminLogItem[];
  loginLogs: LoginLogItem[];
  operationLogs: OperationLogItem[];
  sessions: OnlineSession[];
  languages: LanguageItem[];
  entries: LanguageEntryItem[];
  config: SystemConfig;
  profile: SelfProfile;
  /** 当前登录账号名；登录接口写它，init / profile 读它。 */
  currentUsername: string;
  /** 各表下一个可用 id，避免新增后和种子 id 撞车。 */
  seq: { user: number; role: number; department: number; notice: number; rule: number; language: number; entry: number };
}

export function createDemoState(): DemoState {
  const rules = toRuleRows();
  const users = buildUsers();
  return {
    rules,
    roles: buildRoles(users),
    departments: buildDepartments(users),
    users,
    notices: buildNotices(),
    logs: buildAdminLogs(users, rules),
    loginLogs: buildLoginLogs(users),
    operationLogs: buildOperationLogs(users),
    sessions: buildSessions(users),
    languages: buildLanguages(),
    entries: buildEntries(),
    config: buildConfig(),
    profile: buildProfile(users[0]),
    currentUsername: '',
    seq: {
      user: 100,
      role: 100,
      department: 100,
      notice: 1000,
      rule: 1000,
      language: 100,
      entry: 1000,
    },
  };
}

/** 模块级单例：一次会话内所有请求共享同一份数据（增删改在内存里互相可见）。 */
export const demoState: DemoState = createDemoState();

/** 当前登录人。登录接口会把它指向真正的演示账号，未登录时退回超管。 */
export function currentUser(): UserItem | undefined {
  const { users, currentUsername } = demoState;
  return users.find((user) => user.username === currentUsername) ?? users[0];
}
