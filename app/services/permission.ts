/**
 * 角色 / 权限节点相关的接口封装。
 *
 * 全部走 `apiFetch`：它负责 token 注入、409 续期重放、303 回登录页，
 * 所以这里的每个函数都只有「一行 URL + 一行类型」。
 */
import { apiFetch } from '../utils/request';
import type {
  AdminLogItem,
  AdminRule,
  DepartmentItem,
  InitPayload,
  LoginPayload,
  LoginResult,
  NoticeItem,
  RoleItem,
  SpreadsheetFile,
  UserImportResult,
  UserImportStrategies,
  UserListResult,
} from '../types/permission';

// --- 身份 --------------------------------------------------------------------

export function loginAdmin(payload: LoginPayload): Promise<LoginResult> {
  return apiFetch<LoginResult>('/api/admin/login', { method: 'POST', body: payload });
}

export function logoutAdmin(refreshToken: string): Promise<boolean> {
  return apiFetch<boolean>('/api/admin/logout', {
    method: 'POST',
    body: refreshToken ? { refreshToken } : {},
  });
}

export function fetchInit(): Promise<InitPayload> {
  return apiFetch<InitPayload>('/api/admin/init');
}

// --- 角色 --------------------------------------------------------------------

export interface RoleListResult {
  list: RoleItem[];
  total: number;
  super: boolean;
}

export function fetchRoles(): Promise<RoleListResult> {
  return apiFetch<RoleListResult>('/api/admin/roles/list');
}

export interface RolePayload {
  id?: number;
  name: string;
  /** 角色编码：字母/数字/下划线/中划线，全库唯一 */
  code: string;
  pid: number;
  status: number;
  rules: number[];
}

export function addRole(payload: RolePayload): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/roles/add', { method: 'POST', body: payload });
}

export function editRole(payload: RolePayload & { id: number }): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/roles/edit', { method: 'POST', body: payload });
}

export function deleteRole(id: number): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/roles/del', { method: 'POST', body: { id } });
}

/** 给角色批量加人 / 从角色批量移除。返回真正受影响的行数。 */
export function changeRoleUsers(
  roleId: number,
  userIds: number[],
  action: 'add' | 'remove',
): Promise<{ affected: number }> {
  return apiFetch<{ affected: number }>('/api/admin/roles/users', {
    method: 'POST',
    body: { id: roleId, userIds, action },
  });
}

// --- 部门 --------------------------------------------------------------------

export interface DepartmentListResult {
  list: DepartmentItem[];
  total: number;
}

export function fetchDepartments(): Promise<DepartmentListResult> {
  return apiFetch<DepartmentListResult>('/api/admin/departments/list');
}

export interface DepartmentPayload {
  id?: number;
  name: string;
  pid: number;
  leader: string;
  phone: string;
  weigh: number;
  status: number;
}

export function addDepartment(payload: DepartmentPayload): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/departments/add', { method: 'POST', body: payload });
}

export function editDepartment(
  payload: DepartmentPayload & { id: number },
): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/departments/edit', { method: 'POST', body: payload });
}

export function deleteDepartment(id: number): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/departments/del', { method: 'POST', body: { id } });
}

// --- 账号 --------------------------------------------------------------------

/** 用 type 而不是 interface：apiFetch 的 query 要求可赋给 Record<string, unknown>。 */
export type UserListQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  /** 性别：unknown / male / female，空 = 不限 */
  gender?: string;
  /** 部门 id（含子部门），0 / 不传 = 不限 */
  departmentId?: number;
  /** 角色 id（角色管理右侧「角色用户」用） */
  roleId?: number;
  /** 排除该角色的成员（「分配用户」弹窗里挑还没加入的人） */
  excludeRoleId?: number;
  /** 排除当前登录账号 */
  excludeSelf?: boolean;
};

export function fetchUsers(query: UserListQuery = {}): Promise<UserListResult> {
  return apiFetch<UserListResult>('/api/admin/users/list', { query });
}

export interface UserPayload {
  id?: number;
  username?: string;
  password?: string;
  nickname: string;
  email: string;
  mobile: string;
  motto: string;
  /** unknown 保密 / male 男 / female 女 */
  gender: string;
  status: string;
  /** 0 = 未分配 */
  departmentId: number;
  /** 角色 id 列表，至少一个 */
  roles: number[];
}

export function addUser(payload: UserPayload): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/users/add', { method: 'POST', body: payload });
}

export function editUser(payload: UserPayload & { id: number }): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/users/edit', { method: 'POST', body: payload });
}

export function deleteUsers(ids: number[]): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>('/api/admin/users/del', { method: 'POST', body: { ids } });
}

export function setUsersStatus(ids: number[], status: 'enable' | 'disable'): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>('/api/admin/users/status', {
    method: 'POST',
    body: { ids, status },
  });
}

export function resetUserPassword(id: number, password: string): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/users/reset-password', {
    method: 'POST',
    body: { id, password },
  });
}

/**
 * 导出账号：与列表同一套筛选条件。
 *
 * 服务端回 base64（见 export.get.ts 的注释），这里只负责拿到文件本身，
 * 落盘交给页面 —— 页面知道当前该叫什么名字。
 */
export function exportUsers(query: UserListQuery = {}): Promise<SpreadsheetFile> {
  return apiFetch<SpreadsheetFile>('/api/admin/users/export', { query });
}

/** 下载导入模板：列顺序与解析器共用服务端的同一份定义。 */
export function fetchUserImportTemplate(): Promise<SpreadsheetFile> {
  return apiFetch<SpreadsheetFile>('/api/admin/users/import-template');
}

/**
 * 导入账号。mode=parse 只解析出预览，mode=commit 才真正写库。
 *
 * 每次都用同一个 File 重新上传：服务端重新解析一遍，前端不需要（也不应该）
 * 把「我解析出来的行」回传上去 —— 那样等于把校验权交给了浏览器。
 */
export function importUsers(
  file: File,
  mode: 'parse' | 'commit',
  strategies: UserImportStrategies,
): Promise<UserImportResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('mode', mode);
  form.append('onUsername', strategies.onUsername);
  form.append('onEmail', strategies.onEmail);
  form.append('onMobile', strategies.onMobile);
  form.append('defaultStatus', strategies.defaultStatus);
  return apiFetch<UserImportResult>('/api/admin/users/import', { method: 'POST', body: form });
}

// --- 规则节点 --------------------------------------------------------------

export interface RuleListResult {
  list: AdminRule[];
  tree: AdminRule[];
  total: number;
  super: boolean;
  enabled: AdminRule[];
}

export function fetchRules(): Promise<RuleListResult> {
  return apiFetch<RuleListResult>('/api/admin/rules/list');
}

export interface RulePayload {
  id?: number;
  pid: number;
  type: string;
  title: string;
  name: string;
  path: string;
  icon: string;
  menu_type?: string;
  url?: string;
  component?: string;
  keepalive?: number;
  remark?: string;
  weigh: number;
  status: number;
}

export function addRule(payload: RulePayload): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/rules/add', { method: 'POST', body: payload });
}

export function editRule(payload: RulePayload & { id: number }): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/rules/edit', { method: 'POST', body: payload });
}

export function deleteRule(id: number): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/rules/del', { method: 'POST', body: { id } });
}

export function sortRules(weights: Array<{ id: number; weigh: number }>): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>('/api/admin/rules/sortable', {
    method: 'POST',
    body: { weights },
  });
}

// --- 日志 ------------------------------------------------------------------

export interface LogListResult {
  list: AdminLogItem[];
  total: number;
  page: number;
  limit: number;
}

export function fetchLogs(query: {
  page?: number;
  limit?: number;
  keyword?: string;
  /** 只看某个账号的日志（用户管理「详情」抽屉用） */
  userId?: number;
}): Promise<LogListResult> {
  return apiFetch<LogListResult>('/api/admin/logs/list', { query });
}

// --- 通知公告 ----------------------------------------------------------------

export interface NoticeListResult {
  list: NoticeItem[];
  total: number;
}

export interface NoticeQuery {
  keyword?: string;
  category?: string;
  /** 1 启用 / 0 停用 */
  status?: number;
  /** true 已发布 / false 定时中 */
  published?: boolean;
}

export function fetchNotices(query: NoticeQuery = {}): Promise<NoticeListResult> {
  return apiFetch<NoticeListResult>('/api/admin/notices/list', {
    query: query as Record<string, unknown>,
  });
}

/** 新建或编辑共用的载荷；带 id 即编辑。 */
export interface NoticePayload {
  id?: number;
  title: string;
  category: string;
  content: string;
  /** 秒级时间戳，0 = 立即发布 */
  publishTime: number;
  isTop: number;
  notifyMethod: string;
  notifyScope: string;
  scopeIds: number[];
  status: number;
}

export function addNotice(payload: NoticePayload): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/notices/add', { method: 'POST', body: payload });
}

export function editNotice(payload: NoticePayload): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/notices/edit', { method: 'POST', body: payload });
}

export function deleteNotice(id: number): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/api/admin/notices/del', { method: 'POST', body: { id } });
}

/** 铃铛抽屉：当前账号可见的已发布公告（无需权限节点，已登录即可）。 */
export function fetchMyNotices(): Promise<NoticeListResult> {
  return apiFetch<NoticeListResult>('/api/notices');
}

/** 铃铛点标题进详情：按 id 取一条可见公告（服务端做范围/发布态校验）。 */
export function fetchNoticeById(id: number): Promise<NoticeItem> {
  return apiFetch<NoticeItem>(`/api/notices/${id}`);
}

/** 管理端编辑页回填：按 id 取单条（含定时中/停发的公告，需编辑权限）。 */
export function fetchNoticeForEdit(id: number): Promise<NoticeItem> {
  return apiFetch<NoticeItem>(`/api/admin/notices/${id}`);
}

/** 富文本图片上传：走公告编辑权限，落到站点 uploads，返回可公开读取的地址。 */
export function uploadNoticeImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<{ url: string }>('/api/admin/notices/upload', { method: 'POST', body: form });
}
