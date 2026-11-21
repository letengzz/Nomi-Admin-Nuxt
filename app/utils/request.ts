/**
 * 带鉴权的请求器。对应文档 8.9 的 axios 拦截器，但只保留与权限有关的三件事：
 *
 *   ① 注入 token（`batoken` 头，与服务端 readAccessToken 的取值顺序一致）；
 *   ② 收到 409 → 用 refresh token 换新 token → **重放原请求**（并发请求排队）；
 *   ③ 收到 303 → 清登录态并跳登录页。
 *
 * 没有引入 axios：Nuxt 的 $fetch 已经处理好 SSR/客户端差异与类型推导，
 * 为这三个能力引入一整个 HTTP 库不划算。
 */
import type { ApiEnvelope } from '../types/permission';
import { useUserStore } from '../stores/user';

export class ApiRequestError extends Error {
  readonly code: number;

  constructor(message: string, code = 0) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 上传文件时传 FormData；普通请求传普通对象 */
  body?: unknown;
  query?: Record<string, unknown>;
  /** 内部使用：重放标记，防止 409 → 续期 → 409 无限循环 */
  retried?: boolean;
}

/** 续期的单飞锁：并发五个 409，只换一次 token，其余等同一个 promise。 */
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const user = useUserStore();
  if (!user.refreshToken) return false;

  try {
    const res = await $fetch<ApiEnvelope<{ token: string; refreshToken: string }>>(
      '/api/admin/refresh-token',
      { method: 'POST', body: { refreshToken: user.refreshToken } },
    );
    if (res.code !== 200 || !res.data?.token) return false;
    user.setToken(res.data.token, res.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

function ensureSingleRefresh(): Promise<boolean> {
  refreshing ??= refreshSession().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function redirectToLogin(): void {
  if (!import.meta.client) return;
  const user = useUserStore();
  user.logOut();
  const current = window.location.pathname + window.location.search;
  const target =
    current && current !== '/login' ? `/login?redirect=${encodeURIComponent(current)}` : '/login';
  if (!window.location.pathname.endsWith('/login')) void navigateTo(target);
}

/**
 * 发请求并**直接返回 data**。业务码非 200 时抛 `ApiRequestError`，
 * 调用方只需 try/catch 一次，不用每个接口都判 code。
 */
export async function apiFetch<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const user = useUserStore();

  const headers: Record<string, string> = {};
  if (user.accessToken) headers.batoken = user.accessToken;

  const response = await $fetch<ApiEnvelope<T>>(url, {
    method: options.method ?? 'GET',
    body: options.body as Record<string, unknown> | undefined,
    query: options.query,
    headers,
    // 4xx/5xx 也交给我们看 body：服务端用 HTTP 200 + 业务码，但反向代理/框架
    // 仍可能在极端情况下返回 4xx，这时体里通常也有 {code,msg}。
    ignoreResponseError: true,
  });

  const envelope = response as ApiEnvelope<T> | undefined;
  if (!envelope || typeof envelope.code !== 'number') {
    throw new ApiRequestError('接口返回格式异常');
  }

  // ① 过期：续期后重放一次
  if (envelope.code === 409 && !options.retried) {
    const refreshed = await ensureSingleRefresh();
    if (refreshed) return apiFetch<T>(url, { ...options, retried: true });
    redirectToLogin();
    throw new ApiRequestError(envelope.msg || '登录已过期，请重新登录', 409);
  }

  // ② 未登录 / 被禁用：直接回登录页
  if (envelope.code === 303) {
    redirectToLogin();
    throw new ApiRequestError(envelope.msg || '请先登录', 303);
  }

  if (envelope.code !== 200) {
    throw new ApiRequestError(envelope.msg || '请求失败', envelope.code);
  }

  return envelope.data;
}
