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
import { usePermissionStore } from '../stores/permission';
import { callApi } from './api';

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
    const res = await callApi<{ token: string; refreshToken: string }>('/api/admin/refresh-token', {
      method: 'POST',
      body: { refreshToken: user.refreshToken },
    });
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
  // 权限也必须跟着清：否则下一个账号登录前，loaded 仍为 true，
  // 会复用上一个账号的菜单 / 按钮权限（token 过期不等于整页刷新）。
  usePermissionStore().reset();
  const current = window.location.pathname + window.location.search;
  const target =
    current && current !== '/login' ? `/login?redirect=${encodeURIComponent(current)}` : '/login';
  if (!window.location.pathname.endsWith('/login')) void navigateTo(target);
}

/** 业务码 428：初始/重置口令未改。 */
const NEED_PASSWORD_CHANGE = 428;

/** 一次会话里只跳一次：并发的几个请求同时收到 428 时，别互相抢路由。 */
let passwordChangeRedirecting = false;

/**
 * 把用户送到「改密」入口。
 *
 * 保留语言前缀：当前路径是 `/en/admin/xxx`，目标就该是 `/en/admin/profile`，
 * 用正则替换掉 `/admin` 之后的部分，而不是拼一个写死的中文路径。
 */
function redirectToPasswordChange(): void {
  if (!import.meta.client || passwordChangeRedirecting) return;
  const target = window.location.pathname.replace(/\/admin(?:\/.*)?$/, '/admin/profile');
  if (window.location.pathname === target) return;

  passwordChangeRedirecting = true;
  void navigateTo(target);
  // 改密失败（比如新密码不合规）后就停在页面上，5 秒后允许下一次跳转，
  // 否则一次失败会把这个会话的引导彻底关掉。
  window.setTimeout(() => {
    passwordChangeRedirecting = false;
  }, 5000);
}

/**
 * 发请求并**直接返回 data**。业务码非 200 时抛 `ApiRequestError`，
 * 调用方只需 try/catch 一次，不用每个接口都判 code。
 */
export async function apiFetch<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const user = useUserStore();

  const headers: Record<string, string> = {};
  if (user.accessToken) headers.batoken = user.accessToken;

  const response = await callApi<T>(url, {
    method: options.method ?? 'GET',
    body: options.body,
    query: options.query,
    headers,
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

  // ③ 初始口令未改：本次请求确实被拒绝了，但用户该做的事是「去改密」，
  //    而不是看到一句「没有权限」去找管理员要授权。
  if (envelope.code === NEED_PASSWORD_CHANGE) {
    redirectToPasswordChange();
    throw new ApiRequestError(envelope.msg || '请先修改初始密码', NEED_PASSWORD_CHANGE);
  }

  if (envelope.code !== 200) {
    throw new ApiRequestError(envelope.msg || '请求失败', envelope.code);
  }

  return envelope.data;
}
