/**
 * 登录态：token → 管理员 → 权限上下文（对应 docs 4.6 `Auth::init()` 与 `login()`）。
 *
 * 返回值刻意用「可判别联合」而不是抛异常：
 *   { ok: true, context }                      → 继续处理
 *   { ok: false, code: 303, msg }              → 未登录 / 账号被禁用
 *   { ok: false, code: 409, msg }              → token 过期，前端应走续期
 *
 * 抛异常在 h3 里会变成一个 HTTP 错误响应，前端得从 error.data 里翻业务码；
 * 用返回值把「HTTP 层」和「业务层」分开，接口里只剩一个 if。
 */
import type { H3Event } from 'h3';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../../database/pool';
import { getDbConfig } from '../../database/config';
import { recordLoginLog } from './admin-log';
import { collectRequestMeta } from './request-meta';
import { verifyPassword } from './password';
import {
  loadAdminContext,
  type AdminContext,
  type AdminRow,
} from './rbac';
import {
  findToken,
  issueTokenPair,
  TOKEN_TYPE_ADMIN,
  type TokenPair,
  readAccessToken,
  nowSeconds,
  touchSession,
} from './token';
import { isLoginDepartmentAllowed } from './department-scope';

/** 连续失败 5 次、且最后一次失败在 24 小时内 → 锁定（与文档 operation_login_retry 一致）。 */
export const LOGIN_RETRY_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW = 24 * 3600;

export interface AdminProfile {
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
  /** true = 还在用初始/重置口令，登录后必须先改密（其它接口会回 428） */
  mustChangePassword: boolean;
}

export type AuthFailureCode = 303 | 409;

export type AuthResult =
  | { ok: true; context: AdminContext }
  | { ok: false; code: AuthFailureCode; msg: string };

export interface LoginSuccess {
  ok: true;
  profile: AdminProfile;
  tokens: TokenPair;
}
export type LoginResult = LoginSuccess | { ok: false; code: 0 | 303; msg: string };

export function toProfile(admin: AdminRow): AdminProfile {
  return {
    id: admin.id,
    username: admin.username,
    nickname: admin.nickname,
    avatar: admin.avatar,
    email: admin.email,
    mobile: admin.mobile,
    motto: admin.motto,
    status: admin.status,
    lastLoginTime: admin.last_login_time,
    lastLoginIp: admin.last_login_ip,
    mustChangePassword: Number(admin.must_change_password ?? 0) === 1,
  };
}

export async function findAdminById(id: number): Promise<AdminRow | undefined> {
  const pool = getPool();
  const [rows] = await pool.query<AdminRow[]>('SELECT * FROM `user` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0];
}

export async function findAdminByUsername(username: string): Promise<AdminRow | undefined> {
  const pool = getPool();
  const [rows] = await pool.query<AdminRow[]>('SELECT * FROM `user` WHERE `username` = ? LIMIT 1', [
    username,
  ]);
  return rows[0];
}

/**
 * 按「登录名**或**绑定邮箱」找账号。只给找回密码用。
 *
 * 用户记不住登录名时，能想起的往往就是自己的邮箱；旧版只拿输入值去匹配 `username`，
 * 填邮箱就永远匹配不到 —— 而接口为了防枚举必须返回「已发送」，于是表现为
 * 「填了邮箱、页面说发出去了、邮箱里什么都没有」。这类静默失败比报错更难查。
 *
 * 两处必须同时用它：取验证码和提交新密码。只在第一处支持邮箱的话，
 * 用户拿邮箱走到第二步会被判「验证码不存在」，看起来像码过期了。
 *
 * `username = ?` 排在前：同一串字符既是某人登录名、又是另一人邮箱时，
 * 以登录名为准（邮箱不作登录凭据，不能被用来抢账号）。
 * 邮箱比较走 `LOWER()`，避免大小写差异导致「明明绑了却说没有」。
 */
export async function findAdminByAccount(account: string): Promise<AdminRow | undefined> {
  const pool = getPool();
  const [rows] = await pool.query<AdminRow[]>(
    'SELECT * FROM `user` WHERE `username` = ? OR (`email` <> \'\' AND LOWER(`email`) = LOWER(?)) ORDER BY (`username` = ?) DESC LIMIT 1',
    [account, account, account],
  );
  return rows[0];
}

/**
 * 登录标识的查询条件：登录名 / 手机号 / 邮箱三选一。
 *
 * 抽成纯函数是为了让「谁优先」这件事可以单测：
 *   · 登录名最优先 —— 若 A 的邮箱恰好等于 B 的登录名，不能被邮箱抢走 B 的账号；
 *   · 手机号其次；
 *   · 邮箱大小写不敏感，`LOWER()` 与找回密码那条路径保持一致。
 * 三者都不匹配时返回空，由调用方统一回「账号或密码错误」。
 */
export function buildLoginLookup(identifier: string): {
  where: string;
  params: string[];
  order: string;
} {
  const value = identifier.trim();
  return {
    where:
      '(`username` = ? OR `mobile` = ? OR (`email` <> \'\' AND LOWER(`email`) = LOWER(?)))',
    params: [value, value, value],
    order: 'ORDER BY (`username` = ?) DESC, (`mobile` = ?) DESC, `id` ASC',
  };
}

/** 按「登录名 / 手机号 / 邮箱」找账号。只给登录用，找回密码继续用 findAdminByAccount。 */
export async function findAdminByLogin(identifier: string): Promise<AdminRow | undefined> {
  const lookup = buildLoginLookup(identifier);
  const pool = getPool();
  const [rows] = await pool.query<AdminRow[]>(
    `SELECT * FROM \`user\` WHERE ${lookup.where} ${lookup.order} LIMIT 1`,
    [...lookup.params, lookup.params[0], lookup.params[0]],
  );
  return rows[0];
}

/**
 * 从请求里恢复登录态。
 *
 * ★ 409 的关键顺序：**先查记录再判过期**。过期记录被立即删除的话，这里只能
 * 返回「未登录」，前端就失去了用 refresh token 续期的机会（文档 1.9）。
 *
 * `touch: false` 只给会话心跳用：它证明「这个 token 还认」，但不是用户在操作，
 * 不该把「最后活跃」往前推 —— 否则被强退者的心跳会一直把人显示成「在线」。
 */
export async function resolveAdmin(
  event: H3Event,
  options: { touch?: boolean } = {},
): Promise<AuthResult> {
  const token = readAccessToken(event);
  if (!token) return { ok: false, code: 303, msg: '请先登录' };

  const record = await findToken(token, TOKEN_TYPE_ADMIN);
  if (!record) return { ok: false, code: 303, msg: '登录状态已失效，请重新登录' };

  if (record.expire_time <= nowSeconds()) {
    // 记录保留不动：由 token 清理任务在 2 天后删除。
    return { ok: false, code: 409, msg: '登录状态已过期，正在尝试自动续期' };
  }

  const admin = await findAdminById(record.user_id);
  if (!admin) return { ok: false, code: 303, msg: '账号不存在，请重新登录' };
  if (admin.status !== 'enable') return { ok: false, code: 303, msg: '账号已被禁用' };

  // 在线用户页的「最后活跃」来自这里：每个已认证请求刷新一次（内部有 20s 节流）。
  if (options.touch !== false) touchSession(record);

  const context = await loadAdminContext(admin, token, Number(record.scope_department_id) || 0);
  return { ok: true, context };
}

function clientIp(event: H3Event): string {
  const headers = getHeaders(event);
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0]!.trim();
  return event.node.req.socket.remoteAddress ?? '';
}

/**
 * 账号密码登录。
 *
 * `username` 参数实际是「登录标识」：登录名 / 手机号 / 邮箱都可以（findAdminByLogin）。
 * 日志里仍记用户输入的原文，便于排查「他到底拿什么登进来的」。
 *
 * 与文档 4.6.4 一致的三道闸：账号存在 → 未锁定 → 密码正确（且状态启用）。
 * 失败信息统一成「账号或密码错误」，不区分「账号不存在」——减少账号枚举面。
 *
 * 第四道闸（部门）：登录页选了部门时，所选部门必须落在「账号所属部门 + 其下级」内 ——
 * 即账号在自己部门范围内往下挑本次要看哪一块，不能往上/往旁支挑来放大可见范围。
 * 放在密码之后校验，避免未通过密码就泄露账号的部门归属；未选部门（<=0）
 * 则放行，兼容 API 直连与部门下拉临时拿不到的场景。
 */
export async function loginAdmin(
  event: H3Event,
  username: string,
  password: string,
  options: { keepLogin?: boolean; departmentId?: number } = {},
): Promise<LoginResult> {
  // 一次解析，登录日志与会话行共用同一份 IP / 设备信息。
  const meta = await collectRequestMeta(event);
  type LoginBehavior = Parameters<typeof recordLoginLog>[0]['behavior'];
  const writeLog = (
    behavior: LoginBehavior,
    status: boolean,
    message: string,
    admin?: AdminRow,
  ): Promise<void> =>
    recordLoginLog({
      userId: admin?.id ?? 0,
      username,
      nickname: admin?.nickname ?? '',
      behavior,
      status,
      message,
      meta,
    });

  const admin = await findAdminByLogin(username);
  if (!admin) {
    await writeLog('failed', false, '账号或密码错误');
    return { ok: false, code: 0, msg: '账号或密码错误' };
  }

  const ts = nowSeconds();
  const locked =
    admin.login_failure >= LOGIN_RETRY_LIMIT && ts - admin.last_login_time < LOGIN_FAILURE_WINDOW;
  if (locked) {
    await writeLog('locked', false, '密码错误次数过多，账号已锁定', admin);
    return { ok: false, code: 0, msg: '密码错误次数过多，账号已锁定，请 24 小时后再试' };
  }

  if (!(await verifyPassword(password, admin.password))) {
    const pool = getPool();
    // 失败次数只在窗口内累加；窗口外从头计，避免「一年前错两次」也算进来。
    const failure =
      ts - admin.last_login_time >= LOGIN_FAILURE_WINDOW ? 1 : admin.login_failure + 1;
    await pool.query('UPDATE `user` SET `login_failure` = ?, `last_login_time` = ? WHERE `id` = ?', [
      failure,
      ts,
      admin.id,
    ]);
    await writeLog('failed', false, '密码错误', admin);
    return { ok: false, code: 0, msg: '账号或密码错误' };
  }

  // 没有「账号类型」这道闸了：能不能进后台、进来能看到什么，全看角色。
  // 「普通用户」本身就是一个只含仪表盘和个人中心的角色，登录进来是空后台而不是报错 ——
  // 这比「你有账号但不许登录」更好解释，也让角色成为唯一的事实来源。
  if (admin.status !== 'enable') {
    await writeLog('failed', false, '账号已被禁用', admin);
    return { ok: false, code: 0, msg: '账号已被禁用，请联系管理员' };
  }

  // 部门闸：所选部门有效时才校验。部门归属不放进「账号或密码错误」那句，
  // 因为用户是自己选部门的，必须明确知道「账号管不到这个部门」才能纠正选择。
  const selectedDepartmentId = Number(options.departmentId) || 0;
  if (selectedDepartmentId > 0) {
    const [departments] = await getPool().query<Array<{ id: number; pid: number } & RowDataPacket>>(
      'SELECT `id`,`pid` FROM `department`',
    );
    if (!isLoginDepartmentAllowed(admin.department_id, selectedDepartmentId, departments)) {
      await writeLog('failed', false, '所选部门不在账号所属部门及其下级部门', admin);
      return { ok: false, code: 0, msg: '所选部门不在账号所属部门及其下级部门，请重新选择部门' };
    }
  }

  const pool = getPool();
  const ip = clientIp(event);
  await pool.query(
    'UPDATE `user` SET `login_failure` = 0, `last_login_time` = ?, `last_login_ip` = ?, `update_time` = ? WHERE `id` = ?',
    [ts, ip, ts, admin.id],
  );

  // 会话行带上客户端信息，在线用户页不必回头 join 登录日志。
  const tokens = await issueTokenPair(admin.id, options, {
    ip: meta.ip,
    ipLocation: meta.ipLocation,
    browser: meta.browser,
    os: meta.os,
    useragent: meta.useragent,
    scopeDepartmentId: selectedDepartmentId,
  });
  await writeLog('login', true, '', admin);
  return {
    ok: true,
    profile: toProfile({ ...admin, login_failure: 0, last_login_time: ts, last_login_ip: ip }),
    tokens,
  };
}

/** 会话时长（秒），登录接口回给前端做「还有多久过期」的提示。 */
export function tokenTtlSeconds(): number {
  return 3 * 24 * 3600;
}

/** token 密钥是否还是开发默认值：健康检查用它提示「上线前必须改」。 */
export function usingDefaultTokenSecret(): boolean {
  return !process.env.TOKEN_SECRET;
}

export function tokenSecretHint(): string {
  return getDbConfig().tokenSecret.slice(0, 4) + '****';
}
