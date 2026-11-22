import { callApi } from '../utils/api';

export interface LoginPayload {
  userName: string;
  password: string;
  /** 登录页所选部门；账号须在该部门及其下级部门内才允许登录。 */
  departmentId?: number;
  /** 对应登录页「记住密码」：false 时服务端不下发 refresh token，会话到期即需重登。 */
  keepLogin?: boolean;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  role: string;
  userName: string;
  /**
   * 还在用初始 / 重置口令。为 true 时后台只放行「改密 + 看自己资料」，
   * 登录页要直接把用户带到个人中心，而不是先跳仪表盘再被一堆 428 拦回来。
   */
  mustChangePassword: boolean;
}

/** 注册请求：协议同意的版本与时间一并留痕（docs/注册页设计.md 17.21 / 19.7）。 */
export interface RegisterPayload {
  userName: string;
  password: string;
  agreement: boolean;
  policyVersion: string;
  agreedAt: string;
}

export interface RegisterResult {
  userId: string;
  userName: string;
}

/** 发送重置验证码的入参 / 回执。 */
export interface SendResetCodePayload {
  account: string;
}

export interface SendResetCodeResult {
  /** 验证码有效期（秒） */
  expiresIn: number;
  /** 重发冷却（秒），与服务端节流保持一致 */
  cooldown: number;
  /**
   * 验证码去了哪里。
   * `email` = 已投递到账号绑定的邮箱；`console` = 开发环境打印在服务端控制台。
   *
   * **注意这里没有、也不该有 `code` 字段**：验证码只能经由投递通道离开服务端。
   * 曾经的 `devCode` 是 CRIT-02 的成因 —— 任何人都能因此重置任意账号的密码。
   */
  delivery: 'email' | 'console';
}

/**
 * 认证类接口的业务错误。
 *
 * 带上服务端业务码，组件才能把「请求过于频繁 / 未配置邮件服务 / 验证码不对」
 * 翻成当前语言，而不是把服务端的中文原样丢给英文界面。
 */
export class AuthRequestError extends Error {
  readonly code: number;
  /** 与 FetchError 的 `data` 形状对齐，兼容既有的 `error.data.code` 读法 */
  readonly data: { code: number; msg: string };

  constructor(message: string, code = 0) {
    super(message);
    this.name = 'AuthRequestError';
    this.code = code;
    this.data = { code, msg: message };
  }
}

/** 校验验证码 + 重置密码。 */
export interface ResetPasswordPayload {
  account: string;
  code: string;
  newPassword: string;
}

/** 登录请求。响应外壳在业务层剥离，后续换真实后端只改这一个文件。 */
export async function fetchLogin(payload: LoginPayload): Promise<LoginResult> {
  const res = await callApi<LoginResult>('/api/auth/login', {
    method: 'POST',
    body: payload,
  });
  if (res.code !== 200 || !res.data?.token) throw new Error(res.msg || '登录失败');
  return res.data;
}

/**
 * 注册请求。走同一套 Nitro 响应外壳，失败由调用方按业务码本地化提示。
 * request 可注入：Nuxt 的 $fetch 是运行时自动导入，单测里 stubGlobal 拦不住，
 * 显式留一个参数就能在不拉起 Nuxt 运行时的情况下测接口封装（默认仍是 $fetch）。
 */
export async function fetchRegister(
  payload: RegisterPayload,
  request: typeof $fetch = $fetch,
): Promise<RegisterResult> {
  const res = await callApi<RegisterResult>('/api/auth/register', {
    method: 'POST',
    body: payload,
    request,
  });
  if (res.code !== 200 || !res.data?.userName) throw new Error(res.msg || '注册失败');
  return res.data;
}

/**
 * 发送重置密码验证码。
 *
 * 与 fetchRegister 一样留了 request 注入口：单测可以在不拉起 Nuxt 运行时的情况下
 * 断言「响应外壳怎么剥、失败怎么抛」（docs/忘记密码页设计.md 18.3）。
 */
export async function fetchSendResetCode(
  payload: SendResetCodePayload,
  request: typeof $fetch = $fetch,
): Promise<SendResetCodeResult> {
  const res = await callApi<SendResetCodeResult>('/api/auth/password-code', {
    method: 'POST',
    body: payload,
    request,
  });
  if (res.code !== 200) throw new AuthRequestError(res.msg || '验证码发送失败', res.code);
  // expiresIn / cooldown 缺失时给兜底值：前端只拿它们做提示，不该因此整个流程断掉。
  return {
    expiresIn: res.data?.expiresIn ?? 300,
    cooldown: res.data?.cooldown ?? 60,
    delivery: res.data?.delivery === 'console' ? 'console' : 'email',
  };
}

/** 校验验证码并重置密码。成功返回账号名，失败由调用方按业务码本地化提示。 */
export async function fetchResetPassword(
  payload: ResetPasswordPayload,
  request: typeof $fetch = $fetch,
): Promise<{ userName: string }> {
  const res = await callApi<{ userName: string }>('/api/auth/password-reset', {
    method: 'POST',
    body: payload,
    request,
  });
  if (res.code !== 200 || !res.data?.userName) {
    throw new AuthRequestError(res.msg || '密码重置失败', res.code);
  }
  return res.data;
}

/** 统一提取 Nitro 抛出的错误信息，避免把 FetchError 对象直接展示给用户。 */
export function getErrorMessage(error: unknown, fallback = '登录失败，请稍后重试'): string {
  const data = (error as { data?: { msg?: string } | string } | null)?.data;
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object' && typeof data.msg === 'string') return data.msg;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
