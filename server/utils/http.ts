/**
 * 统一响应外壳（对应 docs 3.9 的业务码协议）。
 *
 * 业务失败**不用 HTTP 状态码**表达：HTTP 永远是 200，`code` 才是结论。
 *   code=200 成功
 *   code=0   业务失败（表单校验、越权操作、数据库错误…）
 *   code=303 未登录
 *   code=409 token 过期，可续期
 *   code=401 已登录但无权限
 *
 * 为什么不用 4xx/5xx：前端已经把「续期」「重新登录」「提示错误」三种处理
 * 分开，靠 HTTP 状态码只能二选一（要么全 throw，要么全 catch）。业务码让
 * 一个 fetch 封装就能把三件事都做对。
 */
export const BusinessCode = {
  SUCCESS: 200,
  FAIL: 0,
  NEED_LOGIN: 303,
  TOKEN_EXPIRED: 409,
  NO_PERMISSION: 401,
  REDIRECT: 302,
  /**
   * 必须先修改初始密码。
   *
   * 单独一个业务码而不是 NO_PERMISSION：前端要据此把用户**带到改密页**，
   * 而不是弹一句「没有权限」然后什么都不发生。语义取自 HTTP 428
   * （Precondition Required）：请求本身合法，只是还缺一个前提动作。
   */
  NEED_PASSWORD_CHANGE: 428,
  /** 找回密码：登录名不存在 */
  ACCOUNT_NOT_FOUND: 404,
  /** 找回密码：输入的邮箱没有绑定任何用户 */
  EMAIL_NOT_FOUND: 441,
  /** 找回密码：账号存在但没有绑定邮箱，投不出去 */
  EMAIL_NOT_BOUND: 440,
} as const;

export type BusinessCodeValue = (typeof BusinessCode)[keyof typeof BusinessCode];

export interface ApiEnvelope<T = unknown> {
  code: number;
  msg: string;
  data: T;
  /** 服务端时间戳（毫秒），排查「前端时钟不准导致的过期」时很有用 */
  time: number;
}

export function envelope<T>(code: number, msg: string, data: T): ApiEnvelope<T> {
  return { code, msg, data, time: Date.now() };
}

export function ok<T>(data: T = null as T, msg = 'ok'): ApiEnvelope<T> {
  return envelope(BusinessCode.SUCCESS, msg, data);
}

export function fail(msg: string, code: number = BusinessCode.FAIL, data: unknown = null): ApiEnvelope {
  return envelope(code, msg, data);
}

/** 业务异常：在 handler 里 throw，由 defineAdminHandler 统一转成 fail 包。 */
export class ApiError extends Error {
  readonly code: number;

  constructor(message: string, code: number = BusinessCode.FAIL) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export function assertBusiness(condition: unknown, message: string, code: number = BusinessCode.FAIL): asserts condition {
  if (!condition) throw new ApiError(message, code);
}
