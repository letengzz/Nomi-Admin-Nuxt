import type { ApiErrorBody } from '~/types/admin'
import { REQUEST_TIMEOUT } from '~/config/env'

export class ApiRequestError extends Error {
  code: number
  status: number

  constructor(body: { code: number; message: string }, status = 0) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.code = body.code
    this.status = status
  }
}

/**
 * 请求执行器的**最小签名**：只声明我们真正会调用的那一种用法。
 *
 * 为什么不直接写 `typeof $fetch`：`$fetch` 是重载 + 泛型，`await fetcher<T>(url, …)`
 * 推不出 `T`（返回的是 `TypedInternalResponse<…>`，与 `T` 无可比关系，报 TS2322）；
 * 而 `useRequestFetch()` 的返回类型是 `$Fetch | H3Event$Fetch`，后者缺 `raw` / `create`，
 * 也赋不进 `typeof $fetch`。两头都卡在「把整个重载类型搬进来」这件事上 ——
 * 而参数类型本来只需要描述**这一个调用形状**。
 */
export type RequestFetcher = <T>(
  url: string,
  options: { method?: string; body?: unknown; query?: unknown; timeout?: number },
) => Promise<T>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, unknown>
  /**
   * 请求执行器。缺省是全局 `$fetch`。
   *
   * 为什么要留这个口子：SSR 里 `$fetch('/api/…')` 是**进程内直调**，不走网络，
   * 因此**不会带上传入请求的 Cookie**。服务端渲染时它拿不到 `admin_session`，
   * 于是 `/api/auth/me` 一律 401 —— 症状是「明明刚登录成功，刷新一下又被踢回登录页」，
   * 而浏览器里单独打这个接口又是 200。
   * 组合式函数在 setup 期捕获 `useRequestFetch()`（它会转发入站 Cookie）并从这里注入。
   */
  fetcher?: RequestFetcher
}

/** 唯一的请求出口：超时、错误归一、类型都在这里收敛 */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const fetcher = (options.fetcher ?? $fetch) as RequestFetcher
  try {
    return await fetcher<T>(url, {
      method: options.method ?? 'GET',
      body: options.body,
      query: options.query,
      timeout: REQUEST_TIMEOUT,
    })
  }
  catch (err) {
    throw normalizeError(err)
  }
}

/** 把 ofetch 的三种失败形态（HTTP 错误、超时、网络断开）归一成一种 */
function normalizeError(err: unknown): ApiRequestError {
  const e = err as { data?: ApiErrorBody; statusCode?: number; message?: string }

  // ① 服务端按约定返回了 { code, message }
  if (e?.data && typeof e.data.code === 'number') {
    return new ApiRequestError(e.data, e.statusCode ?? 0)
  }
  // ② 超时
  if (e?.message && /timeout/i.test(e.message)) {
    return new ApiRequestError({ code: 0, message: '请求超时，请检查网络后重试' }, e.statusCode ?? 0)
  }
  // ③ 其他（网络断开、非 JSON 响应）
  return new ApiRequestError(
    { code: 0, message: e?.message ?? '网络异常，请稍后重试' },
    e?.statusCode ?? 0,
  )
}
