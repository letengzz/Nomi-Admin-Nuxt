/**
 * 账号服务。
 *
 * 一个账号 = 一个部门 + 一组角色。**没有「账号类型」**：能不能进后台、能看什么，
 * 全部由角色决定。这也是为什么这里的每个写操作都要先回答三个问题：
 *
 *   1. 目标存在吗？
 *   2. 我看得见他吗（部门数据范围：非超管只看本部门及子部门）？
 *   3. 我动得了他吗（`operable`：对方权限 ≤ 我，超管只有超管能动）？
 *   4. 这一改会不会把我自己或系统锁死（不能删/停用自己、不能降级最后一个超管）？
 *
 * 「登录态立即失效」也在这里：停用、改密、删除都会清 token，否则要等 token 过期。
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/pool';
import { ApiError } from '../http';
import {
  assertDepartmentAssignable,
  collectDepartmentIds,
  departmentScopeCondition,
  isDepartmentVisible,
  isUserVisible,
  resolveDepartmentScope,
  userScopeCondition,
  type DepartmentScope,
} from './department-scope';
import { canOperateRole, listRoleRows } from './role-service';
import { hashPassword, PASSWORD_MIN_LENGTH } from './password';
import { parseRules, ruleIdsToNumbers, type AdminContext } from './rbac';
import { nowSeconds, TOKEN_TYPE_ADMIN, TOKEN_TYPE_ADMIN_REFRESH } from './token';

export const GENDERS = ['unknown', 'male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

/** 认不出来的值一律归到「保密」，不让脏数据把界面搞出空白头像以外的怪状态。 */
export function normalizeGender(value: unknown): Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value)
    ? (value as Gender)
    : 'unknown';
}

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^[0-9+\-() ]{5,20}$/;
const MAX_BATCH = 100;

interface UserDbRow extends RowDataPacket {
  id: number;
  username: string;
  department_id: number;
  nickname: string;
  avatar: string;
  email: string;
  mobile: string;
  motto: string;
  gender: string;
  status: string;
  login_failure: number;
  last_login_time: number;
  last_login_ip: string;
  create_time: number;
}

interface AccessRow extends RowDataPacket {
  user_id: number;
  role_id: number;
  name: string;
  rules: string | null;
  status: number;
}

export interface UserRoleBrief {
  id: number;
  name: string;
}

export interface UserListItem {
  id: number;
  username: string;
  departmentId: number;
  departmentName: string;
  nickname: string;
  avatar: string;
  email: string;
  mobile: string;
  motto: string;
  gender: string;
  status: string;
  loginFailure: number;
  lastLoginTime: number;
  lastLoginIp: string;
  createTime: number;
  roles: UserRoleBrief[];
  isSuper: boolean;
  /** 当前登录账号能否编辑/删除它（前端据此隐藏按钮，服务端仍会再校验） */
  operable: boolean;
  self: boolean;
}

export interface UserListQuery {
  page: number;
  limit: number;
  keyword: string;
  status: '' | 'enable' | 'disable';
  /** 按性别筛选；空串 = 不限 */
  gender: '' | Gender;
  /** 按部门筛选（含子部门）。0 = 不限 */
  departmentId: number;
  /** 按角色筛选（角色管理右侧「角色用户」用）。0 = 不限 */
  roleId: number;
  /** 排除某个角色的成员（「分配用户」弹窗里挑还没加入的人）。0 = 不限 */
  excludeRoleId: number;
  /** 排除当前登录账号：批量分配不允许对自己动手，列出来只会让人白选 */
  excludeSelf: boolean;
}

export interface UserListResult {
  list: UserListItem[];
  /** 命中当前筛选条件的条数（分页用） */
  total: number;
  /** 可见范围内、不带任何筛选的账号总数：部门树根节点显示它，不随筛选变化 */
  allTotal: number;
  page: number;
  limit: number;
}

export function normalizeUserListQuery(raw: unknown): UserListQuery {
  const value = (raw ?? {}) as Record<string, unknown>;
  const page = Math.max(1, Number(value.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(value.limit ?? 10) || 10));
  const keyword = typeof value.keyword === 'string' ? value.keyword.trim() : '';
  const status = value.status === 'enable' || value.status === 'disable' ? value.status : '';
  const rawGender = typeof value.gender === 'string' ? value.gender : '';
  const gender: '' | Gender = (GENDERS as readonly string[]).includes(rawGender)
    ? (rawGender as Gender)
    : '';
  const departmentId = Math.max(0, Number(value.departmentId ?? 0) || 0);
  const roleId = Math.max(0, Number(value.roleId ?? 0) || 0);
  const excludeRoleId = Math.max(0, Number(value.excludeRoleId ?? 0) || 0);
  const excludeSelf = value.excludeSelf === true || value.excludeSelf === 'true' || value.excludeSelf === 1;
  return {
    page,
    limit,
    keyword,
    status,
    gender,
    departmentId,
    roleId,
    excludeRoleId,
    excludeSelf,
  };
}

function toListItem(
  row: UserDbRow,
  departmentName: string,
): Omit<UserListItem, 'roles' | 'isSuper' | 'operable' | 'self'> {
  return {
    id: row.id,
    username: row.username,
    departmentId: Number(row.department_id ?? 0),
    departmentName,
    nickname: row.nickname,
    avatar: row.avatar,
    email: row.email,
    mobile: row.mobile,
    motto: row.motto,
    gender: normalizeGender(row.gender),
    status: row.status,
    loginFailure: Number(row.login_failure ?? 0),
    lastLoginTime: Number(row.last_login_time ?? 0),
    lastLoginIp: row.last_login_ip,
    createTime: Number(row.create_time ?? 0),
  };
}

/** 这批账号的角色，一次查完（避免每一行再查一次）。 */
async function loadAccessMap(ids: readonly number[]): Promise<Map<number, AccessRow[]>> {
  const map = new Map<number, AccessRow[]>();
  if (ids.length === 0) return map;

  const pool = getPool();
  const [rows] = await pool.query<AccessRow[]>(
    `SELECT ur.\`user_id\`, ur.\`role_id\`, r.\`name\`, r.\`rules\`, r.\`status\`
       FROM \`user_role\` ur
       INNER JOIN \`role\` r ON r.\`id\` = ur.\`role_id\`
      WHERE ur.\`user_id\` IN (?)`,
    [ids],
  );
  for (const row of rows) {
    const list = map.get(row.user_id) ?? [];
    list.push(row);
    map.set(row.user_id, list);
  }
  return map;
}

export function isSuperAccess(access: readonly AccessRow[]): boolean {
  return access.some((row) => parseRules(row.rules).includes('*') && row.status === 1);
}

/**
 * 能不能操作这个账号：
 *   · 超管全通；
 *   · 不能碰别的超管；
 *   · 目标的所有角色规则必须 ⊆ 我的规则（否则就是「管理比自己权限大的人」）。
 */
function canOperateAccount(context: AdminContext, access: readonly AccessRow[]): boolean {
  if (context.isSuper) return true;
  if (isSuperAccess(access)) return false;
  const mine = new Set(ruleIdsToNumbers(context.ruleIds));
  return access.every((row) =>
    ruleIdsToNumbers(parseRules(row.rules)).every((id) => mine.has(id)),
  );
}

/** 部门表整棵（含停用），部门数量是两位数级别，直接全量取来判断子树。 */
async function listDepartmentNodes(): Promise<Array<{ id: number; pid: number; name: string }>> {
  const pool = getPool();
  const [rows] = await pool.query<
    Array<{ id: number; pid: number; name: string } & RowDataPacket>
  >('SELECT `id`,`pid`,`name` FROM `department` ORDER BY `weigh` DESC, `id` ASC');
  return rows.map((row) => ({ id: row.id, pid: row.pid, name: row.name }));
}

/** 写操作护栏：目标账号必须在当前登录账号的部门范围内（本人永远算在内）。 */
export async function assertUsersInScope(
  context: AdminContext,
  targets: ReadonlyArray<{ id: number; department_id: number }>,
): Promise<void> {
  const scope = await resolveDepartmentScope(context);
  for (const row of targets) {
    if (
      !isUserVisible(scope, {
        id: Number(row.id),
        departmentId: Number(row.department_id ?? 0),
      })
    ) {
      throw new ApiError('只能操作本部门及下级部门的账号');
    }
  }
}

export interface UserListConditions {
  where: string[];
  params: unknown[];
  scope: DepartmentScope;
  departments: Array<{ id: number; pid: number; name: string }>;
}

/**
 * 列表的 where 条件。
 *
 * 抽出来是因为「导出」和「列表」必须共用同一套口径 —— 导出的行一旦不是
 * 屏幕上看到的那一批，用户第一反应就是数据错了，而排查这种问题最费时间。
 */
export async function buildUserListConditions(
  context: AdminContext,
  query: UserListQuery,
): Promise<UserListConditions> {
  const where: string[] = [];
  const params: unknown[] = [];

  const scope = await resolveDepartmentScope(context);
  const departments = await listDepartmentNodes();

  // 1) 数据范围永远先落地：前端不传 departmentId 也照样只能看到自己那棵树。
  const visible = userScopeCondition(scope);
  if (visible) {
    where.push(visible.clause);
    params.push(...visible.params);
  }

  // 2) 前端部门筛选只能「在范围内再收窄」，不能用来扩大范围。
  if (query.departmentId > 0) {
    if (!isDepartmentVisible(scope, query.departmentId)) {
      where.push('1 = 0');
    } else {
      const ids = collectDepartmentIds(departments, query.departmentId);
      where.push('`department_id` IN (?)');
      params.push(ids);
    }
  }
  if (query.status) {
    where.push('`status` = ?');
    params.push(query.status);
  }
  if (query.gender) {
    where.push('`gender` = ?');
    params.push(query.gender);
  }
  if (query.roleId > 0) {
    // 子查询而不是 JOIN：JOIN 会让一个挂了多个角色的账号在 COUNT 里被算两次。
    where.push('`id` IN (SELECT `user_id` FROM `user_role` WHERE `role_id` = ?)');
    params.push(query.roleId);
  }
  if (query.excludeRoleId > 0) {
    where.push('`id` NOT IN (SELECT `user_id` FROM `user_role` WHERE `role_id` = ?)');
    params.push(query.excludeRoleId);
  }
  if (query.excludeSelf) {
    where.push('`id` <> ?');
    params.push(context.admin.id);
  }
  if (query.keyword) {
    const like = `%${query.keyword}%`;
    where.push('(`username` LIKE ? OR `nickname` LIKE ? OR `email` LIKE ? OR `mobile` LIKE ?)');
    params.push(like, like, like, like);
  }

  return { where, params, scope, departments };
}

export async function listUsers(
  context: AdminContext,
  query: UserListQuery,
): Promise<UserListResult> {
  const { where, params, scope, departments } = await buildUserListConditions(context, query);
  const departmentNames = new Map(departments.map((dept) => [dept.id, dept.name]));

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();

  // 「全部部门」是相对当前登录人而言的：非超管只统计自己范围内的人，
  // 否则左树挂着一个全库数字，点进去却只列出几个人，反而更让人困惑。
  // 这里用「只按部门」的条件，保证与部门树各节点人数相加对得上。
  const totalScope = departmentScopeCondition(scope);
  const totalClause = totalScope ? `WHERE ${totalScope.clause}` : '';

  const [[countRows], [allCountRows], [rows]] = await Promise.all([
    pool.query<Array<{ total: number } & RowDataPacket>>(
      `SELECT COUNT(*) AS total FROM \`user\` ${clause}`,
      params,
    ),
    // 与筛选无关的一次 COUNT：给部门树根节点用，不随搜索/状态/性别筛选抖动。
    pool.query<Array<{ total: number } & RowDataPacket>>(
      `SELECT COUNT(*) AS total FROM \`user\` ${totalClause}`,
      totalScope?.params ?? [],
    ),
    pool.query<UserDbRow[]>(
      `SELECT \`id\`,\`username\`,\`department_id\`,\`nickname\`,\`avatar\`,\`email\`,\`mobile\`,\`motto\`,\`gender\`,\`status\`,
              \`login_failure\`,\`last_login_time\`,\`last_login_ip\`,\`create_time\`
         FROM \`user\` ${clause}
        ORDER BY \`id\` ASC
        LIMIT ? OFFSET ?`,
      [...params, query.limit, (query.page - 1) * query.limit],
    ),
  ]);

  const accessMap = await loadAccessMap(rows.map((row) => row.id));

  return {
    list: rows.map((row) => {
      const access = accessMap.get(row.id) ?? [];
      return {
        ...toListItem(row, departmentNames.get(Number(row.department_id ?? 0)) ?? ''),
        roles: access.map((item) => ({ id: item.role_id, name: item.name })),
        isSuper: isSuperAccess(access),
        operable: canOperateAccount(context, access),
        self: row.id === context.admin.id,
      };
    }),
    total: Number(countRows[0]?.total ?? 0),
    allTotal: Number(allCountRows[0]?.total ?? 0),
    page: query.page,
    limit: query.limit,
  };
}

/** 导出上限：超过这个量级就不该用「导出当前筛选」了，请先缩小范围。 */
export const MAX_EXPORT_ROWS = 5000;

export interface UserExportRow {
  username: string;
  nickname: string;
  email: string;
  mobile: string;
  gender: Gender;
  departmentName: string;
  roleNames: string;
  status: string;
  createTime: number;
  lastLoginTime: number;
  lastLoginIp: string;
}

/**
 * 导出：与列表同一套筛选条件，但不分页。
 *
 * 多取一行用来判断「是不是被截断了」：调用方需要如实告诉用户
 * 「只导出了前 5000 条」，而不是悄悄少一半。
 */
export async function listUsersForExport(
  context: AdminContext,
  query: UserListQuery,
): Promise<{ rows: UserExportRow[]; total: number; truncated: boolean }> {
  const { where, params, departments } = await buildUserListConditions(context, query);
  const departmentNames = new Map(departments.map((dept) => [dept.id, dept.name]));
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();

  const [[countRows], [rawRows]] = await Promise.all([
    pool.query<Array<{ total: number } & RowDataPacket>>(
      `SELECT COUNT(*) AS total FROM \`user\` ${clause}`,
      params,
    ),
    pool.query<UserDbRow[]>(
      `SELECT \`id\`,\`username\`,\`department_id\`,\`nickname\`,\`avatar\`,\`email\`,\`mobile\`,\`motto\`,\`gender\`,\`status\`,
              \`login_failure\`,\`last_login_time\`,\`last_login_ip\`,\`create_time\`
         FROM \`user\` ${clause}
        ORDER BY \`id\` ASC
        LIMIT ?`,
      [...params, MAX_EXPORT_ROWS + 1],
    ),
  ]);

  const truncated = rawRows.length > MAX_EXPORT_ROWS;
  const rows = truncated ? rawRows.slice(0, MAX_EXPORT_ROWS) : rawRows;
  const accessMap = await loadAccessMap(rows.map((row) => row.id));

  return {
    rows: rows.map((row) => ({
      username: row.username,
      nickname: row.nickname,
      email: row.email,
      mobile: row.mobile,
      gender: normalizeGender(row.gender),
      departmentName: departmentNames.get(Number(row.department_id ?? 0)) ?? '',
      roleNames: (accessMap.get(row.id) ?? []).map((item) => item.name).join('、'),
      status: row.status,
      createTime: Number(row.create_time ?? 0),
      lastLoginTime: Number(row.last_login_time ?? 0),
      lastLoginIp: row.last_login_ip,
    })),
    total: Number(countRows[0]?.total ?? 0),
    truncated,
  };
}

export interface ImportUserGuard {
  departmentId: number;
  visible: boolean;
  operable: boolean;
  self: boolean;
}

/**
 * 导入时的「已有账号能不能改」。和单条编辑用同一组判据
 * （部门范围 + 权限不低于自己），区别只是**不抛错** ——
 * 导入需要的是「这一行有问题」，而不是让整批请求失败。
 */
export async function inspectUsersForImport(
  context: AdminContext,
  ids: readonly number[],
): Promise<Map<number, ImportUserGuard>> {
  const map = new Map<number, ImportUserGuard>();
  if (ids.length === 0) return map;

  const pool = getPool();
  const [rows] = await pool.query<Array<{ id: number; department_id: number } & RowDataPacket>>(
    'SELECT `id`,`department_id` FROM `user` WHERE `id` IN (?)',
    [ids],
  );
  const scope = await resolveDepartmentScope(context);
  const accessMap = await loadAccessMap(ids);

  for (const row of rows) {
    const id = Number(row.id);
    const departmentId = Number(row.department_id ?? 0);
    map.set(id, {
      departmentId,
      visible: isUserVisible(scope, { id, departmentId }),
      operable: canOperateAccount(context, accessMap.get(id) ?? []),
      self: id === context.admin.id,
    });
  }
  return map;
}

export interface UserPayload {
  username: string;
  /** 空串 = 不修改密码（仅编辑时允许） */
  password: string;
  nickname: string;
  email: string;
  mobile: string;
  motto: string;
  /** unknown 保密 / male 男 / female 女 */
  gender: Gender;
  status: string;
  /** 0 = 未分配 */
  departmentId: number;
  /** 至少一个：角色是唯一的权限来源 */
  roleIds: number[];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 入参校验。抽成纯函数（不碰数据库）是为了能单测：
 * 表单校验在前后端各有一份，后端的这份才是真正生效的那份。
 */
export function normalizeUserPayload(
  raw: unknown,
  options: { requireUsername: boolean; requirePassword: boolean },
): UserPayload {
  const body = (raw ?? {}) as Record<string, unknown>;
  const username = asText(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const nickname = asText(body.nickname);
  const email = asText(body.email);
  const mobile = asText(body.mobile);
  const motto = asText(body.motto);
  const gender = normalizeGender(body.gender);
  const status = body.status === 'disable' ? 'disable' : 'enable';
  const departmentId = Math.max(0, Number(body.departmentId ?? 0) || 0);

  if (options.requireUsername) {
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      throw new ApiError(`账号长度需在 ${USERNAME_MIN}-${USERNAME_MAX} 个字符之间`);
    }
    if (!USERNAME_PATTERN.test(username)) {
      throw new ApiError('账号只能包含字母、数字、下划线和短横线');
    }
  }
  if (options.requirePassword) {
    if (password.length < PASSWORD_MIN_LENGTH) {
      throw new ApiError(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
    }
  } else if (password && password.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }

  if (nickname.length > 50) throw new ApiError('昵称不能超过 50 个字符');
  if (email && (!EMAIL_PATTERN.test(email) || email.length > 100)) {
    throw new ApiError('邮箱格式不正确');
  }
  if (mobile && !MOBILE_PATTERN.test(mobile)) throw new ApiError('手机号格式不正确');
  if (motto.length > 255) throw new ApiError('签名不能超过 255 个字符');

  const roleIds = [
    ...new Set(
      (Array.isArray(body.roles) ? body.roles : [])
        .map((item) => Number(item))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];

  return {
    username,
    password,
    nickname,
    email,
    mobile,
    motto,
    gender,
    status,
    departmentId,
    roleIds,
  };
}

/** 批量的 id 列表：去重、去非法值，并限制一次最多 100 条。 */
export function normalizeUserIds(raw: unknown): number[] {
  const source = Array.isArray(raw) ? raw : [];
  const ids = [
    ...new Set(source.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (ids.length === 0) throw new ApiError('请先选择账号');
  if (ids.length > MAX_BATCH) throw new ApiError(`一次最多处理 ${MAX_BATCH} 个账号`);
  return ids;
}

/**
 * 角色的归属校验。
 *
 * 没有角色就没有任何菜单和接口权限，登录进去是一个空后台 —— 与其让人
 * 事后排查「为什么什么都点不了」，不如在保存时就拦住。
 */
async function resolveRoles(context: AdminContext, input: UserPayload): Promise<number[]> {
  if (input.roleIds.length === 0) throw new ApiError('至少需要一个角色');

  const roles = await listRoleRows();
  const byId = new Map(roles.map((role) => [role.id, role]));
  for (const id of input.roleIds) {
    const role = byId.get(id);
    if (!role) throw new ApiError(`角色不存在：${id}`);
    if (role.status !== 1) throw new ApiError(`角色已停用：${role.name}`);
    if (!canOperateRole(context, role)) {
      throw new ApiError(`不能分配角色「${role.name}」：它的权限超出你的范围`);
    }
  }
  return input.roleIds;
}

/**
 * 部门必须真实、启用，且落在当前登录账号的数据范围内。
 *
 * 非超管不允许新建「无部门」账号，也不允许把人调到范围外：那样等于
 * 用一次编辑把账号从自己可见范围里抹掉（或者塞进别人的范围里）。
 */
async function resolveDepartment(
  context: AdminContext,
  input: UserPayload,
  target?: { id: number; departmentId: number },
): Promise<number> {
  const scope: DepartmentScope = await resolveDepartmentScope(context);
  assertDepartmentAssignable(scope, input.departmentId, target);
  if (input.departmentId === 0) return 0;

  const pool = getPool();
  const [rows] = await pool.query<Array<{ status: number } & RowDataPacket>>(
    'SELECT `status` FROM `department` WHERE `id` = ? LIMIT 1',
    [input.departmentId],
  );
  const dept = rows[0];
  if (!dept) throw new ApiError('所属部门不存在');
  if (dept.status !== 1) throw new ApiError('该部门已停用，请选择其它部门');
  return input.departmentId;
}

async function assertUsernameFree(username: string, exceptId?: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<Array<{ id: number } & RowDataPacket>>(
    'SELECT `id` FROM `user` WHERE `username` = ? LIMIT 1',
    [username],
  );
  const existing = rows[0];
  if (!existing) return;
  if (exceptId && existing.id === exceptId) return;
  throw new ApiError('该账号已存在');
}

async function syncRoles(
  connection: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  userId: number,
  roleIds: readonly number[],
): Promise<void> {
  await connection.query('DELETE FROM `user_role` WHERE `user_id` = ?', [userId]);
  if (roleIds.length === 0) return;
  await connection.query('INSERT INTO `user_role` (`user_id`,`role_id`) VALUES ?', [
    roleIds.map((id) => [userId, id]),
  ]);
}

export async function createUser(context: AdminContext, input: UserPayload): Promise<number> {
  await assertUsernameFree(input.username);
  const roleIds = await resolveRoles(context, input);
  const departmentId = await resolveDepartment(context, input);

  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ts = nowSeconds();
    const password = await hashPassword(input.password);
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO `user` (`username`,`department_id`,`nickname`,`email`,`mobile`,`motto`,`gender`,`password`,`status`,`create_time`,`update_time`) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [
        input.username,
        departmentId,
        input.nickname || input.username,
        input.email,
        input.mobile,
        input.motto,
        input.gender,
        password,
        input.status,
        ts,
        ts,
      ],
    );
    await syncRoles(connection, result.insertId, roleIds);
    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    // 并发创建时先查后插会同时通过，唯一索引是最后一道闸。
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new ApiError('该账号已存在');
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function loadTarget(id: number): Promise<{ row: UserDbRow; access: AccessRow[] }> {
  const pool = getPool();
  const [rows] = await pool.query<UserDbRow[]>('SELECT * FROM `user` WHERE `id` = ? LIMIT 1', [id]);
  const row = rows[0];
  if (!row) throw new ApiError('账号不存在');
  const access = (await loadAccessMap([id])).get(id) ?? [];
  return { row, access };
}

function assertOperable(context: AdminContext, access: readonly AccessRow[]): void {
  if (!canOperateAccount(context, access)) {
    throw new ApiError('没有权限操作该账号（对方权限不低于你）');
  }
}

/** 全库还剩几个超管。用来挡住「把最后一个超管删了/降级了」。 */
export async function countSupers(): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<AccessRow[]>(
    'SELECT ur.`user_id`, ur.`role_id`, r.`name`, r.`rules`, r.`status` FROM `user_role` ur INNER JOIN `role` r ON r.`id` = ur.`role_id`',
  );
  const byUser = new Map<number, AccessRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  let total = 0;
  for (const list of byUser.values()) if (isSuperAccess(list)) total += 1;
  return total;
}

/** 编辑账号。账号名不可改：改账号会让历史日志对不上人。 */
export async function updateUser(
  context: AdminContext,
  id: number,
  input: UserPayload,
): Promise<void> {
  const { row, access } = await loadTarget(id);
  await assertUsersInScope(context, [row]);
  assertOperable(context, access);

  const self = id === context.admin.id;
  const targetIsSuper = isSuperAccess(access);

  if (self && input.status === 'disable') {
    throw new ApiError('不能停用自己的账号');
  }

  const roleIds = await resolveRoles(context, input);
  const departmentId = await resolveDepartment(context, input, {
    id,
    departmentId: Number(row.department_id ?? 0),
  });

  // 把唯一的超管降级，等于系统里再没人能改权限 —— 和「删掉最后一个超管」是同一件事。
  // 注意判据是「改完之后还算不算超管」，不是「有没有动过角色」：
  // 给最后一个超管改昵称不该被拦。
  if (targetIsSuper && (await countSupers()) <= 1) {
    const roles = await listRoleRows();
    const stillSuper = roleIds.some((roleId) => {
      const role = roles.find((item) => item.id === roleId);
      return role ? parseRules(role.rules).includes('*') : false;
    });
    if (!stillSuper) throw new ApiError('这是最后一个超级管理员，不能移除它的超管角色');
  }

  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const params: unknown[] = [
      departmentId,
      input.nickname,
      input.email,
      input.mobile,
      input.motto,
      input.gender,
      input.status,
    ];
    let sql =
      'UPDATE `user` SET `department_id`=?,`nickname`=?,`email`=?,`mobile`=?,`motto`=?,`gender`=?,`status`=?,';

    if (input.password) {
      // 改密码顺手把失败计数清掉：否则「密码错误 5 次」的旧记录还会继续锁人。
      sql += '`password`=?,`login_failure`=0,';
      params.push(await hashPassword(input.password));
    }
    sql += '`update_time`=? WHERE `id`=?';
    params.push(nowSeconds(), id);

    await connection.query(sql, params);
    await syncRoles(connection, id, roleIds);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // 停用或换了密码，都要让已签发的 token 立即失效。
  if (input.status === 'disable' || input.password) await revokeTokens([id]);
}

/** 清掉这些账号的登录态。停用/改密之后不踢下线，等于没生效。 */
export async function revokeTokens(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const pool = getPool();
  await pool.query('DELETE FROM `token` WHERE `type` IN (?,?) AND `user_id` IN (?)', [
    TOKEN_TYPE_ADMIN,
    TOKEN_TYPE_ADMIN_REFRESH,
    ids,
  ]);
}

/** 批量校验：全部存在、全部可操作、不含自己。 */
export async function assertBatchOperable(
  context: AdminContext,
  ids: readonly number[],
): Promise<Array<{ row: UserDbRow; access: AccessRow[] }>> {
  if (ids.includes(context.admin.id)) throw new ApiError('不能对自己执行这个操作');

  const pool = getPool();
  const [rows] = await pool.query<UserDbRow[]>('SELECT * FROM `user` WHERE `id` IN (?)', [ids]);
  if (rows.length !== ids.length) throw new ApiError('部分账号不存在，请刷新后重试');

  // 所有批量写操作（停用、删除、角色成员分配）都从这里过，范围校验放在
  // 「能不能操作」之前：先看不见，再谈动不动得了。
  await assertUsersInScope(context, rows);

  const accessMap = await loadAccessMap(ids);
  return rows.map((row) => {
    const access = accessMap.get(row.id) ?? [];
    assertOperable(context, access);
    return { row, access };
  });
}

export async function setUserStatus(
  context: AdminContext,
  ids: readonly number[],
  status: string,
): Promise<number> {
  const next = status === 'disable' ? 'disable' : 'enable';
  const targets = await assertBatchOperable(context, ids);

  if (next === 'disable') {
    const supers = targets.filter((item) => isSuperAccess(item.access)).length;
    if (supers > 0 && supers >= (await countSupers())) {
      throw new ApiError('不能停用最后一个超级管理员');
    }
  }

  const pool = getPool();
  const targetIds = targets.map((item) => item.row.id);
  const [result] = await pool.query<ResultSetHeader>(
    'UPDATE `user` SET `status`=?,`update_time`=? WHERE `id` IN (?)',
    [next, nowSeconds(), targetIds],
  );
  if (next === 'disable') await revokeTokens(targetIds);
  return result.affectedRows;
}

export async function resetUserPassword(
  context: AdminContext,
  id: number,
  password: string,
): Promise<void> {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new ApiError(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }
  const { row, access } = await loadTarget(id);
  await assertUsersInScope(context, [row]);
  assertOperable(context, access);

  const pool = getPool();
  // 这串密码是**管理员设定并转达**的，等于已经过了一次别人的手/聊天窗口，
  // 因此标记「下次登录必须改密」：管理员的方便不能以长期共享凭据为代价。
  const [result] = await pool.query<ResultSetHeader>(
    'UPDATE `user` SET `password`=?,`login_failure`=0,`must_change_password`=1,`update_time`=? WHERE `id`=?',
    [await hashPassword(password), nowSeconds(), id],
  );
  if (result.affectedRows === 0) throw new ApiError('账号不存在');
  await revokeTokens([id]);
}

export async function deleteUsers(context: AdminContext, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const targets = await assertBatchOperable(context, ids);

  const supers = targets.filter((item) => isSuperAccess(item.access)).length;
  if (supers > 0 && supers >= (await countSupers())) {
    throw new ApiError('不能删除最后一个超级管理员');
  }

  const targetIds = targets.map((item) => item.row.id);
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM `user_role` WHERE `user_id` IN (?)', [targetIds]);
    await connection.query('DELETE FROM `token` WHERE `type` IN (?,?) AND `user_id` IN (?)', [
      TOKEN_TYPE_ADMIN,
      TOKEN_TYPE_ADMIN_REFRESH,
      targetIds,
    ]);
    const [result] = await connection.query<ResultSetHeader>(
      'DELETE FROM `user` WHERE `id` IN (?)',
      [targetIds],
    );
    await connection.commit();
    return result.affectedRows;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
