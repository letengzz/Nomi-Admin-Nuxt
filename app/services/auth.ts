export interface LoginPayload {
  userName: string;
  password: string;
  /** 登录页所选部门；账号须在该部门及其下级部门内才允许登录。 */
  departmentId?: number;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  role: string;
  userName: string;
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
  /** 仅 dev 环境返回：演示站点没有邮件网关，直接把码交给前端展示 */
  devCode?: string;
}

/** 校验验证码 + 重置密码。 */
export interface ResetPasswordPayload {
  account: string;
  code: string;
  newPassword: string;
}

interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

/** 登录请求。响应外壳在业务层剥离，后续换真实后端只改这一个文件。 */
export async function fetchLogin(payload: LoginPayload): Promise<LoginResult> {
  const res = await $fetch<ApiEnvelope<LoginResult>>('/api/auth/login', {
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
  const res = await request<ApiEnvelope<RegisterResult>>('/api/auth/register', {
    method: 'POST',
    body: payload,
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
  const res = await request<ApiEnvelope<SendResetCodeResult>>('/api/auth/password-code', {
    method: 'POST',
    body: payload,
  });
  if (res.code !== 200) throw new Error(res.msg || '验证码发送失败');
  // expiresIn / cooldown 缺失时给兜底值：前端只拿它们做提示，不该因此整个流程断掉。
  return {
    expiresIn: res.data?.expiresIn ?? 300,
    cooldown: res.data?.cooldown ?? 60,
    devCode: res.data?.devCode,
  };
}

/** 校验验证码并重置密码。成功返回账号名，失败由调用方按业务码本地化提示。 */
export async function fetchResetPassword(
  payload: ResetPasswordPayload,
  request: typeof $fetch = $fetch,
): Promise<{ userName: string }> {
  const res = await request<ApiEnvelope<{ userName: string }>>('/api/auth/password-reset', {
    method: 'POST',
    body: payload,
  });
  if (res.code !== 200 || !res.data?.userName) throw new Error(res.msg || '密码重置失败');
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

/** 登录页「选择部门」用的部门表（免登录接口，只返回 id / pid / name）。 */
export interface LoginDepartment {
  id: number;
  pid: number;
  name: string;
}

export async function fetchLoginDepartments(
  request: typeof $fetch = $fetch,
): Promise<LoginDepartment[]> {
  const res = await request<ApiEnvelope<{ list: LoginDepartment[] }>>('/api/auth/departments');
  if (res.code !== 200) return [];
  // 登录页靠它填下拉：拿不到就退化成「只能手输账号」，不该整页报错。
  return res.data?.list ?? [];
}
