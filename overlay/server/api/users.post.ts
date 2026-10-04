import type { UserRow } from '~/types/admin'
import { ERROR_CODES } from '~/types/admin'

export default defineEventHandler(async (event): Promise<UserRow | { code: number, message: string }> => {
  const account = readToken(getCookie(event, SESSION_COOKIE))
  if (!account) {
    return fail(event, 401, ERROR_CODES.UNAUTHORIZED, '未登录或登录已过期')
  }
  if (!account.roles.includes('ADMIN')) {
    return fail(event, 403, ERROR_CODES.FORBIDDEN, '只有管理员可以新增用户')
  }

  const body = await readBody<{ username?: string; displayName?: string }>(event)
  const username = (body?.username ?? '').trim()
  const displayName = (body?.displayName ?? '').trim()

  if (!username || !displayName) {
    return fail(event, 400, ERROR_CODES.VALIDATION, '账号与姓名不能为空')
  }
  if (usernameTaken(username)) {
    return fail(event, 409, ERROR_CODES.DUPLICATE, `账号 ${username} 已存在`)
  }

  return insertUser({ username, displayName })
})
