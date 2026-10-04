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

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, unknown>
}

/** 唯一的请求出口：超时、错误归一、类型都在这里收敛 */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await $fetch<T>(url, {
      method: options.method ?? 'GET',
      body: options.body as never,
      query: options.query as never,
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
