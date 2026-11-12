export interface LoginPayload {
  userName: string;
  password: string;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  role: string;
  userName: string;
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

/** 统一提取 Nitro 抛出的错误信息，避免把 FetchError 对象直接展示给用户。 */
export function getErrorMessage(error: unknown): string {
  const data = (error as { data?: { msg?: string } | string } | null)?.data;
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object' && typeof data.msg === 'string') return data.msg;
  if (error instanceof Error && error.message) return error.message;
  return '登录失败，请稍后重试';
}
