/**
 * 权限判定内核（对应 docs/权限系统设计.md 第 5 章 `extend/ba/Auth.php`）。
 *
 * 核心约定原样保留：
 *   · 权限节点 = `permission_rule` 的一行，`name` 是标识（如 `system/role/add`）；
 *   · 角色 `role.rules` = `'*'` 或逗号串；`'*'` 是超管哨兵；
 *   · 判定 = 「我拥有的规则名集合」是否包含待验节点名，大小写不敏感；
 *   · 超管直通发生在任何比对之前，所以新增节点天然对超管生效。
 *
 * 与文档的差异只有性能：文档每次 `check()` 都重新查一遍分组与规则（6–8 次 SQL），
 * 这里把「账号 → 角色 → 节点」一次算成 AdminContext，请求内复用。
 * 语义完全一致，只是把 N 次查询压成 2 次。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';

export type RuleType = 'menu_dir' | 'menu' | 'button';

export interface AdminRow extends RowDataPacket {
  id: number;
  username: string;
  /** 所属部门 department.id，0 = 未分配 */
  department_id: number;
  nickname: string;
  avatar: string;
  email: string;
  mobile: string;
  motto: string;
  status: string;
  login_failure: number;
  /** 1 = 首次登录必须改密（初始口令 / 管理员重置的口令） */
  must_change_password?: number;
  last_login_time: number;
  last_login_ip: string;
}

export interface RoleRow extends RowDataPacket {
  id: number;
  pid: number;
  name: string;
  rules: string;
  status: number;
}

export interface RuleRow extends RowDataPacket {
  id: number;
  pid: number;
  type: RuleType;
  title: string;
  name: string;
  path: string;
  icon: string;
  menu_type: string;
  url: string;
  component: string;
  keepalive: number;
  extend: string;
  remark: string;
  weigh: number;
  status: number;
}

export interface MenuNode {
  id: number;
  name: string;
  title: string;
  path: string;
  icon: string;
  type: RuleType;
  keepalive: number;
  children: MenuNode[];
}

export interface AdminContext {
  admin: AdminRow;
  token: string;
  roles: RoleRow[];
  /** `['*']` 或数字 id 字符串数组 */
  ruleIds: string[];
  isSuper: boolean;
  /** 小写后的节点名，`check()` 的唯一依据 */
  ruleNames: Set<string>;
  /** 有权且启用的节点记录（菜单树、authNode、授权树都从这里派生） */
  rules: RuleRow[];
  /** 登录时所选部门，本次会话的数据范围根；0 = 未选，退回账号所属部门 */
  scopeDepartmentId: number;
  /**
   * 是否必须先改密。来自 `user.must_change_password`，由守卫统一拦截：
   * 放在上下文里而不是各接口自己查，是为了「漏掉一个接口」不会变成一条绕过路径。
   */
  mustChangePassword: boolean;
}

/** `'1, 21,22'` → `['1','21','22']`；`'*'` 原样保留。 */
export function parseRules(rules: string | null | undefined): string[] {
  const value = (rules ?? '').trim();
  if (!value) return [];
  if (value === '*') return ['*'];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 角色的规则串 → 去重后的 id 数组（`'*'` 返回空数组，调用方用 isSuper 判断）。 */
export function ruleIdsToNumbers(ids: readonly string[]): number[] {
  return [...new Set(ids.filter((id) => id !== '*').map((id) => Number.parseInt(id, 10)))].filter(
    (id) => Number.isFinite(id) && id > 0,
  );
}

/** 读账号所属的启用角色。多角色取并集，与文档 `getGroups()` 的 JOIN + status=1 等价。 */
export async function getAdminRoles(adminId: number): Promise<RoleRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<RoleRow[]>(
    `SELECT r.\`id\`, r.\`pid\`, r.\`name\`, r.\`rules\`, r.\`status\`
       FROM \`role\` r
       INNER JOIN \`user_role\` ur ON ur.\`role_id\` = r.\`id\`
      WHERE ur.\`user_id\` = ? AND r.\`status\` = 1
      ORDER BY r.\`id\` ASC`,
    [adminId],
  );
  return rows;
}

/** 取启用节点；ids 为空时返回空数组（无权的人不该拿到任何节点）。 */
export async function getRulesByIds(ids: number[]): Promise<RuleRow[]> {
  if (ids.length === 0) return [];
  const pool = getPool();
  const [rows] = await pool.query<RuleRow[]>(
    `SELECT * FROM \`permission_rule\` WHERE \`status\` = 1 AND \`id\` IN (?) ORDER BY \`weigh\` DESC, \`id\` ASC`,
    [ids],
  );
  return rows;
}

export async function getAllEnabledRules(): Promise<RuleRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<RuleRow[]>(
    'SELECT * FROM `permission_rule` WHERE `status` = 1 ORDER BY `weigh` DESC, `id` ASC',
  );
  return rows;
}

/**
 * 组装请求级上下文。
 *
 * ★ 超管绕过第一处：`rules` 取全表，而不是「把所有 id 查出来」——
 * 这样未来新增节点不需要给超管组补授权。
 */
export async function loadAdminContext(
  admin: AdminRow,
  token: string,
  scopeDepartmentId = 0,
): Promise<AdminContext> {
  const roles = await getAdminRoles(admin.id);
  const ruleIds = [...new Set(roles.flatMap((role) => parseRules(role.rules)))];

  // ★ 超管判定：`'*'` 在规则 id 集合里，而不是某个 is_super 字段。
  const isSuper = ruleIds.includes('*');
  const rules = isSuper ? await getAllEnabledRules() : await getRulesByIds(ruleIdsToNumbers(ruleIds));

  const ruleNames = new Set(rules.map((rule) => rule.name.toLowerCase()));
  if (isSuper) ruleNames.add('*');

  return {
    admin,
    token,
    roles,
    ruleIds,
    isSuper,
    ruleNames,
    rules,
    scopeDepartmentId,
    mustChangePassword: Number(admin.must_change_password ?? 0) === 1,
  };
}

/**
 * 权限判定。`name` 支持逗号分隔多个节点；`relation` 为 `and` 时要求全部命中。
 *
 * 文档 5.7 的 `url` 模式（节点名带 `?status=1` 做参数级权限）没有移植：
 * 本项目的接口鉴权在 handler 里显式传节点名，参数级条件用业务代码表达更直观。
 */
export function check(context: AdminContext, name: string, relation: 'or' | 'and' = 'or'): boolean {
  if (context.ruleNames.has('*')) return true; // ★ 超管直通
  const wanted = name
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) return false;

  if (relation === 'and') return wanted.every((item) => context.ruleNames.has(item));
  return wanted.some((item) => context.ruleNames.has(item));
}

/** 账号是否拥有某个节点（供业务代码判断「能不能操作这个角色」）。 */
export function hasRule(context: AdminContext, name: string): boolean {
  return context.isSuper || context.ruleNames.has(name.toLowerCase());
}

/**
 * 规则树 → 菜单树。只保留 menu_dir / menu，按 weigh 倒序 + id 正序，
 * 空目录直接丢弃（前端点进去是 404，不如不显示）。
 *
 * 另有一份「不进菜单但仍是页面」的路径清单：个人中心的入口只在顶栏用户下拉框，
 * 菜单里再放一份等于凭空多出一个业务模块。节点本身保留在 `permission_rule` 里
 * （它仍是一个权限节点，菜单管理页能看到、能授权），只是不下发到菜单树。
 */
export const HIDDEN_MENU_PATHS: ReadonlySet<string> = new Set(['/admin/profile']);

export function buildMenuTree(rules: readonly RuleRow[]): MenuNode[] {
  const nodes = new Map<number, MenuNode>();
  for (const rule of rules) {
    if (rule.type === 'button' || HIDDEN_MENU_PATHS.has(rule.path)) continue;
    nodes.set(rule.id, {
      id: rule.id,
      name: rule.name,
      title: rule.title,
      path: rule.path,
      icon: rule.icon,
      type: rule.type,
      keepalive: rule.keepalive,
      children: [],
    });
  }

  const roots: MenuNode[] = [];
  for (const rule of rules) {
    if (rule.type === 'button') continue;
    const node = nodes.get(rule.id);
    if (!node) continue;
    const parent = nodes.get(rule.pid);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: MenuNode[]): void => {
    list.sort((a, b) => {
      const wa = rules.find((rule) => rule.id === a.id)?.weigh ?? 0;
      const wb = rules.find((rule) => rule.id === b.id)?.weigh ?? 0;
      return wb - wa || a.id - b.id;
    });
    for (const item of list) sort(item.children);
  };
  sort(roots);

  const prune = (list: MenuNode[]): MenuNode[] =>
    list
      .map((item) => ({ ...item, children: prune(item.children) }))
      .filter((item) => item.type === 'menu' || item.children.length > 0);

  return prune(roots);
}

/**
 * `authNode`：父节点名 → 子按钮名数组。
 *
 * 前端 `auth('add')` 的实现是「当前页面的规则名 + '/add'」，在这个 Map 里查。
 * 服务端只下发**该管理员有权**的节点，所以它天然是「显示层」：
 * 没有权限的按钮，前端连名字都拿不到。
 */
export function buildAuthNode(rules: readonly RuleRow[]): Record<string, string[]> {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const authNode: Record<string, string[]> = {};

  for (const rule of rules) {
    if (rule.type !== 'button') continue;
    const parent = byId.get(rule.pid);
    if (!parent) continue;
    const key = parent.name.toLowerCase();
    const list = authNode[key] ?? [];
    list.push(rule.name);
    authNode[key] = list;
  }

  return authNode;
}

/** 扁平节点表（授权树/规则管理页用），带 children 便于前端直接渲染 el-tree。 */
export interface RuleTreeNode extends RuleRow {
  children: RuleTreeNode[];
}

export function buildRuleTree(rules: readonly RuleRow[]): RuleTreeNode[] {
  const nodes = new Map<number, RuleTreeNode>();
  for (const rule of rules) nodes.set(rule.id, { ...rule, children: [] });

  const roots: RuleTreeNode[] = [];
  for (const rule of rules) {
    const node = nodes.get(rule.id);
    if (!node) continue;
    const parent = nodes.get(rule.pid);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: RuleTreeNode[]): void => {
    list.sort((a, b) => b.weigh - a.weigh || a.id - b.id);
    for (const item of list) sort(item.children);
  };
  sort(roots);
  return roots;
}

/**
 * 授权入参的防提权校验（对应文档 7.1 `handleRules()`）：
 *   1. 节点必须存在；
 *   2. 非超管只能分配「自己拥有的节点」—— 一个人能分出去的权限不能超过自己。
 *
 * 返回 `{ ok, ids }` 或 `{ ok: false, msg }`，由调用方决定怎么回包。
 */
export async function sanitizeAssignRules(
  context: AdminContext,
  input: readonly number[],
): Promise<{ ok: true; ids: number[] } | { ok: false; msg: string }> {
  const ids = [...new Set(input.filter((id) => Number.isInteger(id) && id > 0))];

  const pool = getPool();
  const [existing] = await pool.query<Array<{ id: number } & RowDataPacket>>(
    `SELECT \`id\` FROM \`permission_rule\` WHERE \`id\` IN (?)`,
    [ids.length > 0 ? ids : [0]],
  );
  const existingIds = new Set(existing.map((row) => row.id));
  const missing = ids.filter((id) => !existingIds.has(id));
  if (missing.length > 0) {
    return { ok: false, msg: `权限节点不存在：${missing.join(',')}` };
  }

  if (!context.isSuper) {
    const mine = new Set(ruleIdsToNumbers(context.ruleIds));
    const beyond = ids.filter((id) => !mine.has(id));
    if (beyond.length > 0) {
      return { ok: false, msg: '不能分配超出自身权限范围的节点' };
    }
  }

  return { ok: true, ids };
}
