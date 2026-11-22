/**
 * 部门数据范围（Data Scope）。
 *
 * 权限节点回答「能不能进这个页面/点这个按钮」，部门回答「进来之后能看见谁」：
 *   · 超级管理员（`rules='*'`）：不限，看全库；
 *   · 其他账号：只看**自己所属部门 + 它的所有子部门**；
 *   · 没有分配部门：只看自己，避免「无部门」变成「看全部」的后门。
 *
 * 范围一律由服务端从 `AdminContext.admin.department_id` 推导，前端传什么
 * `departmentId` 都只是**筛选条件**，不能扩大范围。这是唯一真源，别在页面里
 * 另算一份：前端算的能被改请求绕过，服务端算的不能。
 *
 * 部门表只有 `pid`，没有 path/level。子树在内存里递归（几十行配置数据），
 * 比 WITH RECURSIVE 好读也好测；递归带 seen，脏数据成环也不会把请求打挂。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';
import type { AdminContext } from './rbac';

export interface DepartmentScopeNode {
  id: number;
  pid: number;
}

/** 某部门 + 它所有子部门的 id（含自己）。rootId 不在表里时返回空数组。 */
export function collectDepartmentIds(
  departments: ReadonlyArray<DepartmentScopeNode>,
  rootId: number,
): number[] {
  if (!Number.isInteger(rootId) || rootId <= 0) return [];

  const existing = new Set(departments.map((dept) => Number(dept.id)));
  if (!existing.has(rootId)) return [];

  const children = new Map<number, number[]>();
  for (const dept of departments) {
    const pid = Number(dept.pid);
    const list = children.get(pid) ?? [];
    list.push(Number(dept.id));
    children.set(pid, list);
  }

  // 广度优先（队列而不是栈）：id 顺序稳定，SQL 与单测都不受遍历次序影响。
  const result: number[] = [];
  const seen = new Set<number>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return result;
}

export interface DepartmentScope {
  /** null = 不限制（超管）；数组 = 可见部门 id 集合 */
  departmentIds: number[] | null;
  /** 当前登录账号 id：部门被调整或没分配部门时，自己也始终可见 */
  selfId: number;
}

export interface ScopeIdentity {
  isSuper: boolean;
  adminId: number;
  departmentId: number;
  /** 登录所选部门（范围根）；0 / 缺省 = 退回账号所属部门 */
  scopeDepartmentId?: number;
}

/**
 * 纯函数：不连库即可推导范围，也是单测覆盖的入口。
 *
 * 范围根优先取登录时所选部门 —— 这样账号属技术中心、登录选了前端组的人，
 * 进来只看前端组；没选部门（老会话 / API 直连）才退回账号所属部门。
 */
export function buildDepartmentScope(
  identity: ScopeIdentity,
  departments: ReadonlyArray<DepartmentScopeNode>,
): DepartmentScope {
  if (identity.isSuper) return { departmentIds: null, selfId: identity.adminId };
  const rootId = Number(identity.scopeDepartmentId) || Number(identity.departmentId) || 0;
  return {
    departmentIds: collectDepartmentIds(departments, rootId),
    selfId: identity.adminId,
  };
}

/** 从登录上下文解析范围。超管不查库，直接返回「不限」。 */
export async function resolveDepartmentScope(context: AdminContext): Promise<DepartmentScope> {
  const identity: ScopeIdentity = {
    isSuper: context.isSuper,
    adminId: Number(context.admin.id),
    departmentId: Number(context.admin.department_id ?? 0),
    scopeDepartmentId: Number(context.scopeDepartmentId) || 0,
  };
  if (identity.isSuper) return buildDepartmentScope(identity, []);

  const pool = getPool();
  const [rows] = await pool.query<Array<{ id: number; pid: number } & RowDataPacket>>(
    'SELECT `id`,`pid` FROM `department`',
  );
  return buildDepartmentScope(identity, rows);
}

/** 这个部门能不能出现在我的树里 / 能不能被我指定为筛选条件。 */
export function isDepartmentVisible(scope: DepartmentScope, departmentId: number): boolean {
  return scope.departmentIds === null || scope.departmentIds.includes(Number(departmentId));
}

/**
 * 登录闸门：所选部门是否落在「账号所属部门 + 其下级部门」内。
 *
 * 方向是「所选 ⊆ 账号」，不是反过来：
 *   · 账号通不通过密码，本来就已确定「他是谁、属于哪个部门」；
 *   · 登录页让他选部门，是在自己的范围内**挑选本次要看哪一块**（可下沉到下级小组），
 *     不是让他选一个更大的部门来放大可见范围。
 * 所以 admin（技术中心 2）可以选前端组 3，但选不了市场运营中心 8；
 * 反过来「账号 ⊆ 所选」会让前端组的人靠选技术中心把自己升权，不能要。
 *
 * 与 buildDepartmentScope 的区别：那个算「登录后的可见范围」（超管不限），
 * 这个是「能不能登录」—— 按账号部门树判定，超管也要选对部门，
 * 否则等于给了一个用超管账号绕过部门选择的后门。
 * 抽成纯函数便于单测，不连库。
 */
export function isLoginDepartmentAllowed(
  userDepartmentId: number,
  selectedDepartmentId: number,
  departments: ReadonlyArray<DepartmentScopeNode>,
): boolean {
  const accountSubtree = collectDepartmentIds(departments, Number(userDepartmentId) || 0);
  return accountSubtree.includes(Number(selectedDepartmentId) || 0);
}

/** 这个账号在不在我的可见范围内（自己永远可见）。 */
export function isUserVisible(
  scope: DepartmentScope,
  user: { id: number; departmentId: number },
): boolean {
  // 超管的 departmentIds 是 null（不限），必须显式放行：
  // 写成 `scope.departmentIds !== null && ...` 会把超管的所有写操作全拦掉。
  if (scope.departmentIds === null) return true;
  if (Number(user.id) === scope.selfId) return true;
  return scope.departmentIds.includes(Number(user.departmentId));
}

/** 写操作护栏：目标部门不在范围内直接拒绝。纯函数，方便单测。 */
export function assertDepartmentScopeAllows(scope: DepartmentScope, departmentId: number): void {
  if (!isDepartmentVisible(scope, departmentId)) {
    throw new ApiError('只能管理本部门及下级部门的数据');
  }
}

/**
 * 账号能不能被放到这个部门。用于新建与编辑的资料校验。
 *
 * 非超管不能新建「未分配」账号，也不能把人调成未分配：那样人会从自己的
 * 可见范围里消失。唯一例外是**本来就无部门的本人**改资料时保留 0，
 * 否则他连改个昵称都会被要求先选一个自己并不属于的部门。
 */
export function assertDepartmentAssignable(
  scope: DepartmentScope,
  departmentId: number,
  target?: { id: number; departmentId: number },
): void {
  if (departmentId === 0) {
    if (scope.departmentIds === null) return; // 超管允许留空
    if (target && target.id === scope.selfId && Number(target.departmentId) === 0) return;
    throw new ApiError('请选择本部门或下级部门');
  }
  if (!isDepartmentVisible(scope, departmentId)) {
    throw new ApiError('只能把账号分配到本部门或下级部门');
  }
}

export interface ScopeCondition {
  clause: string;
  params: unknown[];
}

function quoteField(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`非法的数据范围字段名：${name}`);
  return `\`${name}\``;
}

/**
 * 「可见账号」条件，用于 `user` 表本身。
 *
 * 超管返回 null（不加 where）；有部门时是「部门在范围内 **或** 自己」，
 * 没部门时退化成「只有自己」。带上自己是有意的：账号被调到别的部门、
 * 或部门被删掉之后，本人不该从列表里消失。
 */
export function userScopeCondition(
  scope: DepartmentScope,
  options: { departmentField?: string; selfField?: string } = {},
): ScopeCondition | null {
  if (scope.departmentIds === null) return null;
  const department = quoteField(options.departmentField ?? 'department_id');
  const self = quoteField(options.selfField ?? 'id');
  if (scope.departmentIds.length === 0) {
    return { clause: `${self} = ?`, params: [scope.selfId] };
  }
  return {
    clause: `(${department} IN (?) OR ${self} = ?)`,
    params: [scope.departmentIds, scope.selfId],
  };
}

/**
 * 「可见部门成员」条件：只按部门、**不含自己兜底**。
 *
 * 用于「全部部门人数」「部门直属人数」「角色成员数」这类统计：
 * 它们必须和部门树里各节点人数相加对得上，混进一个未分配部门的自己会让数字不一致。
 */
export function departmentScopeCondition(
  scope: DepartmentScope,
  departmentField = 'department_id',
): ScopeCondition | null {
  if (scope.departmentIds === null) return null;
  if (scope.departmentIds.length === 0) return { clause: '1 = 0', params: [] };
  return {
    clause: `${quoteField(departmentField)} IN (?)`,
    params: [scope.departmentIds],
  };
}

/**
 * 只有 `user_id` 的表（操作日志、角色成员）用子查询圈出可见账号。
 * 日志表本身不存 department_id —— 组织关系会变，审计记录不该跟着变。
 */
export function userScopeSubquery(
  scope: DepartmentScope,
  userField = 'user_id',
): ScopeCondition | null {
  const inner = userScopeCondition(scope);
  if (!inner) return null;
  return {
    clause: `${quoteField(userField)} IN (SELECT \`id\` FROM \`user\` WHERE ${inner.clause})`,
    params: [...inner.params],
  };
}
