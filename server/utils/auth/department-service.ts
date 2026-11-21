/**
 * 部门（组织树）的读写。
 *
 * 部门不决定「能做什么」（那是角色的活），但决定「能看见谁」：
 * 非超管只看本部门及子部门，范围由 department-scope.ts 在服务端推导。
 * 列表接口拿到的 `scope` 就是裁剪依据，前端传的筛选条件不能越过它。
 *
 * 权限集合的包含关系仍然管「能不能操作」（见 data-scope.ts / role-service.ts），
 * 两套判定互不替代：一个管功能，一个管数据。
 *
 * 约束只有三条：不能挂到自己或自己的子孙下面、有子部门不能删、有成员不能删。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';
import {
  collectDepartmentIds,
  departmentScopeCondition,
  type DepartmentScope,
} from './department-scope';

export interface DepartmentItem {
  id: number;
  pid: number;
  name: string;
  leader: string;
  phone: string;
  weigh: number;
  status: number;
  /** 直属成员数 */
  userCount: number;
  createTime: number;
  updateTime: number;
}

interface DepartmentDbRow extends RowDataPacket {
  id: number;
  pid: number;
  name: string;
  leader: string;
  phone: string;
  weigh: number;
  status: number;
  create_time: number;
  update_time: number;
}

export async function listDepartmentRows(): Promise<DepartmentDbRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<DepartmentDbRow[]>(
    'SELECT `id`,`pid`,`name`,`leader`,`phone`,`weigh`,`status`,`create_time`,`update_time` FROM `department` ORDER BY `weigh` DESC, `id` ASC',
  );
  return rows;
}

export async function getDepartmentRow(id: number): Promise<DepartmentDbRow | undefined> {
  const pool = getPool();
  const [rows] = await pool.query<DepartmentDbRow[]>(
    'SELECT `id`,`pid`,`name`,`leader`,`phone`,`weigh`,`status`,`create_time`,`update_time` FROM `department` WHERE `id` = ? LIMIT 1',
    [id],
  );
  return rows[0];
}

/**
 * 每个部门的直属人数。一次 GROUP BY，避免列表接口 N+1。
 * 带上数据范围后，人数也只统计范围内的账号 —— 否则会把范围外的人
 * 「算进数字但不显示在列表里」。
 */
async function getUserCounts(scope: DepartmentScope | null): Promise<Map<number, number>> {
  const condition = scope ? departmentScopeCondition(scope) : null;
  const where = ['`department_id` > 0'];
  const params: unknown[] = [];
  if (condition) {
    where.push(condition.clause);
    params.push(...condition.params);
  }
  const pool = getPool();
  const [rows] = await pool.query<Array<{ department_id: number; total: number } & RowDataPacket>>(
    `SELECT \`department_id\`, COUNT(*) AS \`total\` FROM \`user\` WHERE ${where.join(' AND ')} GROUP BY \`department_id\``,
    params,
  );
  return new Map(rows.map((row) => [Number(row.department_id), Number(row.total)]));
}

/**
 * 部门列表。`scope` 非 null 时只返回范围内的部门（超管传 null 或不限范围）。
 * 父级不在结果里的节点由前端按顶级渲染，正好让非超管看到「以自己部门为根」的树。
 */
export async function listDepartments(scope: DepartmentScope | null = null): Promise<DepartmentItem[]> {
  const [rows, counts] = await Promise.all([listDepartmentRows(), getUserCounts(scope)]);
  const visible = scope?.departmentIds ?? null;
  return rows
    .filter((row) => visible === null || visible.includes(row.id))
    .map((row) => ({
      id: row.id,
      pid: row.pid,
      name: row.name,
      leader: row.leader,
      phone: row.phone,
      weigh: Number(row.weigh ?? 0),
      status: row.status,
      userCount: counts.get(row.id) ?? 0,
      createTime: row.create_time,
      updateTime: row.update_time,
    }));
}

/** 登录页用：只下发启用部门的 id/pid/name —— 免登录接口不该多给一个字段。 */
export async function listEnabledDepartments(): Promise<
  Array<{ id: number; pid: number; name: string }>
> {
  const pool = getPool();
  const [rows] = await pool.query<
    Array<{ id: number; pid: number; name: string } & RowDataPacket>
  >(
    'SELECT `id`,`pid`,`name` FROM `department` WHERE `status` = 1 ORDER BY `weigh` DESC, `id` ASC',
  );
  return rows.map((row) => ({ id: row.id, pid: row.pid, name: row.name }));
}

/**
 * 顶级部门（`pid = 0`）的状态锁：返回最终应该写进库的 status。
 *
 * 根节点是整棵组织树的入口。停用它之后，登录页的部门下拉
 * （`listEnabledDepartments`）和用户管理左侧树都会整棵消失，子部门即便还启用
 * 也不可达 —— 这比「某个子部门停用」严重得多，所以顶级部门一律启用。
 *
 * 判定同时看「提交后的 pid」和「原来的 pid」，堵住三种绕法：
 *   · 新建顶级部门时直接传 `status=0`；
 *   · 把子部门提升成顶级的同时顺手停用；
 *   · 把原本顶级的部门改挂到别处并顺手停用（否则两次编辑就能把根停掉）。
 *
 * 明确提交停用会抛 `ApiError`，好让前端拿到可读提示；其余情况静默锁成 1。
 * 调用方直接用返回值写 SQL，别再把 `input.status` 拼回去。
 */
export function lockRootDepartmentStatus(
  requested: number,
  pid: number,
  existingPid?: number,
): number {
  if (pid !== 0 && existingPid !== 0) return requested === 0 ? 0 : 1;
  if (requested === 0) throw new ApiError('顶级部门不能停用');
  return 1;
}

export interface DepartmentInput {
  name: string;
  pid: number;
  leader: string;
  phone: string;
  weigh: number;
  status: number;
}

/** id 的整棵子树（含自己）。复用部门范围的递归，脏数据成环也不会打挂请求。 */
function collectSubtree(
  rows: ReadonlyArray<{ id: number; pid: number }>,
  rootId: number,
): Set<number> {
  return new Set(collectDepartmentIds(rows, rootId));
}

export async function normalizeDepartmentInput(
  raw: unknown,
  options: { selfId?: number } = {},
): Promise<DepartmentInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ApiError('部门名称不能为空');
  if (name.length > 100) throw new ApiError('部门名称过长');

  const pidRaw = Number(body.pid ?? 0);
  const pid = Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : 0;
  const rows = await listDepartmentRows();

  if (pid > 0) {
    if (!rows.some((row) => row.id === pid)) throw new ApiError('上级部门不存在');
    // 自己或自己的子孙都不能当上级：否则这棵树会在渲染时变成环。
    if (options.selfId && collectSubtree(rows, options.selfId).has(pid)) {
      throw new ApiError('上级部门不能是自己或自己的下级');
    }
  }

  const weighRaw = Number(body.weigh ?? 0);
  const weigh = Number.isFinite(weighRaw) ? Math.trunc(weighRaw) : 0;
  const leader = typeof body.leader === 'string' ? body.leader.trim().slice(0, 50) : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : '';
  const status = body.status === 0 || body.status === false || body.status === '0' ? 0 : 1;

  return { name, pid, leader, phone, weigh, status };
}

/**
 * 顶级部门（`pid = 0`）不可删除。
 *
 * 根节点撑着整棵组织树：删掉它之后，所有子部门的 `pid` 会指向一个不存在的上级，
 * 用户管理左侧树和登录页下拉都会把它们当成新的根，组织架构当场散架。
 * 单独抽成纯函数是为了不连库也能测，且让「删之前必须先拦」这件事没法被绕过。
 */
export function assertRootDepartmentDeletable(pid: number): void {
  if (pid === 0) throw new ApiError('顶级部门不能删除');
}

/** 删除前的检查：顶级、有下级、有成员都不许删，避免出现孤儿部门与无归属的账号。 */
export async function assertDepartmentDeletable(
  row: { id: number; pid: number },
): Promise<void> {
  assertRootDepartmentDeletable(row.pid);

  const pool = getPool();
  const [children] = await pool.query<Array<{ id: number } & RowDataPacket>>(
    'SELECT `id` FROM `department` WHERE `pid` = ? LIMIT 1',
    [row.id],
  );
  if (children.length > 0) throw new ApiError('该部门下还有子部门，请先删除子部门');

  const [users] = await pool.query<Array<{ total: number } & RowDataPacket>>(
    'SELECT COUNT(*) AS total FROM `user` WHERE `department_id` = ?',
    [row.id],
  );
  if (Number(users[0]?.total ?? 0) > 0) throw new ApiError('该部门下还有成员，请先调整成员所属部门');
}
