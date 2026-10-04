import type { AdminUser } from '~/types/admin'
import { ApiRequestError, request, type RequestFetcher } from '~/utils/api'

/**
 * 登录态。
 * 判据只有一条：服务端 /api/auth/me 说什么就是什么——
 * 不看 cookie 在不在、不看客户端有没有 token，避免「本地以为登录了、服务端 401」。
 */
export function useAuth() {
  const user = useState<AdminUser | null>('auth:user', () => null)
  const resolving = useState<boolean>('auth:resolving', () => false)
  /**
   * 在 setup 期同步捕获：`useRequestFetch()` 只有在能拿到当前请求上下文时才有转发
   * Cookie 的能力，必须在这一刻取。等到回调里再调，SSR 那一次已经跑在不带请求的
   * 上下文里了 —— 它会退化成一个普通 `$fetch`，而症状是「登录成功但刷新就掉线」。
   *
   * 收窄成 `RequestFetcher` 是必要的：`useRequestFetch()` 的静态类型是
   * `$Fetch | H3Event$Fetch`，与 `typeof $fetch` 不是同一个东西（见 utils/api.ts）。
   */
  const fetcher = useRequestFetch() as RequestFetcher

  async function resolve(): Promise<AdminUser | null> {
    if (user.value) return user.value            // 已解析过：直接返回，避免每次导航都请求

    resolving.value = true
    try {
      user.value = await request<AdminUser>('/api/auth/me', { fetcher })
    }
    catch (err) {
      // 401 是「未登录」，属正常分支；其他错误必须继续抛——
      // 否则一次网络故障会被伪装成「未登录」，用户被莫名踢到登录页
      if (!(err instanceof ApiRequestError) || err.status !== 401) throw err
      user.value = null
    }
    finally {
      resolving.value = false
    }
    return user.value
  }

  async function login(username: string, password: string): Promise<AdminUser> {
    user.value = await request<AdminUser>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      fetcher,
    })
    return user.value
  }

  async function logout(): Promise<void> {
    try {
      await request<void>('/api/auth/logout', { method: 'POST', fetcher })
    }
    finally {
      user.value = null                          // 无论服务端成没成功，本地都要清干净
    }
  }

  const isLoggedIn = computed(() => user.value !== null)

  return { user, resolving, isLoggedIn, resolve, login, logout }
}
