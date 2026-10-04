export default defineEventHandler((event) => {
  revokeToken(getCookie(event, SESSION_COOKIE))
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  return { ok: true }
})
