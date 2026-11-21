/**
 * 行级数据权限（对应 docs/权限系统设计.md 第 6 章）。
 *
 * 这里移植的是文档里最反直觉、也最值得保留的那部分：**看权限集合，不看角色 pid**。
 * 理由见文档 1.7：`role.pid` 可以被管理员随手改，但「能分配出去的权限
 * 不超过自己」是硬校验，所以用「权限集合的包含关系」推导上下级是防篡改的。
 *
 * 注意与 `department-scope.ts` 的分工：那个模块是**已接线**的部门数据范围
 * （非超管只看本部门及子部门），管「能看见谁」；这里是基于角色权限集合的
 * 通用白名单工具，管「能操作谁」，目前是未接线的备用能力。两套判定互不替代。
 *
 * 用法（业务列表接口）：
 *   const ids = await getDataLimitAdminIds(ctx, 'allAuthAndOthers');
 *   if (ids.length > 0) {
 *     sql += ' AND `user_id` IN (?)'; params.push(ids);
 *   }
 * `ids` 为空数组 = 不限制（超管或未开启数据权限），这是文档的约定。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { parseRules, ruleIdsToNumbers, type AdminContext } from './rbac';

export type DataLimitMode = false | 'personal' | 'allAuth' | 'allAuthAndOthers' | 'parent' | number;

interface RoleWithRules extends RowDataPacket {
  id: number;
  pid: number;
  name: string;
  rules: string;
}

/** a ⊆ b（都按 id 集合比较）。导出是为了单测能直接覆盖这个判定。 */
export function isRuleSubset(a: readonly number[], b: ReadonlySet<number>): boolean {
  return a.every((id) => b.has(id));
}

/** 权限多寡判定：严格上级 = 子集且还有额外权限（集合更小）。 */
export function isStrictSubset(a: readonly number[], b: ReadonlySet<number>): boolean {
  return isRuleSubset(a, b) && b.size > a.length;
}

async function getAllEnabledRoles(): Promise<RoleWithRules[]> {
  const pool = getPool();
  const [rows] = await pool.query<RoleWithRules[]>(
    'SELECT `id`,`pid`,`name`,`rules` FROM `role` WHERE `status` = 1 ORDER BY `id` ASC',
  );
  return rows;
}

/**
 * 找出「我至少平级」的所有角色。
 *
 * `allAuth`：该角色规则 ⊆ 我的规则；
 * `allAuthAndOthers`：还要严格更少（我还有额外权限），即只算真正的下级。
 * 与文档 6.3.1 的差别：`'*'` 角色直接跳过（除超管外没人能覆盖它）。
 */
export async function getAllAuthRoles(
  context: AdminContext,
  many: 'allAuth' | 'allAuthAndOthers' = 'allAuthAndOthers',
): Promise<RoleWithRules[]> {
  const mine = new Set(ruleIdsToNumbers(context.ruleIds));
  const roles = await getAllEnabledRoles();
  const result: RoleWithRules[] = [];

  for (const role of roles) {
    const ids = parseRules(role.rules);
    if (ids.includes('*')) continue; // 超管角色：非超管永远不该「管得了」它
    const roleIds = ruleIdsToNumbers(ids);
    if (!isRuleSubset(roleIds, mine)) continue;
    if (many === 'allAuthAndOthers' && roleIds.length >= mine.size) continue;
    result.push(role);
  }

  return result;
}

/** 角色 id → 该角色下的账号 id（`user_role` 反查）。 */
export async function getRoleUserIds(roleIds: readonly number[]): Promise<number[]> {
  if (roleIds.length === 0) return [];
  const pool = getPool();
  const [rows] = await pool.query<Array<{ user_id: number } & RowDataPacket>>(
    'SELECT DISTINCT `user_id` FROM `user_role` WHERE `role_id` IN (?)',
    [roleIds],
  );
  return rows.map((row) => row.user_id);
}

/**
 * 我的下级角色（沿 pid 向下递归）。
 *
 * 文档里这个方法服务于 `dataLimit='parent'`：上级能看下级角色里账号的数据。
 * 递归在内存里做：角色数量是两位数级别，为它写递归 CTE 反而不好维护。
 */
export async function getAdminChildRoles(context: AdminContext): Promise<RoleWithRules[]> {
  const roles = await getAllEnabledRoles();
  const mine = new Set(context.roles.map((role) => role.id));
  const children = new Map<number, RoleWithRules[]>();
  for (const role of roles) {
    const siblings = children.get(role.pid) ?? [];
    siblings.push(role);
    children.set(role.pid, siblings);
  }

  const result: RoleWithRules[] = [];
  const seen = new Set<number>();
  const stack = [...mine];
  while (stack.length > 0) {
    const parentId = stack.pop()!;
    for (const child of children.get(parentId) ?? []) {
      if (seen.has(child.id) || mine.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      stack.push(child.id);
    }
  }
  return result;
}

/**
 * 数据权限白名单。**空数组 = 不追加任何 where**（超管、或关闭数据权限）。
 *
 * 模式与文档 6.1 一致：
 *   false              → []
 *   'personal'         → [自己]
 *   'allAuth'          → 权限 ⊆ 我的所有角色的账号
 *   'allAuthAndOthers' → 权限严格更少的角色的账号（真正的下级）
 *   'parent'           → 我的下级角色里的账号
 *   数字                → 指定角色里的账号
 * 所有分支最后都会把自己的 id 加进去（自己的数据永远能看到）。
 */
export async function getDataLimitAdminIds(
  context: AdminContext,
  mode: DataLimitMode,
): Promise<number[]> {
  if (!mode || context.isSuper) return [];

  const adminIds = new Set<number>([context.admin.id]);

  if (mode === 'parent') {
    const roles = await getAdminChildRoles(context);
    for (const id of await getRoleUserIds(roles.map((role) => role.id))) adminIds.add(id);
    return [...adminIds];
  }

  if (typeof mode === 'number') {
    for (const id of await getRoleUserIds([mode])) adminIds.add(id);
    return [...adminIds];
  }

  if (mode === 'allAuth' || mode === 'allAuthAndOthers') {
    const roles = await getAllAuthRoles(context, mode);
    for (const id of await getRoleUserIds(roles.map((role) => role.id))) adminIds.add(id);
    return [...adminIds];
  }

  // 'personal' 与任何未知取值都收敛到「只看自己」—— 这是安全侧的默认值。
  return [...adminIds];
}

/** 把白名单变成一段可拼接的 SQL 片段；返回 null 表示不需要限制。 */
export function dataLimitClause(
  field: string,
  ids: readonly number[],
): { clause: string; params: [number[]] } | null {
  if (ids.length === 0) return null;
  if (!/^[A-Za-z0-9_]+$/.test(field)) throw new Error(`非法的数据权限字段名：${field}`);
  return { clause: `\`${field}\` IN (?)`, params: [ids as number[]] };
}
