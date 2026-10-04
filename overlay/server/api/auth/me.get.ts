import { ERROR_CODES } from '~/types/admin'

export default defineEventHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE)
  const account = readToken(token)

  if (!account) {
    // 未登录一律 401：客户端据此走「去登录页」这条正常分支
    return fail(event, 401, ERROR_CODES.UNAUTHORIZED, '未登录或登录已过期')
  }

  return toPublicAccount(account)
})
