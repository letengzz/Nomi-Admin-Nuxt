/**
 * 角色（`role`）的读写与防提权。
 *
 * 文档第 7 章的核心结论落在这里：**一个人能分配的权限不能超过自己**。
 * 所以「能不能编辑/删除某个角色」不是看 pid 层级，而是看
 * 「这个角色的规则集合 ⊆ 我的规则集合」。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';
import {
  resolveDepartmentScope,
  userScopeSubquery,
  type DepartmentScope,
} from './department-scope';
import {
  parseRules,
  ruleIdsToNumbers,
  sanitizeAssignRules,
  type AdminContext,
} from './rbac';

export interface RoleListItem {
  id: number;
  pid: number;
  name: string;
  code: string;
  rules: number[];
  isSuper: boolean;
  status: number;
  memberCount: number;
  /** 当前账号能否编辑/删除它 —— 前端据此隐藏按钮，服务端仍会再校验一次 */
  assignable: boolean;
  createTime: number;
  updateTime: number;
}

interface RoleDbRow extends RowDataPacket {
  id: number;
  pid: number;
  name: string;
  code: string;
  rules: string | null;
  status: number;
  create_time: number;
  update_time: number;
}

export async function listRoleRows(): Promise<RoleDbRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<RoleDbRow[]>(
    'SELECT `id`,`pid`,`name`,`code`,`rules`,`status`,`create_time`,`update_time` FROM `role` ORDER BY `pid` ASC, `id` ASC',
  );
  return rows;
}

export async function getRoleRow(id: number): Promise<RoleDbRow | undefined> {
  const pool = getPool();
  const [rows] = await pool.query<RoleDbRow[]>(
    'SELECT `id`,`pid`,`name`,`code`,`rules`,`status`,`create_time`,`update_time` FROM `role` WHERE `id` = ? LIMIT 1',
    [id],
  );
  return rows[0];
}

/**
 * 角色 → 成员数。单独一次 GROUP BY，避免列表接口变成 N+1。
 *
 * `scope` 只给**列表展示**用：非超管看到的成员数必须和「角色用户」列表里的
 * 人数一致，不能挂着全库数字却只列出本部门的人。删除角色的护栏仍调无参版本，
 * 那里必须看全库 —— 否则会把「还有范围外成员」的角色误判成空角色删掉。
 */
export async function getRoleMemberCounts(
  scope: DepartmentScope | null = null,
): Promise<Map<number, number>> {
  const condition = scope ? userScopeSubquery(scope) : null;
  const where = condition ? `WHERE ${condition.clause}` : '';
  const pool = getPool();
  const [rows] = await pool.query<Array<{ role_id: number; total: number } & RowDataPacket>>(
    `SELECT \`role_id\`, COUNT(*) AS \`total\` FROM \`user_role\` ${where} GROUP BY \`role_id\``,
    condition?.params ?? [],
  );
  return new Map(rows.map((row) => [row.role_id, Number(row.total)]));
}

/**
 * 我能不能操作这个角色。
 * 超管全通；普通账号要求「角色规则 ⊆ 我的规则」，且不能碰 `'*'` 超管角色。
 */
export function canOperateRole(context: AdminContext, role: Pick<RoleDbRow, 'rules'>): boolean {
  if (context.isSuper) return true;
  const rules = parseRules(role.rules);
  if (rules.includes('*')) return false;
  const mine = new Set(ruleIdsToNumbers(context.ruleIds));
  return ruleIdsToNumbers(rules).every((id) => mine.has(id));
}

export function assertRoleOperable(
  context: AdminContext,
  role: RoleDbRow | undefined,
): asserts role {
  if (!role) throw new ApiError('角色不存在');
  if (!canOperateRole(context, role)) {
    throw new ApiError('没有权限操作该角色：它拥有超出你权限范围的节点');
  }
}

export async function listRoles(context: AdminContext): Promise<RoleListItem[]> {
  const scope = await resolveDepartmentScope(context);
  const [rows, counts] = await Promise.all([listRoleRows(), getRoleMemberCounts(scope)]);
  return rows.map((row) => {
    const rules = parseRules(row.rules);
    return {
      id: row.id,
      pid: row.pid,
      name: row.name,
      code: row.code || '',
      rules: ruleIdsToNumbers(rules),
      isSuper: rules.includes('*'),
      status: row.status,
      memberCount: counts.get(row.id) ?? 0,
      assignable: canOperateRole(context, row),
      createTime: row.create_time,
      updateTime: row.update_time,
    };
  });
}

/** 可分配的角色（新建/编辑账号时的下拉）。 */
export async function listAssignableRoles(
  context: AdminContext,
): Promise<Array<{ id: number; name: string; pid: number }>> {
  const rows = await listRoleRows();
  return rows
    .filter((row) => row.status === 1 && canOperateRole(context, row))
    .map((row) => ({ id: row.id, name: row.name, pid: row.pid }));
}

export interface RoleInput {
  name: string;
  code: string;
  pid: number;
  status: number;
  rules: number[];
}

/**
 * 角色编码的约束：只认 ASCII 字母/数字/下划线/中划线，小写归一。
 *
 * 编码是给代码与配置引用的（`isSuperRole(code)` 这类判断），不是给人读的展示名，
 * 所以不允许空格、中文、大小写混用 —— 否则「同一个角色有两个写法」迟早会出事。
 */
export function normalizeRoleCode(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return '';
  if (!/^[a-z0-9_-]{2,50}$/.test(value)) {
    throw new ApiError('角色编码只能是 2-50 位字母、数字、下划线或中划线');
  }
  return value;
}

/** 编码唯一（编辑时排除自己）；空编码不占位，允许多个角色先不填。 */
export async function assertRoleCodeAvailable(code: string, excludeId = 0): Promise<void> {
  if (!code) return;
  const pool = getPool();
  const [rows] = await pool.query<Array<{ id: number } & RowDataPacket>>(
    'SELECT `id` FROM `role` WHERE `code` = ? AND `id` <> ? LIMIT 1',
    [code, excludeId],
  );
  if (rows.length > 0) throw new ApiError('角色编码已被其他角色使用');
}

/** 入参规范化 + 防提权。所有写接口都先过这里，避免三处各写一遍校验。 */
export async function normalizeRoleInput(
  context: AdminContext,
  raw: unknown,
): Promise<RoleInput & { rulesText: string }> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ApiError('角色名称不能为空');
  if (name.length > 100) throw new ApiError('角色名称过长');

  const code = normalizeRoleCode(body.code);

  const pidRaw = Number(body.pid ?? 0);
  const pid = Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : 0;
  if (pid > 0) {
    const parent = await getRoleRow(pid);
    if (!parent) throw new ApiError('上级角色不存在');
  }

  const status = body.status === 0 || body.status === false || body.status === '0' ? 0 : 1;

  const rawRules = Array.isArray(body.rules) ? body.rules : [];
  const numbers = rawRules.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  const sanitized = await sanitizeAssignRules(context, numbers);
  if (!sanitized.ok) throw new ApiError(sanitized.msg);

  return {
    name,
    code,
    pid,
    status,
    rules: sanitized.ids,
    rulesText: sanitized.ids.join(','),
  };
}

/** 删除节点/删除角色时的授权补偿：把某个 id 从所有角色的 rules 串里剔除。 */
export async function stripRuleIdsFromRoles(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const pool = getPool();
  const roles = await listRoleRows();
  const drop = new Set(ids);
  for (const role of roles) {
    const current = parseRules(role.rules);
    if (current.includes('*')) continue;
    const next = ruleIdsToNumbers(current).filter((id) => !drop.has(id));
    if (next.length === ruleIdsToNumbers(current).length) continue;
    await pool.query('UPDATE `role` SET `rules` = ?, `update_time` = ? WHERE `id` = ?', [
      next.join(','),
      Math.floor(Date.now() / 1000),
      role.id,
    ]);
  }
}
