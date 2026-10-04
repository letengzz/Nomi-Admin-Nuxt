import type { AdminUser } from '~/types/admin'
import { ApiRequestError, request } from '~/utils/api'

/**
 * 登录态。
 * 判据只有一条：服务端 /api/auth/me 说什么就是什么——
 * 不看 cookie 在不在、不看客户端有没有 token，避免「本地以为登录了、服务端 401」。
 */
export function useAuth() {
  const user = useState<AdminUser | null>('auth:user', () => null)
  const resolving = useState<boolean>('auth:resolving', () => false)

  async function resolve(): Promise<AdminUser | null> {
    if (user.value) return user.value            // 已解析过：直接返回，避免每次导航都请求

    resolving.value = true
    try {
      user.value = await request<AdminUser>('/api/auth/me')
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
    })
    return user.value
  }

  async function logout(): Promise<void> {
    try {
      await request<void>('/api/auth/logout', { method: 'POST' })
    }
    finally {
      user.value = null                          // 无论服务端成没成功，本地都要清干净
    }
  }

  const isLoggedIn = computed(() => user.value !== null)

  return { user, resolving, isLoggedIn, resolve, login, logout }
}
