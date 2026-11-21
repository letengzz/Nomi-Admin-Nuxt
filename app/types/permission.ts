/** 权限系统前后端共用的形状。字段名与服务端返回保持一致，改一处两边一起改。 */

/** 服务端统一响应外壳：HTTP 恒为 200，结论看 code（200/0/303/409/401）。 */
export interface ApiEnvelope<T = unknown> {
  code: number;
  msg: string;
  data: T;
  time?: number;
}

export type RuleType = 'menu_dir' | 'menu' | 'button';

/** 服务端下发的菜单树节点（`buildMenuTree` 的产物）。 */
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

/** 规则管理页用的扁平/树节点（`buildRuleTree` 的产物）。 */
export interface AdminRule extends MenuNode {
  pid: number;
  menu_type: string;
  url: string;
  component: string;
  extend: string;
  remark: string;
  weigh: number;
  status: number;
  children: AdminRule[];
}

export interface AdminRoleBrief {
  id: number;
  name: string;
}

export interface AdminInfo {
  id: number;
  username: string;
  nickname: string;
  avatar: string;
  email: string;
  mobile: string;
  motto: string;
  status: string;
  lastLoginTime: number;
  lastLoginIp: string;
  /** 只用于 UI（比如显示「超管」标记），**不是权限依据** */
  super: boolean;
  /** 所属部门：前端只用来提示数据范围与设置表单默认值，真正的边界在服务端 */
  departmentId: number;
  rules: string[];
  /** 当前账号的角色（一个人可以有多个） */
  roles: AdminRoleBrief[];
}

export interface InitPayload {
  adminInfo: AdminInfo;
  menus: MenuNode[];
  /** 路由 path → 该页面可用的动作名（如 `add` / `edit` / `del`） */
  authNode: Record<string, string[]>;
  /** 有权节点的完整名称，供 `can('system/role/add')` 使用 */
  authNames: string[];
}

export interface LoginPayload {
  userName: string;
  password: string;
  keepLogin?: boolean;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  expireTime: number;
  refreshExpireTime: number;
  adminInfo: Omit<AdminInfo, 'super' | 'rules' | 'roles'>;
}

export interface RoleItem {
  id: number;
  pid: number;
  name: string;
  code: string;
  rules: number[];
  isSuper: boolean;
  status: number;
  memberCount: number;
  assignable: boolean;
  createTime: number;
  updateTime: number;
}

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

/** 部门树节点（前端按 pid 拼出来，只用于树形展示）。 */
export interface DepartmentNode extends DepartmentItem {
  children: DepartmentNode[];
}

export interface AdminLogItem {
  id: number;
  user_id: number;
  username: string;
  url: string;
  title: string;
  data: string | null;
  ip: string;
  useragent: string;
  create_time: number;
}

/**
 * 账号。一个账号 = 一个部门 + 一组角色，没有「类型」。
 *
 * `roles / isSuper / operable` 都是服务端算好下发的：前端只负责展示，
 * 不自己推导「这个人能不能被编辑」这件事。
 */
export interface UserItem {
  id: number;
  username: string;
  departmentId: number;
  departmentName: string;
  nickname: string;
  avatar: string;
  email: string;
  mobile: string;
  motto: string;
  /** unknown 保密 / male 男 / female 女 */
  gender: string;
  status: string;
  loginFailure: number;
  lastLoginTime: number;
  lastLoginIp: string;
  createTime: number;
  roles: AdminRoleBrief[];
  isSuper: boolean;
  /** 服务端算好的「我能不能动他」，前端照抄 */
  operable: boolean;
  self: boolean;
}

export interface UserListResult {
  list: UserItem[];
  /** 当前筛选命中的条数 */
  total: number;
  /** 当前登录人可见范围内的账号总数（无筛选）：部门树根节点显示它 */
  allTotal: number;
  page: number;
  limit: number;
}

/** 通知公告。枚举值与服务端 notice-service.ts 保持一致。 */
export type NoticeCategory = 'notice' | 'bulletin' | 'activity';
export type NoticeMethod = 'internal' | 'email' | 'sms';
export type NoticeScope = 'all' | 'department' | 'role';

export interface NoticeItem {
  id: number;
  title: string;
  category: NoticeCategory;
  content: string;
  /** 定时发布时间（秒），0 = 立即发布 */
  publishTime: number;
  isTop: number;
  notifyMethod: NoticeMethod;
  notifyScope: NoticeScope;
  scopeIds: number[];
  status: number;
  creatorId: number;
  creatorName: string;
  createTime: number;
  updateTime: number;
  /** 是否已到发布时间 */
  published: boolean;
}
