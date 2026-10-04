import type { PageResult, UserRow } from '~/types/admin'
import { ERROR_CODES } from '~/types/admin'

export default defineEventHandler((event): PageResult<UserRow> | { code: number, message: string } => {
  const account = readToken(getCookie(event, SESSION_COOKIE))
  if (!account) {
    // 与 /api/auth/me 同一口径：未登录是 401 + 1001。
    // 返回 200 + 空数组会让 useCrud 把它当成「没有数据」渲染空态，
    // 用户会以为自己没权限看到任何数据。
    return fail(event, 401, ERROR_CODES.UNAUTHORIZED, '未登录或登录已过期')
  }

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page ?? 1) || 1)
  const size = Math.min(100, Math.max(1, Number(query.size ?? 10) || 10))
  const keyword = String(query.keyword ?? '').trim().toLowerCase()

  const matched = keyword
    ? USERS.filter(u =>
        u.username.toLowerCase().includes(keyword)
        || u.displayName.toLowerCase().includes(keyword),
      )
    : USERS

  const start = (page - 1) * size
  return {
    items: matched.slice(start, start + size),
    total: matched.length,
    page,
    size,
  }
})
