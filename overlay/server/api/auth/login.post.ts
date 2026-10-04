import { ERROR_CODES } from '~/types/admin'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = (body?.username ?? '').trim()
  const password = body?.password ?? ''

  if (!username || !password) {
    return fail(event, 400, ERROR_CODES.VALIDATION, '账号与密码不能为空')
  }

  const account = findAccount(username, password)
  if (!account) {
    // 账号不存在与密码错误回同一个错误码与同一段文案：
    // 区分开等于提供一个可以逐个试探的 oracle
    return fail(event, 401, ERROR_CODES.BAD_CREDENTIALS, '账号或密码不正确')
  }

  const token = issueToken(account.id)
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,           // 前端读不到，登录态只能由 /api/auth/me 说了算
    sameSite: 'lax',
    secure: !import.meta.dev, // 本地 http 下不带 secure，否则 cookie 根本不会下发
    path: '/',
    maxAge: 60 * 60 * 8,
  })

  return toPublicAccount(account)
})
